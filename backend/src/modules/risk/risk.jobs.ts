import { execute, insertAndGetId, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { loggerFor } from '../../config/logger';
import { refreshIpReputation } from './risk.ip';
import { hashListingMedia } from './risk.image';
import { runAmlIfRequired } from './risk.aml';

const log = loggerFor('risk.jobs');

export type RiskJobKind =
  | 'ip_reputation'
  | 'image_hash'
  | 'duplicate'
  | 'document'
  | 'behavior'
  | 'recalculate'
  | 'graph'
  | 'ai_analysis'
  | 'kyc_sync'
  | 'aml_screen';

export async function enqueueRiskJob(kind: RiskJobKind, payload: Record<string, unknown>): Promise<number> {
  return insertAndGetId(
    `INSERT INTO risk_jobs (uuid, kind, payload, status) VALUES (?, ?, ?, 'queued')`,
    [uuid(), kind, JSON.stringify(payload)],
  );
}

export async function processRiskJobs(limit = 20): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT id, kind, payload FROM risk_jobs
      WHERE status = 'queued' AND available_at <= CURRENT_TIMESTAMP
      ORDER BY id ASC LIMIT ?`,
    [limit],
  );
  let processed = 0;
  for (const row of rows) {
    await execute(
      `UPDATE risk_jobs SET status = 'running', started_at = CURRENT_TIMESTAMP, attempts = attempts + 1 WHERE id = ? AND status = 'queued'`,
      [row.id],
    );
    try {
      const payload = (typeof row.payload === 'string' ? JSON.parse(String(row.payload)) : row.payload) as Record<
        string,
        unknown
      >;
      await runJob(String(row.kind) as RiskJobKind, payload);
      await execute(
        `UPDATE risk_jobs SET status = 'succeeded', finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [row.id],
      );
      processed += 1;
    } catch (error) {
      log.warn({ err: error, id: row.id, kind: row.kind }, 'risk job failed');
      await execute(
        `UPDATE risk_jobs
            SET status = IF(attempts >= 5, 'failed', 'queued'),
                last_error = ?,
                available_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL POW(2, attempts) * 20 SECOND)
          WHERE id = ?`,
        [String(error).slice(0, 500), row.id],
      );
    }
  }
  return processed;
}

async function runJob(kind: RiskJobKind, payload: Record<string, unknown>): Promise<void> {
  if (kind === 'ip_reputation' && typeof payload.ip === 'string') {
    await refreshIpReputation(payload.ip);
    return;
  }
  if (kind === 'image_hash' && payload.mediaId) {
    await hashListingMedia(Number(payload.mediaId), payload.listingId ? Number(payload.listingId) : null);
    return;
  }
  if (kind === 'aml_screen' && payload.userId) {
    await runAmlIfRequired(Number(payload.userId), payload.countryId ? Number(payload.countryId) : null);
    return;
  }
}
