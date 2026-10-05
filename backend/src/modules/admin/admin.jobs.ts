import { queryRows, execute, type Row } from '../../db/query';
import { loggerFor } from '../../config/logger';
import { notifyUser } from '../notifications/notifications.orchestrator';
import { processReportJobs } from './admin.reports';

const log = loggerFor('admin.jobs');

export async function runAdminReportJobs(): Promise<number> {
  return processReportJobs(5);
}

/**
 * Fan out scheduled admin broadcasts (audience all/segment) using the existing
 * Notification Platform. Caps each tick so the worker cannot lock the process.
 */
export async function dispatchAdminBroadcasts(limit = 5): Promise<number> {
  let processed = 0;
  const due = await queryRows<Row>(
    `SELECT * FROM scheduled_notifications
      WHERE status = 'scheduled' AND scheduled_for <= CURRENT_TIMESTAMP AND audience IN ('all','segment')
      ORDER BY scheduled_for LIMIT ?`,
    [limit],
  ).catch(() => [] as Row[]);

  for (const row of due) {
    await execute(`UPDATE scheduled_notifications SET status = 'processing' WHERE id = ? AND status = 'scheduled'`, [
      row.id,
    ]);
    try {
      const segment = typeof row.segment_query === 'string' ? JSON.parse(row.segment_query) : row.segment_query ?? {};
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload ?? {};
      const userIds = await resolveAudience(segment as Record<string, unknown>);
      let sent = 0;
      for (const userId of userIds.slice(0, 2000)) {
        await notifyUser({
          userId,
          categoryCode: String(row.category_code),
          title: typeof payload.title === 'string' ? payload.title : undefined,
          body: typeof payload.body === 'string' ? payload.body : undefined,
          eventType: 'admin.broadcast',
          eventId: `scheduled:${row.uuid}:${userId}`,
        });
        sent += 1;
      }
      await execute(
        `UPDATE scheduled_notifications SET status = 'sent', sent_count = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [sent, row.id],
      );
      processed += 1;
    } catch (error) {
      log.warn({ err: error, id: row.id }, 'admin broadcast failed');
      await execute(`UPDATE scheduled_notifications SET status = 'failed', processed_at = CURRENT_TIMESTAMP WHERE id = ?`, [
        row.id,
      ]);
    }
  }
  return processed;
}

async function resolveAudience(segment: Record<string, unknown>): Promise<number[]> {
  const audience = String(segment.audience ?? 'all');
  if (audience === 'users' && Array.isArray(segment.userIds)) {
    return (segment.userIds as number[]).map(Number).filter(Number.isFinite);
  }
  const clauses = [`deleted_at IS NULL`, `status = 'active'`];
  const params: unknown[] = [];
  if (audience === 'country' && segment.countryId) {
    clauses.push('country_id = ?');
    params.push(Number(segment.countryId));
  }
  if (audience === 'role' && typeof segment.roleCode === 'string') {
    const rows = await queryRows<Row>(
      `SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.code = ?
       UNION
       SELECT ura.user_id FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id
        WHERE r.code = ? AND ura.revoked_at IS NULL`,
      [segment.roleCode, segment.roleCode],
    );
    return rows.map((row) => Number(row.user_id));
  }
  if (audience === 'company' && segment.companyId) {
    const rows = await queryRows<Row>(
      `SELECT user_id FROM business_members WHERE business_id = ? AND removed_at IS NULL`,
      [Number(segment.companyId)],
    );
    return rows.map((row) => Number(row.user_id));
  }
  const rows = await queryRows<Row>(`SELECT id FROM users WHERE ${clauses.join(' AND ')} LIMIT 2000`, params);
  return rows.map((row) => Number(row.id));
}
