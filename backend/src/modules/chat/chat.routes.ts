import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { messagingRateLimit, writeRateLimit, aiRateLimit } from '../../middleware/rate-limit';
import { denyGuest } from '../../middleware/authorize';
import { storage } from '../../providers/storage';
import { queryOne, type Row } from '../../db/query';
import { notFound, forbidden } from '../../core/errors';
import {
  deleteMessage,
  editMessage,
  getConversationByUuid,
  getMessages,
  listConversations,
  markConversationRead,
  openListingConversation,
  sendMessage,
  syncMessages,
  updateConversationFlags,
} from './chat.service';
import { translateMessage } from './translation.service';
import { blockUser, listBlocked, unblockUser } from './blocks.service';
import { getPresence, setVisibility } from './presence.service';
import { reportCommunication } from './report.service';
import { verifyMediaReadToken } from './media.service';
import type { ClientMessageKind } from './chat.types';

export const chatRouter = Router();

const uuidParam = z.object({ uuid: z.string().uuid() });

const attachmentSchema = z.object({
  kind: z.enum(['image', 'video', 'audio', 'document', 'other']),
  url: z.string().max(512).optional(),
  storageKey: z.string().max(512).optional(),
  thumbUrl: z.string().max(512).optional(),
  fileName: z.string().max(255).optional(),
  mimeType: z.string().max(96).optional(),
  sizeBytes: z.coerce.number().int().positive().optional(),
  width: z.coerce.number().int().positive().optional(),
  height: z.coerce.number().int().positive().optional(),
  durationMs: z.coerce.number().int().positive().optional(),
  waveform: z.array(z.number()).max(256).optional(),
  codec: z.string().max(32).optional(),
});

const locationSchema = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  accuracy: z.number().min(0).max(50_000).optional(),
  timestamp: z.string().datetime().optional(),
  label: z.string().max(191).optional(),
  source: z.enum(['current', 'selected', 'listing']).optional(),
});

/** Signed media is authenticated by HMAC, not the session cookie. */
chatRouter.get(
  '/media/:token',
  validate({ params: z.object({ token: z.string().min(10).max(4096) }) }),
  asyncHandler(async (req, res) => {
    const { token } = params<{ token: string }>(req);
    const claims = verifyMediaReadToken(token);
    const attachment = await queryOne<Row>(
      `SELECT a.id, a.storage_key, a.mime_type, a.scan_status, a.message_id, m.conversation_id
         FROM message_attachments a
         JOIN messages m ON m.id = a.message_id
        WHERE a.id = ?`,
      [claims.attachmentId],
    );
    if (!attachment) throw notFound('Attachment');
    if (String(attachment.scan_status) === 'blocked') throw forbidden('This file is not available');
    const member = await queryOne<Row>(
      `SELECT user_id FROM conversation_participants
        WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL`,
      [Number(attachment.conversation_id), claims.userId],
    );
    if (!member) throw forbidden('You cannot access this file');
    const key = String(attachment.storage_key ?? '');
    if (!key) throw notFound('Attachment');
    const data = await storage.read(key);
    res.setHeader('Content-Type', String(attachment.mime_type ?? 'application/octet-stream'));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).end(data);
  }),
);

chatRouter.use(authenticate, requireAuth, denyGuest('use chat'));

chatRouter.get(
  '/conversations',
  validate({
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(30),
      archived: z.coerce.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { limit, archived } = query<{ limit: number; archived?: boolean }>(req);
    return ok(res, await listConversations(req.auth!.userId, limit, archived === true));
  }),
);

