import type { Request } from 'express';
import { insertAndGetId, queryCount, queryOne, queryRows, execute, type Row } from '../../db/query';
import { notFound } from '../../core/errors';
import { uuid } from '../../core/security/crypto';
import { writeAdminAudit } from './admin.authz';

export async function queueReport(req: Request, reportType: string, filters: Record<string, unknown> = {}) {
  const id = await insertAndGetId(
    `INSERT INTO admin_report_jobs (uuid, report_type, filters_json, status, requested_by)
     VALUES (?, ?, ?, 'queued', ?)`,
    [uuid(), reportType, JSON.stringify(filters), req.auth!.userId],
  );
  await writeAdminAudit({
    req,
    action: 'report.queue',
    entityType: 'admin_report_job',
    entityId: id,
    permission: 'report.export',
    after: { reportType, filters },
  });
  return { id, uuid: await jobUuid(id), status: 'queued' };
}

async function jobUuid(id: number) {
  const row = await queryOne<Row>(`SELECT uuid FROM admin_report_jobs WHERE id = ?`, [id]);
  return String(row?.uuid ?? '');
}

export async function listReports(req: Request) {
  const staff = req.auth!.permissions.includes('*') || req.auth!.permissions.includes('report.view_any');
  const rows = await queryRows<Row>(
    staff
      ? `SELECT uuid, report_type, status, row_count, created_at, finished_at FROM admin_report_jobs ORDER BY id DESC LIMIT 50`
      : `SELECT uuid, report_type, status, row_count, created_at, finished_at FROM admin_report_jobs WHERE requested_by = ? ORDER BY id DESC LIMIT 50`,
    staff ? [] : [req.auth!.userId],
  );
  return rows.map((row) => ({
    uuid: String(row.uuid),
    reportType: String(row.report_type),
    status: String(row.status),
    rowCount: row.row_count === null ? null : Number(row.row_count),
    createdAt: (row.created_at as Date).toISOString(),
    finishedAt: row.finished_at ? (row.finished_at as Date).toISOString() : null,
  }));
}
export async function getReport(req: Request, jobUuid: string) {
  const row = await queryOne<Row>(`SELECT * FROM admin_report_jobs WHERE uuid = ?`, [jobUuid]);
  if (!row) throw notFound('Report');
  if (Number(row.requested_by) !== req.auth!.userId && !req.auth!.permissions.includes('*') && !req.auth!.permissions.includes('report.view_any')) {
    throw notFound('Report');
  }
  return {
    uuid: String(row.uuid),
    reportType: String(row.report_type),
    status: String(row.status),
    rowCount: row.row_count === null ? null : Number(row.row_count),
    result: row.result_json ?? null,
    error: (row.error as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    finishedAt: row.finished_at ? (row.finished_at as Date).toISOString() : null,
  };
}

export async function processReportJobs(limit = 3): Promise<number> {
  const jobs = await queryRows<Row>(
    `SELECT * FROM admin_report_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT ?`,
    [limit],
  );
  let processed = 0;
  for (const job of jobs) {
    await execute(`UPDATE admin_report_jobs SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ?`, [job.id]);
    try {
      const filters = (typeof job.filters_json === 'string' ? JSON.parse(job.filters_json) : job.filters_json) as Record<string, unknown> | null;
      const result = await runReport(String(job.report_type), filters ?? {});
      await execute(
        `UPDATE admin_report_jobs SET status = 'succeeded', result_json = ?, row_count = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [JSON.stringify(result), Array.isArray(result.rows) ? result.rows.length : 1, job.id],
      );
      processed += 1;
    } catch (error) {
      await execute(
        `UPDATE admin_report_jobs SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [error instanceof Error ? error.message.slice(0, 500) : 'failed', job.id],
      );
    }
  }
  return processed;
}

async function runReport(type: string, filters: Record<string, unknown>) {
  const countryId = typeof filters.countryId === 'number' ? filters.countryId : null;
  const marketplaceId = typeof filters.marketplaceId === 'number' ? filters.marketplaceId : null;
  const from = typeof filters.from === 'string' ? filters.from : null;

  const timeClause = from ? 'AND created_at >= ?' : '';
  const timeParams = from ? [from] : [];

  switch (type) {
    case 'users':
      return {
        rows: [
          {
            total: await queryCount(
              `SELECT COUNT(*) FROM users WHERE deleted_at IS NULL ${countryId ? 'AND country_id = ?' : ''} ${timeClause}`,
              [...(countryId ? [countryId] : []), ...timeParams],
            ),
          },
        ],
      };
    case 'listings':
      return {
        rows: await queryRows<Row>(
          `SELECT m.code AS marketplace, COUNT(*) AS c
             FROM listings l JOIN marketplaces m ON m.id = l.marketplace_id
            WHERE l.deleted_at IS NULL ${marketplaceId ? 'AND l.marketplace_id = ?' : ''} ${countryId ? 'AND l.country_id = ?' : ''}
            GROUP BY m.code`,
          [...(marketplaceId ? [marketplaceId] : []), ...(countryId ? [countryId] : [])],
        ),
      };
    case 'payments':
    case 'revenue':
    case 'transactions':
      return {
        rows: await queryRows<Row>(
          `SELECT currency, SUM(amount) AS amount, COUNT(*) AS c
             FROM payments WHERE status IN ('succeeded','captured') ${timeClause}
            GROUP BY currency`,
          timeParams,
        ),
      };
    case 'subscriptions':
      return {
        rows: await queryRows<Row>(`SELECT status, COUNT(*) AS c FROM user_subscriptions GROUP BY status`),
      };
    case 'support':
      return {
        rows: await queryRows<Row>(`SELECT status, COUNT(*) AS c FROM support_tickets GROUP BY status`),
      };
    case 'sales':
    case 'salesmen':
      return {
        rows: await queryRows<Row>(`SELECT status, COUNT(*) AS c FROM sales_leads GROUP BY status`),
      };
    case 'companies':
      return {
        rows: await queryRows<Row>(`SELECT kind, status, COUNT(*) AS c FROM business_profiles GROUP BY kind, status`),
      };
    case 'fraud':
      return {
        rows: await queryRows<Row>(`SELECT status, COUNT(*) AS c FROM fraud_cases GROUP BY status`),
      };
    case 'reviews':
      return {
        rows: await queryRows<Row>(`SELECT status, COUNT(*) AS c FROM reviews GROUP BY status`),
      };
    case 'advertisements':
      return {
        rows: await queryRows<Row>(`SELECT status, COUNT(*) AS c FROM ad_campaigns GROUP BY status`),
      };
    default:
      return { rows: [] };
  }
}
