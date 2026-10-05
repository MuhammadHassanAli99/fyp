import { Router } from 'express';
import { asyncHandler } from '../../core/http/async-handler';
import { ok } from '../../core/http/response';
import { AppError, ErrorCode } from '../../core/errors';
import { authenticate } from '../../middleware/authenticate';
import { requireStaff } from '../../middleware/authorize';
import { pool } from '../../db/pool';
import { execute, queryCount, queryOne, type Row } from '../../db/query';
import { cache, cacheDriverName } from '../../config/cache';
import { ai } from '../../providers/ai';
import { isStorageReady, storage } from '../../providers/storage';
import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { isShuttingDown } from '../../core/lifecycle';
import { messagingStatus, unconfiguredMessagingChannels } from '../../providers/messaging';

const log = loggerFor('health');

export const healthRouter = Router();

const APP_VERSION = process.env.npm_package_version ?? '1.0.0';

type ComponentStatus = 'healthy' | 'degraded' | 'down';

interface ComponentCheck {
  component: string;
  checkName: string;
  status: ComponentStatus;
  latencyMs: number | null;
  details: Record<string, unknown> | null;
  error: string | null;
}

/**
 * Pool saturation is the earliest visible symptom of a slow query storm, so the
 * counters are worth surfacing. They are driver internals rather than public
 * API, hence the defensive read — a mysql2 upgrade must degrade the report, not
 * break the probe.
 */
interface PoolInternals {
  _allConnections?: { length: number };
  _freeConnections?: { length: number };
  _connectionQueue?: { length: number };
}

function poolStats(): Record<string, number> | null {
  const internals = (pool as unknown as { pool?: PoolInternals }).pool;
  if (!internals) return null;
  const stats: Record<string, number> = { limit: env.DB_POOL_SIZE };
  if (internals._allConnections) stats.open = internals._allConnections.length;
  if (internals._freeConnections) stats.idle = internals._freeConnections.length;
  if (internals._connectionQueue) stats.waiting = internals._connectionQueue.length;
  return stats;
}

/**
 * Liveness. Deliberately touches nothing: an orchestrator restarting the process
 * because the database is briefly unreachable turns a recoverable blip into an
 * outage. Readiness is where dependencies are judged.
 */
healthRouter.get(
  '/',
  asyncHandler(async (_req, res) =>
    ok(res, {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      version: APP_VERSION,
      environment: env.NODE_ENV,
    }),
  ),
);

/** Readiness. A load balancer removes this instance from rotation on 503. */
healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const startedAt = performance.now();

    // Report unready the moment shutdown begins, so the balancer deregisters
    // this instance before the listener actually closes. Otherwise every
    // rolling deploy drops the requests that were in flight at that moment.
    if (isShuttingDown()) {
      throw new AppError('Service is shutting down', {
        status: 503,
        code: ErrorCode.SERVICE_UNAVAILABLE,
        retryAfter: 10,
        expected: true,
        details: { status: 'draining' },
      });
    }

    try {
      await queryOne<Row>('SELECT 1 AS ok');
    } catch (error) {
      log.error({ err: error }, 'readiness probe failed');
      throw new AppError('Service is not ready to accept traffic', {
        status: 503,
        code: ErrorCode.SERVICE_UNAVAILABLE,
        retryAfter: 5,
        expected: true,
        details: { status: 'unavailable', database: 'disconnected', pool: poolStats() },
      });
    }

    return ok(res, {
      status: 'ready',
      database: 'connected',
      databaseLatencyMs: Math.round(performance.now() - startedAt),
      pool: poolStats(),
      version: APP_VERSION,
    });
  }),
);

/**
 * Staff diagnostics (§22 System Health). Each probe is persisted so the status
 * page and the alerting rules read history rather than re-probing, and so a
 * flapping component is visible as a pattern instead of a single sample.
 *
 * Returns 200 even when degraded: this endpoint reports on health, it is not a
 * liveness signal, and a monitoring tool that cannot read the body of a 503 is
 * worse than useless here.
 */
