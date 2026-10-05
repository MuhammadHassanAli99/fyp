import { execute } from '../../db/query';
import { loggerFor } from '../../config/logger';

const log = loggerFor('notify.metrics');

export async function bumpMetric(params: {
  channel: string;
  categoryCode?: string | null;
  created?: number;
  queued?: number;
  sent?: number;
  delivered?: number;
  failed?: number;
  retried?: number;
  read?: number;
  latencyMs?: number;
}): Promise<void> {
  try {
    await execute(
      `INSERT INTO notification_metrics_daily
         (day, channel, category_code, created_count, queued_count, sent_count, delivered_count,
          failed_count, retried_count, read_count, latency_ms_sum, latency_samples)
       VALUES (CURRENT_DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         created_count = created_count + VALUES(created_count),
         queued_count = queued_count + VALUES(queued_count),
         sent_count = sent_count + VALUES(sent_count),
         delivered_count = delivered_count + VALUES(delivered_count),
         failed_count = failed_count + VALUES(failed_count),
         retried_count = retried_count + VALUES(retried_count),
         read_count = read_count + VALUES(read_count),
         latency_ms_sum = latency_ms_sum + VALUES(latency_ms_sum),
         latency_samples = latency_samples + VALUES(latency_samples)`,
      [
        params.channel.slice(0, 16),
        params.categoryCode ?? '',
        params.created ?? 0,
        params.queued ?? 0,
        params.sent ?? 0,
        params.delivered ?? 0,
        params.failed ?? 0,
        params.retried ?? 0,
        params.read ?? 0,
        params.latencyMs ?? 0,
        params.latencyMs != null ? 1 : 0,
      ],
    );
  } catch (error) {
    log.debug({ err: error }, 'metric bump skipped');
  }
}
