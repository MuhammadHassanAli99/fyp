import { queryOne, queryRows, type Row } from '../../db/query';
import { forbidden, notFound } from '../../core/errors';

export async function assertParticipant(conversationId: number, userId: number): Promise<void> {
  const participant = await queryOne<Row>(
    `SELECT user_id FROM conversation_participants
      WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL`,
    [conversationId, userId],
  );
  if (!participant) throw forbidden('You are not a participant in this conversation');
}

export async function requireConversation(conversationUuid: string, userId: number): Promise<Row> {
  const row = await queryOne<Row>(
    `SELECT c.*, cp.unread_count, cp.is_pinned, cp.is_archived, cp.is_muted,
            cp.last_read_message_id, cp.last_read_at, cp.notification_level
       FROM conversations c
       JOIN conversation_participants cp
         ON cp.conversation_id = c.id AND cp.user_id = ? AND cp.left_at IS NULL
      WHERE c.uuid = ?`,
    [userId, conversationUuid],
  );
  if (!row) throw notFound('Conversation');
  return row;
}

export async function loadPeerIds(conversationId: number, exceptUserId?: number | null): Promise<number[]> {
  const rows = await queryRows<Row>(
    `SELECT user_id FROM conversation_participants
      WHERE conversation_id = ? AND left_at IS NULL
        AND (? IS NULL OR user_id <> ?)`,
    [conversationId, exceptUserId ?? null, exceptUserId ?? null],
  );
  return rows.map((row) => Number(row.user_id));
}
