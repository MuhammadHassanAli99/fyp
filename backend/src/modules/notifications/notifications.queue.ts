import { env } from '../../config/env';
import { uuid } from '../../core/security/crypto';
import { execute, insertAndGetId, queryRows, transaction, type Row } from '../../db/query';
import type { NotificationChannel, StoredPriority } from './notifications.types';

const MAX_ATTEMPTS = env.NOTIFICATION_MAX_ATTEMPTS;

export interface EnqueueJobInput {
  notificationId: number | null;
  userId: number;
  channel: NotificationChannel;
  priority: StoredPriority;
  availableAt?: Date | null;
  payload: Record<string, unknown>;
}

export async function enqueueNotificationJob(input: EnqueueJobInput): Promise<number> {
  return insertAndGetId(
    `INSERT INTO notification_jobs
       (uuid, notification_id, user_id, channel, priority, status, max_attempts, available_at, payload)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    [
      uuid(),
      input.notificationId,
      input.userId,
      input.channel,
      input.priority,
      MAX_ATTEMPTS,
      input.availableAt ?? new Date(),
      JSON.stringify(input.payload),
    ],
  );
}

export async function claimNotificationJobs(limit: number): Promise<Row[]> {
  return transaction(async (connection) => {
    const rows = await queryRows<Row>(
      `SELECT id FROM notification_jobs
        WHERE status IN ('queued','retrying')
          AND available_at <= CURRENT_TIMESTAMP
        ORDER BY FIELD(priority,'urgent','high','normal','low'), available_at
        LIMIT ?
        FOR UPDATE SKIP LOCKED`,
      [limit],
      connection,
    );
    if (rows.length === 0) return [];
    const ids = rows.map((row) => Number(row.id));
    const placeholders = ids.map(() => '?').join(',');
    await execute(
      `UPDATE notification_jobs
          SET status = 'processing', locked_at = CURRENT_TIMESTAMP
        WHERE id IN (${placeholders})`,
      ids,
      connection,
    );
    return queryRows<Row>(
      `SELECT * FROM notification_jobs WHERE id IN (${placeholders})`,
      ids,
      connection,
    );
  });
}

export function backoffSeconds(attempts: number): number {
  const caps = [60, 300, 900, 3600, 3600];
  return caps[Math.min(Math.max(attempts, 1), caps.length) - 1] ?? 3600;
}

export function isPermanentProviderError(code: string | null | undefined): boolean {
  const value = (code ?? '').toUpperCase();
  return [
    'INVALID_TOKEN',
    'UNREGISTERED',
    'EXPIRED_TOKEN',
    'BOUNCED',
    'REJECTED',
    'UNSUBSCRIBED',
    'INVALID_DESTINATION',
  ].includes(value);
}
