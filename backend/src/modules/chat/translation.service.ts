import { env } from '../../config/env';
import { execute, insertAndGetId, queryOne, type Row } from '../../db/query';
import { forbidden, notFound } from '../../core/errors';
import { loggerFor } from '../../config/logger';
import { throughGateway } from '../ai/ai.gateway';
import { translateCached } from '../ai/ai.capabilities';
import { assertParticipant } from './chat.access';

const log = loggerFor('chat.translation');

/**
 * Translation is a separate service with a provider abstraction (`ai.translate`).
 * Original message body is never overwritten.
 */
export async function translateMessage(params: {
  messageId: number;
  conversationId: number;
  userId: number;
  targetLanguage: string;
}) {
  await assertParticipant(params.conversationId, params.userId);

  const message = await queryOne<Row>(
    `SELECT id, body, deleted_at, deleted_for_everyone
       FROM messages WHERE id = ? AND conversation_id = ?`,
    [params.messageId, params.conversationId],
  );
  if (!message) throw notFound('Message');
  if (message.deleted_at && Number(message.deleted_for_everyone) === 1) {
    throw forbidden('Deleted messages cannot be translated');
  }
  const original = (message.body as string | null)?.trim();
  if (!original) throw forbidden('This message has no translatable text');

  const target = params.targetLanguage.trim().slice(0, 10).toLowerCase();
  const cached = await queryOne<Row>(
    `SELECT translated_body, source_language, provider, confidence
       FROM message_translations
      WHERE message_id = ? AND target_language = ?`,
    [params.messageId, target],
  );
  if (cached) {
    return {
      original,
      translated: String(cached.translated_body),
      sourceLanguage: (cached.source_language as string | null) ?? null,
      targetLanguage: target,
      provider: (cached.provider as string | null) ?? null,
      confidence: cached.confidence === null ? null : Number(cached.confidence),
      cached: true,
    };
  }

  try {
    const gated = await throughGateway({ userId: params.userId }, {
      task: 'translate',
      input: { messageId: params.messageId, target },
      run: (driver) => translateCached(driver, original, target),
    });
    if ('accepted' in gated) {
      return {
        original,
        translated: original,
        sourceLanguage: null,
        targetLanguage: target,
        provider: env.AI_PROVIDER,
        confidence: 0,
        cached: false,
        unavailable: true,
      };
    }
    const result = gated.result;
    await insertAndGetId(
      `INSERT INTO message_translations
         (message_id, target_language, translated_body, source_language, provider, confidence)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE translated_body = VALUES(translated_body),
         source_language = VALUES(source_language), provider = VALUES(provider), confidence = VALUES(confidence)`,
      [params.messageId, target, result.text, result.sourceLanguage, result.model, result.confidence],
    );
    return {
      original,
      translated: result.text,
      sourceLanguage: result.sourceLanguage,
      targetLanguage: target,
      provider: result.model,
      confidence: result.confidence,
      cached: false,
    };
  } catch (error) {
    log.warn({ err: error, messageId: params.messageId }, 'translation failed');
    return {
      original,
      translated: original,
      sourceLanguage: null,
      targetLanguage: target,
      provider: env.AI_PROVIDER,
      confidence: 0,
      cached: false,
      unavailable: true,
    };
  }
}