healthRouter.get(
  '/deep',
  authenticate,
  requireStaff,
  asyncHandler(async (_req, res) => {
    const checks: ComponentCheck[] = [];

    checks.push(await timed('db', 'select_1', async () => {
      await queryOne<Row>('SELECT 1 AS ok');
      return { details: { pool: poolStats() } };
    }));

    checks.push(await timed('cache', 'round_trip', async () => {
      const probeKey = `health:probe:${Date.now()}`;
      await cache.set(probeKey, 'ok', 10);
      const value = await cache.get<string>(probeKey);
      await cache.del(probeKey);
      if (value !== 'ok') return { status: 'degraded' as const, details: { readBack: value } };
      return { details: { store: cacheDriverName(), redisUrl: Boolean(env.REDIS_URL) } };
    }));

    checks.push(await timed('ai', 'driver', async () => ({ details: { driver: ai.driverName, model: env.AI_MODEL } })));

    checks.push(await timed('storage', 'driver', async () => ({
      status: isStorageReady() ? ('healthy' as const) : ('degraded' as const),
      details: { driver: storage.name, configured: env.STORAGE_DRIVER, cdn: Boolean(env.CDN_PUBLIC_URL) },
    })));

    // A `log` transport reports every send as successful, so a misconfigured
    // channel is invisible in the delivery metrics. Surface it here instead.
    checks.push(await timed('messaging', 'drivers', async () => {
      const unconfigured = unconfiguredMessagingChannels();
      return {
        status: unconfigured.includes('email') ? ('degraded' as const) : ('healthy' as const),
        details: { ...messagingStatus(), unconfigured },
      };
    }));

    // A growing outbox means domain side effects (alerts, notifications,
    // analytics) are silently not happening — the most damaging kind of outage
    // because nothing user-facing fails.
    checks.push(await timed('queue', 'outbox_pending', async () => {
      const pending = await queryCount(`SELECT COUNT(*) FROM outbox_events WHERE status = 'pending'`);
      const failed = await queryCount(`SELECT COUNT(*) FROM outbox_events WHERE status = 'failed'`);
      const oldest = await queryOne<Row>(
        `SELECT TIMESTAMPDIFF(SECOND, MIN(created_at), CURRENT_TIMESTAMP) AS age_seconds
           FROM outbox_events WHERE status = 'pending'`,
      );
      const oldestAgeSeconds = oldest?.age_seconds === null || oldest?.age_seconds === undefined ? 0 : Number(oldest.age_seconds);
      const status: ComponentStatus = oldestAgeSeconds > 900 || pending > 5_000 ? 'degraded' : 'healthy';
      return { status, details: { pending, failed, oldestPendingAgeSeconds: oldestAgeSeconds } };
    }));

    checks.push(await timed('jobs', 'recent_failures', async () => {
      const failed = await queryCount(
        `SELECT COUNT(*) FROM job_runs
          WHERE status = 'failed' AND started_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 24 HOUR)`,
      );
      const running = await queryCount(
        `SELECT COUNT(*) FROM job_runs
          WHERE status = 'running' AND started_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)`,
      );
      const status: ComponentStatus = failed > 10 ? 'degraded' : 'healthy';
      return { status, details: { failedLast24h: failed, stuckRuns: running } };
    }));

    await Promise.all(checks.map(recordCheck));

    const overall: ComponentStatus = checks.some((check) => check.status === 'down')
      ? 'down'
      : checks.some((check) => check.status === 'degraded')
        ? 'degraded'
        : 'healthy';

    return ok(res, {
      status: overall,
      version: APP_VERSION,
      uptime: Math.round(process.uptime()),
      checkedAt: new Date().toISOString(),
      memory: {
        rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1_048_576),
      },
      components: checks,
    });
  }),
);

/**
 * Runs one probe, converting a thrown error into a `down` result. A probe that
 * throws would abort the whole report and hide every other component.
 */
async function timed(
  component: string,
  checkName: string,
  probe: () => Promise<{ status?: ComponentStatus; details?: Record<string, unknown> }>,
): Promise<ComponentCheck> {
  const startedAt = performance.now();
  try {
    const result = await probe();
    return {
      component,
      checkName,
      status: result.status ?? 'healthy',
      latencyMs: Math.round(performance.now() - startedAt),
      details: result.details ?? null,
      error: null,
    };
  } catch (error) {
    return {
      component,
      checkName,
      status: 'down',
      latencyMs: Math.round(performance.now() - startedAt),
      details: null,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    };
  }
}

async function recordCheck(check: ComponentCheck): Promise<void> {
  try {
    await execute(
      `INSERT INTO system_health_checks (component, check_name, status, latency_ms, details, error)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        check.component,
        check.checkName,
        check.status,
        check.latencyMs,
        check.details === null ? null : JSON.stringify(check.details),
        check.error,
      ],
    );
  } catch (error) {
    // The database being the failing component is exactly when this write
    // fails, so it must never mask the report it is describing.
    log.warn({ err: error, component: check.component }, 'could not persist health check');
  }
}
