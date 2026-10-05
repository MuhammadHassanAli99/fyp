import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { AppError, ErrorCode } from '../../core/errors';
import { contextOrDefaults } from '../../core/context';
import { runWithFallback } from '../../providers/ai';
import type { AiDriver, AiUsage } from '../../providers/ai/types';
import { emitToUser } from '../../realtime/socket';
import { notifyUser } from '../notifications/notify';
import { selectModel, estimateCostUsd } from './ai.model-router';
import { bandFor, thresholdFor } from './ai.thresholds';
import type { AiMeta, AiTask, OrchestratorRequest } from './ai.types';

const log = loggerFor('ai.orchestrator');

export interface Orchestrated<T> {
  result: T;
  meta: AiMeta;
}

function truncate(value: unknown): unknown {
  const serialized = JSON.stringify(value ?? null);
  if (serialized.length <= 8000) return value;
  return { _truncated: true, preview: serialized.slice(0, 4000) };
}

function asUsage(value: unknown): AiUsage {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    model: typeof record.model === 'string' ? record.model : env.AI_MODEL,
    tokensUsed: typeof record.tokensUsed === 'number' ? record.tokensUsed : undefined,
    latencyMs: typeof record.latencyMs === 'number' ? record.latencyMs : undefined,
    cost: typeof record.cost === 'number' ? record.cost : undefined,
    cacheHit: record.cacheHit === true,
  };
}

