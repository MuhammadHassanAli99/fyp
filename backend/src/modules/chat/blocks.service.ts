import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { badRequest, forbidden } from '../../core/errors';
import { loggerFor } from '../../config/logger';

const log = loggerFor('chat.blocks');

/**
 * Centralised block graph. Chat, calls, notifications and listing contact
 * all call this — Flutter is not an enforcement point.
 */
export async function isBlockedEitherWay(userA: number, userB: number): Promise<boolean> {
  if (userA === userB) return false;
  const row = await queryOne<Row>(
    `SELECT 1 AS ok
       FROM blocked_users
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
      LIMIT 1`,
    [userA, userB, userB, userA],
  );
  return Boolean(row);
}

export async function assertNotBlocked(actorId: number, otherId: number, action = 'contact this user'): Promise<void> {
  if (await isBlockedEitherWay(actorId, otherId)) {
    throw forbidden(`You cannot ${action}`);
  }
}

export async function blockUser(blockerId: number, blockedId: number, reason?: string | null) {
  if (blockerId === blockedId) throw badRequest('You cannot block yourself');
  await execute(
    `INSERT INTO blocked_users (blocker_id, blocked_id, reason)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE reason = COALESCE(VALUES(reason), reason)`,
    [blockerId, blockedId, reason ?? null],
  );

  await execute(
    `UPDATE conversations c
        JOIN conversation_participants a ON a.conversation_id = c.id AND a.user_id = ? AND a.left_at IS NULL
        JOIN conversation_participants b ON b.conversation_id = c.id AND b.user_id = ? AND b.left_at IS NULL
        SET c.status = 'blocked'
      WHERE c.status = 'active'`,
    [blockerId, blockedId],
  );

  log.info({ blockerId, blockedId }, 'user blocked');
  await audit(blockerId, 'block_user', 'user', blockedId);
  return { blocked: true };
}

export async function unblockUser(blockerId: number, blockedId: number) {
  await execute('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?', [blockerId, blockedId]);

  await execute(
    `UPDATE conversations c
        JOIN conversation_participants a ON a.conversation_id = c.id AND a.user_id = ? AND a.left_at IS NULL
        JOIN conversation_participants b ON b.conversation_id = c.id AND b.user_id = ? AND b.left_at IS NULL
        SET c.status = 'active'
      WHERE c.status = 'blocked'
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users bu
           WHERE (bu.blocker_id = a.user_id AND bu.blocked_id = b.user_id)
              OR (bu.blocker_id = b.user_id AND bu.blocked_id = a.user_id)
        )`,
    [blockerId, blockedId],
  );

  log.info({ blockerId, blockedId }, 'user unblocked');
  await audit(blockerId, 'unblock_user', 'user', blockedId);
  return { blocked: false };
}

export async function listBlocked(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT bu.blocked_id AS id, bu.reason, bu.created_at,
            COALESCE(p.display_name, u.username, CONCAT('User ', bu.blocked_id)) AS name,
            p.avatar_url
       FROM blocked_users bu
       JOIN users u ON u.id = bu.blocked_id
       LEFT JOIN user_profiles p ON p.user_id = bu.blocked_id
      WHERE bu.blocker_id = ?
      ORDER BY bu.created_at DESC`,
    [userId],
  );
  return rows.map((row) => ({
    userId: Number(row.id),
    name: (row.name as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}

async function audit(actorId: number, action: string, entityType: string, entityId: number): Promise<void> {
  try {
    await insertAndGetId(
      `INSERT INTO communication_audit_logs (actor_id, action, entity_type, entity_id)
       VALUES (?, ?, ?, ?)`,
      [actorId, action, entityType, entityId],
    );
  } catch {
    // Table arrives with 028; older test processes without it must not crash chat.
  }
}
