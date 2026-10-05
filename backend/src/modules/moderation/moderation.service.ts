import { execute, insertAndGetId, queryRows, type Row } from '../../db/query';
import { enqueueForModeration } from './screening.service';
import { uuid } from '../../core/security/crypto';

export async function listModerationQueue(params: {
  status?: string;
  limit?: number;
}) {
  const status = params.status ?? 'pending';
  const limit = params.limit ?? 50;

  const rows = await queryRows<Row>(
    `SELECT id, uuid, entity_type, entity_id, marketplace_id, reason, priority, ai_score,
            report_count, status, sla_due_at, created_at
       FROM moderation_queue
      WHERE status = ?
      ORDER BY FIELD(priority, 'urgent','high','normal','low'), created_at ASC
      LIMIT ?`,
    [status, limit],
  );

  return rows.map(mapQueueItem);
}

export async function submitReport(input: {
  reporterId: number | null;
  entityType: 'listing' | 'user' | 'review' | 'message' | 'business' | 'conversation' | 'forum_post';
  entityId: number;
  reasonCode: string;
  description?: string | null;
  marketplaceId?: number | null;
}) {
  const reportId = await insertAndGetId(
    `INSERT INTO content_reports
       (uuid, reporter_id, entity_type, entity_id, reason_code, description, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [
      uuid(),
      input.reporterId,
      input.entityType,
      input.entityId,
      input.reasonCode,
      input.description ?? null,
    ],
  );

  const queueId = await enqueueForModeration({
    entityType: input.entityType === 'conversation' ? 'conversation' : input.entityType === 'message' ? 'message' : input.entityType,
    entityId: input.entityId,
    marketplaceId: input.marketplaceId ?? null,
    reason: 'user_reported',
    priority: 'normal',
  });

  return { reportId, queueId };
}

const mapQueueItem = (row: Row) => ({
  id: Number(row.id),
  uuid: String(row.uuid),
  entityType: String(row.entity_type),
  entityId: Number(row.entity_id),
  marketplaceId: row.marketplace_id === null ? null : Number(row.marketplace_id),
  reason: String(row.reason),
  priority: String(row.priority),
  aiScore: row.ai_score === null ? null : Number(row.ai_score),
  reportCount: Number(row.report_count),
  status: String(row.status),
  slaDueAt: row.sla_due_at ? (row.sla_due_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
});