chatRouter.get(
  '/sync',
  validate({
    query: z.object({
      after: z.string().datetime(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { after, limit } = query<{ after: string; limit: number }>(req);
    return ok(res, await syncMessages(req.auth!.userId, new Date(after), limit));
  }),
);

chatRouter.post(
  '/conversations',
  writeRateLimit,
  validate({
    body: z.object({
      listingId: z.union([z.coerce.number().int().positive(), z.string().min(1)]),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ listingId: number | string }>(req);
    return created(
      res,
      await openListingConversation({
        buyerId: req.auth!.userId,
        listingIdOrUuid: input.listingId,
      }),
    );
  }),
);

chatRouter.get(
  '/conversations/:uuid',
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await getConversationByUuid(uuid, req.auth!.userId));
  }),
);

chatRouter.patch(
  '/conversations/:uuid',
  validate({
    params: uuidParam,
    body: z.object({
      muted: z.boolean().optional(),
      archived: z.boolean().optional(),
      pinned: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const patch = body<{ muted?: boolean; archived?: boolean; pinned?: boolean }>(req);
    return ok(res, await updateConversationFlags(uuid, req.auth!.userId, patch));
  }),
);

chatRouter.post(
  '/conversations/:uuid/read',
  validate({
    params: uuidParam,
    body: z.object({ lastReadMessageId: z.coerce.number().int().positive().optional() }).optional(),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const input = (req.valid?.body as { lastReadMessageId?: number } | undefined) ?? {};
    return ok(
      res,
      await markConversationRead(uuid, req.auth!.userId, input.lastReadMessageId ?? null, req.device?.id ?? null),
    );
  }),
);

chatRouter.get(
  '/conversations/:uuid/messages',
  validate({
    params: uuidParam,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      beforeId: z.coerce.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const { limit, beforeId } = query<{ limit: number; beforeId?: number }>(req);
    const conversation = await getConversationByUuid(uuid, req.auth!.userId);
    return ok(res, await getMessages(conversation.id, req.auth!.userId, limit, beforeId ?? null));
  }),
);

chatRouter.post(
  '/conversations/:uuid/messages',
  messagingRateLimit,
  validate({
    params: uuidParam,
    body: z.object({
      kind: z.enum(['text', 'image', 'video', 'voice', 'audio', 'document', 'location']).default('text'),
      body: z.string().trim().max(5000).optional(),
      clientMessageId: z.string().uuid().optional(),
      replyToId: z.coerce.number().int().positive().optional(),
      attachments: z.array(attachmentSchema).max(6).optional(),
      durationMs: z.coerce.number().int().positive().optional(),
      location: locationSchema.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const input = body<{
      kind: ClientMessageKind;
      body?: string;
      clientMessageId?: string;
      replyToId?: number;
      attachments?: Array<{
        kind: 'image' | 'video' | 'audio' | 'document' | 'other';
        url?: string;
        storageKey?: string;
        thumbUrl?: string;
        fileName?: string;
        mimeType?: string;
        sizeBytes?: number;
        width?: number;
        height?: number;
        durationMs?: number;
        waveform?: number[];
        codec?: string;
      }>;
      durationMs?: number;
      location?: {
        latitude: number;
        longitude: number;
        accuracy?: number;
        timestamp?: string;
        label?: string;
        source?: 'current' | 'selected' | 'listing';
      };
    }>(req);

    const conversation = await getConversationByUuid(uuid, req.auth!.userId);
    const message = await sendMessage({
      conversationId: conversation.id,
      senderId: req.auth!.userId,
      kind: input.kind,
      body: input.body ?? null,
      clientMessageId: input.clientMessageId ?? null,
      replyToId: input.replyToId ?? null,
      attachments: input.attachments,
      durationMs: input.durationMs ?? null,
      location: input.location ?? null,
    });
    return created(res, message);
  }),
);

chatRouter.patch(
  '/conversations/:uuid/messages/:messageId',
  writeRateLimit,
  validate({
    params: z.object({ uuid: z.string().uuid(), messageId: z.coerce.number().int().positive() }),
    body: z.object({ body: z.string().trim().min(1).max(5000) }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid, messageId } = params<{ uuid: string; messageId: number }>(req);
    const { body: next } = body<{ body: string }>(req);
    const conversation = await getConversationByUuid(uuid, req.auth!.userId);
    return ok(
      res,
      await editMessage({
        conversationId: conversation.id,
        messageId,
        userId: req.auth!.userId,
        body: next,
      }),
    );
  }),
);

chatRouter.delete(
  '/conversations/:uuid/messages/:messageId',
  writeRateLimit,
  validate({
    params: z.object({ uuid: z.string().uuid(), messageId: z.coerce.number().int().positive() }),
    query: z.object({ type: z.enum(['for_me', 'for_everyone']).default('for_me') }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid, messageId } = params<{ uuid: string; messageId: number }>(req);
    const { type } = query<{ type: 'for_me' | 'for_everyone' }>(req);
    const conversation = await getConversationByUuid(uuid, req.auth!.userId);
    return ok(
      res,
      await deleteMessage({
        conversationId: conversation.id,
        messageId,
        userId: req.auth!.userId,
        type,
      }),
    );
  }),
);

chatRouter.post(
  '/conversations/:uuid/messages/:messageId/translate',
  aiRateLimit,
  validate({
    params: z.object({ uuid: z.string().uuid(), messageId: z.coerce.number().int().positive() }),
    body: z.object({ targetLanguage: z.string().trim().min(2).max(10) }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid, messageId } = params<{ uuid: string; messageId: number }>(req);
    const { targetLanguage } = body<{ targetLanguage: string }>(req);
    const conversation = await getConversationByUuid(uuid, req.auth!.userId);
    return ok(
      res,
      await translateMessage({
        messageId,
        conversationId: conversation.id,
        userId: req.auth!.userId,
        targetLanguage,
      }),
    );
  }),
);

chatRouter.get(
  '/blocks',
  asyncHandler(async (req, res) => ok(res, await listBlocked(req.auth!.userId))),
);

chatRouter.post(
  '/blocks',
  writeRateLimit,
  validate({
    body: z.object({
      userId: z.coerce.number().int().positive(),
      reason: z.string().trim().max(255).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ userId: number; reason?: string }>(req);
    return ok(res, await blockUser(req.auth!.userId, input.userId, input.reason ?? null));
  }),
);

chatRouter.delete(
  '/blocks/:userId',
  writeRateLimit,
  validate({ params: z.object({ userId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { userId } = params<{ userId: number }>(req);
    return ok(res, await unblockUser(req.auth!.userId, userId));
  }),
);

chatRouter.post(
  '/reports',
  writeRateLimit,
  validate({
    body: z.object({
      entityType: z.enum(['user', 'message', 'conversation', 'listing']),
      entityId: z.coerce.number().int().positive(),
      reasonCode: z.string().trim().min(1).max(64),
      description: z.string().trim().max(1000).optional(),
      conversationUuid: z.string().uuid().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      entityType: 'user' | 'message' | 'conversation' | 'listing';
      entityId: number;
      reasonCode: string;
      description?: string;
      conversationUuid?: string;
    }>(req);
    return created(
      res,
      await reportCommunication({
        reporterId: req.auth!.userId,
        ...input,
      }),
    );
  }),
);

chatRouter.get(
  '/presence/:userId',
  validate({ params: z.object({ userId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { userId } = params<{ userId: number }>(req);
    return ok(res, await getPresence(userId));
  }),
);

chatRouter.post(
  '/presence/visibility',
  validate({ body: z.object({ visible: z.boolean() }) }),
  asyncHandler(async (req, res) => {
    const { visible } = body<{ visible: boolean }>(req);
    await setVisibility(req.auth!.userId, visible);
    return ok(res, { visible });
  }),
);
