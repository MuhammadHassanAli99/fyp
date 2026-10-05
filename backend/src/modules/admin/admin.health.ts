import { queryRows, type Row } from '../../db/query';
import { env } from '../../config/env';

export async function getSystemHealthSnapshot() {
  const rows = await queryRows<Row>(
    `SELECT component, check_name, status, latency_ms, created_at
       FROM system_health_checks
      WHERE created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)
      ORDER BY id DESC
      LIMIT 40`,
  );
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const key = `${row.component}:${row.check_name}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  const components = [...latest.values()].map((row) => ({
    component: String(row.component),
    checkName: String(row.check_name),
    status: String(row.status),
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    checkedAt: (row.created_at as Date).toISOString(),
  }));
  const overall = components.some((item) => item.status === 'down')
    ? 'down'
    : components.some((item) => item.status === 'degraded')
      ? 'degraded'
      : components.length > 0
        ? 'healthy'
        : 'unknown';
  const mem = process.memoryUsage();
  return {
    status: overall,
    environment: env.NODE_ENV,
    uptime: Math.round(process.uptime()),
    memory: { rssMb: Math.round(mem.rss / 1_048_576), heapUsedMb: Math.round(mem.heapUsed / 1_048_576) },
    components,
    authoritative: 'Backend /health/deep and observability systems remain authoritative',
    checkedAt: new Date().toISOString(),
  };
}