export async function insertQueuedJob(params: {
  task: AiTask;
  userId?: number | null;
  entityType?: string | null;
  entityId?: number | null;
  marketplaceId?: number | null;
  language?: string | null;
  input: unknown;
  idempotencyKey?: string | null;
  provider?: string;
  model?: string;
}): Promise<{ id: number; uuid: string }> {
  if (params.idempotencyKey) {
    const existing = await queryOne<Row>('SELECT id, uuid, status FROM ai_jobs WHERE idempotency_key = ?', [
      params.idempotencyKey,
    ]);
    if (existing) {
      return { id: Number(existing.id), uuid: String(existing.uuid) };
    }
  }
  const jobUuid = uuid();
  const id = await insertAndGetId(
    `INSERT INTO ai_jobs
       (uuid, task, status, provider_code, model, user_id, entity_type, entity_id, marketplace_id,
        language, input_payload, idempotency_key, attempts)
     VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      jobUuid,
      params.task,
      params.provider ?? null,
      params.model ?? null,
      params.userId ?? null,
      params.entityType ?? null,
      params.entityId ?? null,
      params.marketplaceId ?? null,
      params.language ?? null,
      JSON.stringify(truncate(params.input)),
      params.idempotencyKey ?? null,
    ],
  );
  if (params.userId) {
    emitToUser(params.userId, 'ai:job', { uuid: jobUuid, task: params.task, status: 'queued' });
  }
  return { id, uuid: jobUuid };
}

export async function finishJob(params: {
  jobId: number;
  jobUuid: string;
  userId?: number | null;
  task: AiTask;
  status: 'succeeded' | 'failed' | 'cancelled';
  provider: string;
  model: string;
  output: unknown;
  latencyMs: number;
  tokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number | null;
  cacheHit?: boolean;
  confidence?: number | null;
  decision?: string | null;
  error?: string | null;
}): Promise<void> {
  await execute(
    `UPDATE ai_jobs
        SET status = ?, provider_code = ?, model = ?, output_payload = ?,
            prompt_tokens = ?, completion_tokens = ?, total_tokens = ?, cost = ?,
            latency_ms = ?, cache_hit = ?, confidence = ?, decision = ?,
            error_message = ?, finished_at = CURRENT_TIMESTAMP,
            started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
      WHERE id = ?`,
    [
      params.status,
      params.provider,
      params.model,
      JSON.stringify(truncate(params.output)),
      params.promptTokens ?? null,
      params.completionTokens ?? null,
      params.tokens ?? null,
      params.cost ?? null,
      params.latencyMs,
      params.cacheHit ? 1 : 0,
      params.confidence ?? null,
      params.decision ?? null,
      params.error ?? null,
      params.jobId,
    ],
  );
  if (params.userId) {
    emitToUser(params.userId, 'ai:job', {
      uuid: params.jobUuid,
      task: params.task,
      status: params.status,
      confidence: params.confidence ?? null,
    });
    if (params.status !== 'succeeded' || params.task === 'image_enhance' || params.task === 'market_analysis') {
      void notifyUser({
        userId: params.userId,
        categoryCode: 'ai.job',
        title: `AI ${params.task.replace(/_/g, ' ')} ${params.status}`,
        body: params.status === 'succeeded' ? 'Your AI result is ready.' : 'The AI job could not be completed.',
        actionType: 'system',
        actionTarget: `/ai/jobs/${params.jobUuid}`,
        data: { jobUuid: params.jobUuid, task: params.task, status: params.status },
        variables: {
          status: params.status,
          feature: params.task,
          summary: params.status === 'succeeded' ? 'Ready to review.' : 'Failed.',
          jobUuid: params.jobUuid,
        },
      }).catch((error) => log.debug({ err: error }, 'ai job notification skipped'));
    }
  }
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new AppError('AI request timed out', {
                status: 503,
                code: ErrorCode.AI_UNAVAILABLE,
                expected: true,
              }),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Runs a capability: select model, timeout, fallback, validate, audit.
 * Callers that need entitlements must go through the Gateway.
 */
export async function orchestrate<T>(
  request: OrchestratorRequest<unknown>,
  run: (driver: AiDriver) => Promise<T>,
): Promise<Orchestrated<T>> {
  const context = contextOrDefaults();
  const userId = request.userId ?? context.userId;
  const timeoutMs = request.timeoutMs ?? env.AI_TIMEOUT_MS;
  const route = await selectModel({
    task: request.task,
    quality: request.quality,
    privacy: request.privacy,
  });
  const startedAt = Date.now();

  let jobId: number;
  let jobUuid: string;
  if (request.idempotencyKey) {
    const existing = await queryOne<Row>(
      `SELECT id, uuid, status, output_payload, provider_code, model, confidence, latency_ms, cache_hit, total_tokens
         FROM ai_jobs WHERE idempotency_key = ?`,
      [request.idempotencyKey],
    );
    if (existing && existing.status === 'succeeded' && existing.output_payload) {
      const output = typeof existing.output_payload === 'string' ? JSON.parse(String(existing.output_payload)) : existing.output_payload;
      const confidence = Number(existing.confidence ?? 0);
      const threshold = await thresholdFor(request.task);
      return {
        result: (output?.result ?? output) as T,
        meta: {
          jobUuid: String(existing.uuid),
          task: request.task,
          provider: String(existing.provider_code ?? 'cache'),
          model: String(existing.model ?? 'cache'),
          version: '1',
          confidence,
          band: bandFor(confidence, threshold),
          cacheHit: true,
          timestamp: new Date().toISOString(),
          latencyMs: Number(existing.latency_ms ?? 0),
          tokensUsed: existing.total_tokens === null ? undefined : Number(existing.total_tokens),
        },
      };
    }
  }

  const queued = await insertQueuedJob({
    task: request.task,
    userId,
    entityType: request.entityType,
    entityId: request.entityId,
    marketplaceId: request.marketplaceId ?? context.marketplaceId,
    language: request.language ?? context.language,
    input: request.input,
    idempotencyKey: request.idempotencyKey,
    provider: route.providerCode,
    model: route.model,
  });
  jobId = queued.id;
  jobUuid = queued.uuid;

  await execute(`UPDATE ai_jobs SET status = 'running', started_at = CURRENT_TIMESTAMP, attempts = attempts + 1 WHERE id = ?`, [
    jobId,
  ]);
  if (userId) emitToUser(userId, 'ai:job', { uuid: jobUuid, task: request.task, status: 'processing' });

  try {
    const result = await withTimeout(runWithFallback(run), timeoutMs);
    const usage = asUsage(result);
    const confidence =
      result && typeof result === 'object' && 'confidence' in (result as object)
        ? Number((result as { confidence?: number }).confidence ?? 70)
        : 70;
    const threshold = await thresholdFor(request.task);
    const band = bandFor(confidence, threshold);
    const cost =
      usage.cost ??
      (await estimateCostUsd(route.providerCode, route.capability, usage.tokensUsed ?? 0, 0));
    const meta: AiMeta = {
      jobUuid,
      task: request.task,
      provider: route.providerCode,
      model: usage.model || route.model,
      version: '1',
      confidence,
      band,
      cacheHit: usage.cacheHit === true,
      timestamp: new Date().toISOString(),
      latencyMs: usage.latencyMs ?? Date.now() - startedAt,
      tokensUsed: usage.tokensUsed,
      estimatedCost: cost,
    };
    await finishJob({
      jobId,
      jobUuid,
      userId,
      task: request.task,
      status: 'succeeded',
      provider: route.providerCode,
      model: meta.model,
      output: { result, meta },
      latencyMs: meta.latencyMs,
      tokens: usage.tokensUsed,
      cost,
      cacheHit: meta.cacheHit,
      confidence,
      decision: band,
    });
    return { result, meta };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ err: error, task: request.task }, 'AI orchestrator primary run failed');
    await finishJob({
      jobId,
      jobUuid,
      userId,
      task: request.task,
      status: 'failed',
      provider: route.providerCode,
      model: route.model,
      output: null,
      latencyMs: Date.now() - startedAt,
      error: message,
    });
    throw error;
  }
}

export async function getAiJob(jobUuid: string, userId: number, isStaff = false) {
  const row = await queryOne<Row>(
    `SELECT uuid, task, status, provider_code, model, confidence, decision, cache_hit,
            latency_ms, error_message, output_payload, created_at, finished_at, user_id,
            reviewed_by, reviewed_at, review_reason
       FROM ai_jobs WHERE uuid = ?`,
    [jobUuid],
  );
  if (!row) {
    throw new AppError('AI job not found', { status: 404, code: ErrorCode.NOT_FOUND });
  }
  if (!isStaff && Number(row.user_id) !== userId) {
    throw new AppError('AI job not found', { status: 404, code: ErrorCode.NOT_FOUND });
  }
  const output =
    row.output_payload == null
      ? null
      : typeof row.output_payload === 'string'
        ? JSON.parse(String(row.output_payload))
        : row.output_payload;
  return {
    uuid: String(row.uuid),
    task: String(row.task),
    status: String(row.status),
    provider: row.provider_code ? String(row.provider_code) : null,
    model: row.model ? String(row.model) : null,
    confidence: row.confidence === null ? null : Number(row.confidence),
    decision: row.decision ? String(row.decision) : null,
    cacheHit: Number(row.cache_hit) === 1,
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    error: row.error_message ? String(row.error_message) : null,
    result: output?.result ?? output,
    meta: output?.meta ?? null,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    review: row.reviewed_by
      ? {
          reviewerId: Number(row.reviewed_by),
          reviewedAt: row.reviewed_at,
          reason: row.review_reason ? String(row.review_reason) : null,
        }
      : null,
  };
}

export async function processQueuedAiJobs(limit = 8): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT id, uuid, task, user_id, input_payload, entity_id
       FROM ai_jobs
      WHERE status = 'queued' AND task IN ('image_enhance','market_analysis','recommend','translate')
      ORDER BY created_at ASC
      LIMIT ?`,
    [limit],
  );
  let processed = 0;
  for (const row of rows) {
    const task = String(row.task) as AiTask;
    const claimed = await execute(
      `UPDATE ai_jobs SET status = 'running', started_at = CURRENT_TIMESTAMP, attempts = attempts + 1
        WHERE id = ? AND status = 'queued'`,
      [row.id],
    );
    if (claimed.affectedRows === 0) continue;
    try {
      const { runQueuedCapability } = await import('./ai.capabilities');
      await runQueuedCapability({
        jobId: Number(row.id),
        jobUuid: String(row.uuid),
        task,
        userId: row.user_id === null ? null : Number(row.user_id),
        input: typeof row.input_payload === 'string' ? JSON.parse(String(row.input_payload)) : row.input_payload,
        entityId: row.entity_id === null ? null : Number(row.entity_id),
      });
      processed += 1;
    } catch (error) {
      log.warn({ err: error, job: row.uuid }, 'queued AI job failed');
      await finishJob({
        jobId: Number(row.id),
        jobUuid: String(row.uuid),
        userId: row.user_id === null ? null : Number(row.user_id),
        task,
        status: 'failed',
        provider: 'heuristic',
        model: 'worker',
        output: null,
        latencyMs: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return processed;
}
