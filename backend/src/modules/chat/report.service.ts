import { execute, insertAndGetId, queryOne, type Row } from '../../db/query';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { submitReport } from '../moderation/moderation.service';
import { orchestrate } from '../ai/ai.orchestrator';
import { loggerFor } from '../../config/logger';
import { assertParticipant, requireConversation } from './chat.access';

const log = loggerFor('chat.report');

const REASONS = new Set([
  'spam',
  'fraud',
  'scam',
  'fake',
  'offensive',
  'adult',
  'violence',
  'copyright',
  'wrong_category',
  'wrong_price',
  'sold_already',
  'duplicate',
  'misleading',
  'personal_info',
  'harassment',
  'other',
]);

export async function reportCommunication(params: {
  reporterId: number;
  entityType: 'user' | 'message' | 'conversation' | 'listing';
  entityId: number;
  reasonCode: string;
  description?: string | null;
  conversationUuid?: string;
}) {
  const reasonCode = REASONS.has(params.reasonCode) ? params.reasonCode : 'other';
  let marketplaceId: number | null = null;
  let entityId = params.entityId;

  if (params.entityType === 'message') {
    const message = await queryOne<Row>(
      `SELECT m.id, m.body, m.conversation_id, c.marketplace_id
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE m.id = ?`,
      [params.entityId],
    );
    if (!message) throw notFound('Message');
    await assertParticipant(Number(message.conversation_id), params.reporterId);
    marketplaceId = message.marketplace_id == null ? null : Number(message.marketplace_id);
    void screenText((message.body as string | null) ?? '', 'message', Number(message.id));
  } else if (params.entityType === 'conversation') {
    const conversation = params.conversationUuid
      ? await requireConversation(params.conversationUuid, params.reporterId)
      : await queryOne<Row>(
          `SELECT c.id, c.marketplace_id FROM conversations c
             JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = ?
            WHERE c.id = ?`,
          [params.reporterId, params.entityId],
        );
    if (!conversation) throw notFound('Conversation');
    entityId = Number(conversation.id);
    marketplaceId = conversation.marketplace_id == null ? null : Number(conversation.marketplace_id);
  } else if (params.entityType === 'user') {
    if (entityId === params.reporterId) throw badRequest('You cannot report yourself');
  }

  const result = await submitReport({
    reporterId: params.reporterId,
    entityType: params.entityType === 'conversation' ? 'conversation' : params.entityType,
    entityId,
    reasonCode,
    description: params.description ?? null,
    marketplaceId,
  });

  try {
    await insertAndGetId(
      `INSERT INTO communication_audit_logs (actor_id, action, entity_type, entity_id, metadata)
       VALUES (?, 'report', ?, ?, ?)`,
      [
        params.reporterId,
        params.entityType,
        entityId,
        JSON.stringify({ reasonCode, reportId: result.reportId }),
      ],
    );
  } catch {
    /* 028 table */
  }

  return result;
}

async function screenText(text: string, context: 'message' | 'listing', entityId: number) {
  if (!text.trim()) return;
  try {
    const result = await orchestrate(
      {
        task: 'spam_detect',
        privacy: 'strict',
        skipEntitlement: true,
        skipQuota: true,
        entityType: context,
        entityId,
        input: { length: text.length },
      },
      (driver) => driver.moderate({ text, language: 'auto', context: context === 'message' ? 'message' : 'listing' }),
    );
    if (result.result.decision === 'reject') {
      log.warn({ entityId, context, scores: result.result.scores }, 'AI flagged content; queued for human review, no auto-ban');
    }
  } catch (error) {
    log.debug({ err: error }, 'AI moderation skipped');
  }
}

export { forbidden };
