import { execute, insertAndGetId, queryRows, queryCount, type Row } from '../../db/query';
import { env } from '../../config/env';
import { cache } from '../../config/cache';

export async function upsertAccessList(input: {
  listKind: 'blacklist' | 'whitelist' | 'greylist';
  entryKind: string;
  value: string;
  reason: string;
  source?: 'manual' | 'automated' | 'partner' | 'regulator';
  severity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  expiresAt?: string | null;
  untilReview?: boolean;
  addedBy?: number | null;
}): Promise<number> {
  if (env.isProduction && input.source === 'manual' && input.value.startsWith('dev-')) {
    throw new Error('Development list entries cannot be written in production');
  }
  const id = await insertAndGetId(
    `INSERT INTO access_lists
       (list_kind, entry_kind, value_text, reason, source, severity, expires_at, until_review, added_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       reason = VALUES(reason), severity = VALUES(severity), expires_at = VALUES(expires_at),
       until_review = VALUES(until_review), id = LAST_INSERT_ID(id)`,
    [
      input.listKind,
      input.entryKind,
      input.value.slice(0, 255),
      input.reason.slice(0, 500),
      input.source ?? 'manual',
      input.severity ?? 'medium',
      input.expiresAt ?? null,
      input.untilReview ? 1 : 0,
      input.addedBy ?? null,
    ],
  );
  await cache.delPrefix(`risk:${input.listKind}:`);
  await cache.delPrefix(`blacklist:`);
  return id;
}

export async function listAccessEntries(params: {
  listKind?: string;
  entryKind?: string;
  limit?: number;
}) {
  const clauses = ['1=1'];
  const values: unknown[] = [];
  if (params.listKind) {
    clauses.push('list_kind = ?');
    values.push(params.listKind);
  }
  if (params.entryKind) {
    clauses.push('entry_kind = ?');
    values.push(params.entryKind);
  }
  values.push(params.limit ?? 100);
  return queryRows<Row>(
    `SELECT id, list_kind, entry_kind, value_text, reason, source, severity, expires_at, until_review,
            appeal_status, created_at
       FROM access_lists
      WHERE ${clauses.join(' AND ')}
      ORDER BY id DESC
      LIMIT ?`,
    values,
  );
}

export async function appealAccessList(id: number, note: string): Promise<void> {
  await execute(
    `UPDATE access_lists SET appeal_status = 'submitted', reason = CONCAT(IFNULL(reason,''), ' | appeal: ', ?) WHERE id = ?`,
    [note.slice(0, 200), id],
  );
}

export async function countActiveBlacklist(): Promise<number> {
  return queryCount(
    `SELECT COUNT(*) FROM access_lists
      WHERE list_kind = 'blacklist' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
  );
}
