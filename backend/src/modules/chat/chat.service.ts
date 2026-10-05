import { env } from '../../config/env';
import { execute, insertAndGetId, queryOne, queryRows, transaction, type Row } from '../../db/query';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { uuid } from '../../core/security/crypto';
import { eventBus } from '../../core/events/event-bus';
import { emitToConversation, emitToUser } from '../../realtime/socket';
import { loggerFor } from '../../config/logger';
import { enqueueListingAnalytics } from '../listings/listings.analytics';
import { recordListingLead } from '../seller/seller.leads-ingest';
import { notifyUser } from '../notifications/notify';
import { assertNotBlocked, isBlockedEitherWay } from './blocks.service';
import { getPresence, getPresenceMap } from './presence.service';
import {
  assertOwnedStorageRef,
  kindFromMime,
  scanStoredObject,
  signedAttachmentUrls,
} from './media.service';
import { assertParticipant, loadPeerIds, requireConversation } from './chat.access';
import {
  attachmentKindForMessage,
  conversationTypeFromListing,
  previewFor,
  type AttachmentInput,
  type ClientMessageKind,
  type ConversationType,
  type DeletionType,
  type LocationContent,
  type MessageKind,
  type PublicAttachment,
  type PublicConversation,
  type PublicMessage,
} from './chat.types';

const log = loggerFor('chat');

export type { MessageKind, AttachmentInput, PublicMessage, PublicConversation };

const CONVERSATION_SELECT = `
  SELECT c.id, c.uuid, c.kind, c.conversation_type, c.subject, c.listing_id, c.marketplace_id,
         c.business_id, c.last_message_id, c.last_message_at, c.last_message_preview,
         c.message_count, c.status,
         cp.unread_count, cp.is_pinned, cp.is_archived, cp.is_muted,
         cp.last_read_message_id, cp.last_read_at,
         l.title AS listing_title, l.uuid AS listing_uuid,
         l.latitude AS listing_lat, l.longitude AS listing_lng,
         mp.code AS marketplace_code,
         peer.user_id AS peer_id,
         COALESCE(bp.display_name, bu.username, bu.email, CONCAT('User ', peer.user_id)) AS peer_name,
         bp.avatar_url AS peer_avatar
    FROM conversation_participants cp
    JOIN conversations c ON c.id = cp.conversation_id
    LEFT JOIN listings l ON l.id = c.listing_id
    LEFT JOIN marketplaces mp ON mp.id = c.marketplace_id
    LEFT JOIN conversation_participants peer
      ON peer.conversation_id = c.id AND peer.user_id <> cp.user_id AND peer.left_at IS NULL
    LEFT JOIN users bu ON bu.id = peer.user_id
    LEFT JOIN user_profiles bp ON bp.user_id = peer.user_id
`;

export async function listConversations(userId: number, limit = 30, includeArchived = false) {
  const rows = await queryRows<Row>(
    `${CONVERSATION_SELECT}
      WHERE cp.user_id = ? AND cp.left_at IS NULL ${includeArchived ? '' : 'AND cp.is_archived = 0'}
      ORDER BY cp.is_pinned DESC, c.last_message_at DESC
      LIMIT ?`,
    [userId, limit],
  );
  return hydrateConversations(rows);
}

export async function getConversationByUuid(conversationUuid: string, userId: number) {
  const row = await queryOne<Row>(
    `${CONVERSATION_SELECT}
      WHERE c.uuid = ? AND cp.user_id = ? AND cp.left_at IS NULL`,
    [conversationUuid, userId],
  );
  if (!row) throw notFound('Conversation');
  const [mapped] = await hydrateConversations([row]);
  return mapped!;
}

export async function openListingConversation(params: {
  buyerId: number;
  listingIdOrUuid: string | number;
}) {
  const listing = await queryOne<Row>(
    `SELECT l.id, l.uuid, l.user_id, l.title, l.marketplace_id, l.allow_chat, l.status,
            l.operation, l.business_id, b.kind AS business_kind
       FROM listings l
       LEFT JOIN business_profiles b ON b.id = l.business_id
      WHERE l.deleted_at IS NULL AND (l.id = ? OR l.uuid = ?)`,
    [Number(params.listingIdOrUuid) || 0, String(params.listingIdOrUuid)],
  );
  if (!listing) throw notFound('Listing');
  if (listing.status !== 'published') throw badRequest('This listing is not available for chat');
  if (Number(listing.allow_chat) === 0) throw badRequest('The seller has disabled chat for this listing');

  const sellerId = Number(listing.user_id);
  if (sellerId === params.buyerId) throw badRequest('You cannot start a chat on your own listing');
  await assertNotBlocked(params.buyerId, sellerId, 'message this seller');

  const existing = await queryOne<Row>(
    `SELECT c.uuid
       FROM conversations c
       JOIN conversation_participants buyer
         ON buyer.conversation_id = c.id AND buyer.user_id = ? AND buyer.left_at IS NULL
       JOIN conversation_participants seller
         ON seller.conversation_id = c.id AND seller.user_id = ? AND seller.left_at IS NULL
      WHERE c.listing_id = ? AND c.kind = 'listing' AND c.status IN ('active','blocked')
      LIMIT 1`,
    [params.buyerId, sellerId, Number(listing.id)],
  );
  if (existing) return getConversationByUuid(String(existing.uuid), params.buyerId);

  const conversationType = conversationTypeFromListing({
    operation: (listing.operation as string | null) ?? null,
    businessKind: (listing.business_kind as string | null) ?? null,
  });
  const conversationUuid = uuid();
  const conversationId = await insertAndGetId(
    `INSERT INTO conversations
       (uuid, marketplace_id, listing_id, business_id, kind, conversation_type, subject, created_by, status)
     VALUES (?, ?, ?, ?, 'listing', ?, ?, ?, 'active')`,
    [
      conversationUuid,
      Number(listing.marketplace_id),
      Number(listing.id),
      listing.business_id === null ? null : Number(listing.business_id),
      conversationType,
      String(listing.title).slice(0, 191),
      params.buyerId,
    ],
  );

  await execute(
    `INSERT INTO conversation_participants (conversation_id, user_id, participant_role)
     VALUES (?, ?, 'member'), (?, ?, 'owner')`,
    [conversationId, params.buyerId, conversationId, sellerId],
  );

  await sendMessage({
    conversationId,
    senderId: null,
    kind: 'system',
    body: 'Conversation started',
  });

  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'conversation.created', 'conversation', conversationId, {
      conversationId,
      listingId: Number(listing.id),
      participantIds: [params.buyerId, sellerId],
    });
    void eventBus.publishAfterCommit(event);
  }).catch((error) => log.debug({ err: error }, 'conversation.created event skipped'));

  void enqueueListingAnalytics({
    listingId: Number(listing.id),
    eventType: 'message',
    actorUserId: params.buyerId,
    source: 'chat.open',
  }).catch(() => undefined);

  void recordListingLead({
    listingId: Number(listing.id),
    buyerId: params.buyerId,
    channel: 'chat',
  });

  return getConversationByUuid(conversationUuid, params.buyerId);
}

export async function getMessages(
  conversationId: number,
  userId: number,
  limit = 50,
  beforeId?: number | null,
) {
  await assertParticipant(conversationId, userId);

  const rows = await queryRows<Row>(
    `SELECT m.id, m.uuid, m.conversation_id, m.sender_id, m.kind, m.body, m.reply_to_id,
            m.latitude, m.longitude, m.location_accuracy, m.location_label, m.location_at,
            m.is_edited, m.edited_at, m.deleted_at, m.deleted_by, m.deletion_type,
            m.deleted_for_everyone, m.status, m.created_at, m.updated_at, m.metadata
       FROM messages m
       LEFT JOIN message_hides h ON h.message_id = m.id AND h.user_id = ?
      WHERE m.conversation_id = ?
        AND h.message_id IS NULL
        AND (? IS NULL OR m.id < ?)
      ORDER BY m.id DESC
      LIMIT ?`,
    [userId, conversationId, beforeId ?? null, beforeId ?? null, limit],
  );

  const messages = rows.reverse();
  if (messages.length === 0) return [] as PublicMessage[];
  return assembleMessages(messages, userId);
}

export async function syncMessages(userId: number, after: Date, limit = 100) {
  const rows = await queryRows<Row>(
    `SELECT m.id, m.uuid, m.conversation_id, m.sender_id, m.kind, m.body, m.reply_to_id,
            m.latitude, m.longitude, m.location_accuracy, m.location_label, m.location_at,
            m.is_edited, m.edited_at, m.deleted_at, m.deleted_by, m.deletion_type,
            m.deleted_for_everyone, m.status, m.created_at, m.updated_at, m.metadata,
            c.uuid AS conversation_uuid
       FROM messages m
       JOIN conversation_participants cp
         ON cp.conversation_id = m.conversation_id AND cp.user_id = ? AND cp.left_at IS NULL
       JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN message_hides h ON h.message_id = m.id AND h.user_id = ?
      WHERE h.message_id IS NULL
        AND (m.created_at > ? OR m.updated_at > ? OR m.edited_at > ? OR m.deleted_at > ?)
      ORDER BY m.id ASC
      LIMIT ?`,
    [userId, userId, after, after, after, after, limit],
  );
  if (rows.length === 0) return [];
  const assembled = await assembleMessages(rows, userId);
  return assembled.map((message, index) => ({
    ...message,
    conversationUuid: String(rows[index]!.conversation_uuid),
  }));
}

export async function sendTextMessage(params: {
  conversationId: number;
  senderId: number;
  body: string;
  clientMessageId?: string | null;
  replyToId?: number | null;
}) {
  return sendMessage({
    conversationId: params.conversationId,
    senderId: params.senderId,
    kind: 'text',
    body: params.body,
    clientMessageId: params.clientMessageId,
    replyToId: params.replyToId,
  });
}

export async function sendMessage(params: {
  conversationId: number;
  senderId: number | null;
  kind: MessageKind;
  body?: string | null;
  clientMessageId?: string | null;
  attachments?: AttachmentInput[];
  durationMs?: number | null;
  replyToId?: number | null;
  location?: LocationContent | null;
  metadata?: Record<string, unknown> | null;
}) {
  if (params.senderId !== null) {
    await assertParticipant(params.conversationId, params.senderId);
    await assertConversationWritable(params.conversationId, params.senderId);
  }

  if (params.clientMessageId) {
    const existing = await queryOne<Row>('SELECT id FROM messages WHERE client_message_id = ?', [
      params.clientMessageId,
    ]);
    if (existing) {
      const [mapped] = await assembleMessages(
        [
          (await queryOne<Row>('SELECT * FROM messages WHERE id = ?', [Number(existing.id)]))!,
        ],
        params.senderId ?? 0,
      );
      return mapped!;
    }
  }

  validatePayload(params);

  const replyToId = params.replyToId ?? null;
  if (replyToId) {
    const reply = await queryOne<Row>(
      'SELECT id FROM messages WHERE id = ? AND conversation_id = ?',
      [replyToId, params.conversationId],
    );
    if (!reply) throw badRequest('Reply target is not in this conversation');
  }

  const processedAttachments = await prepareAttachments(params.senderId, params.kind, params.attachments);

  const messageUuid = uuid();
  const preview = previewFor(params.kind, params.body);
  const loc = params.location;

  const messageId = await insertAndGetId(
    `INSERT INTO messages
       (uuid, conversation_id, sender_id, kind, body, reply_to_id, client_message_id, status,
        latitude, longitude, location_accuracy, location_label, location_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?, ?, ?)`,
    [
      messageUuid,
      params.conversationId,
      params.senderId,
      params.kind,
      params.body?.trim() || null,
      replyToId,
      params.clientMessageId ?? null,
      loc?.latitude ?? null,
      loc?.longitude ?? null,
      loc?.accuracy ?? null,
      loc?.label ?? null,
      loc?.timestamp ? new Date(loc.timestamp) : loc ? new Date() : null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ],
  );

  for (const item of processedAttachments) {
    const scan = item.storageKey
      ? await scanStoredObject(item.storageKey, item.mimeType ?? 'application/octet-stream', item.fileName)
      : { verdict: 'skipped' as const };
    if (scan.verdict === 'blocked') {
      throw badRequest('This file was blocked by media security checks');
    }
    await insertAndGetId(
      `INSERT INTO message_attachments
         (message_id, kind, url, storage_key, thumb_url, thumbnail_key, file_name, mime_type,
          size_bytes, width, height, duration_ms, waveform, codec, upload_status, scan_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
      [
        messageId,
        item.kind,
        item.url ?? '',
        item.storageKey ?? null,
        item.thumbUrl ?? null,
        item.thumbnailKey ?? null,
        item.fileName ?? null,
        item.mimeType ?? null,
        item.sizeBytes ?? null,
        item.width ?? null,
        item.height ?? null,
        item.durationMs ?? params.durationMs ?? null,
        item.waveform ? JSON.stringify(item.waveform) : null,
        item.codec ?? null,
        scan.verdict === 'clean' ? 'clean' : scan.verdict === 'skipped' ? 'skipped' : 'pending',
      ],
    );
  }

  await execute(
    `UPDATE conversations
        SET last_message_id = ?, last_message_at = CURRENT_TIMESTAMP,
            last_message_preview = LEFT(?, 255), message_count = message_count + 1
      WHERE id = ?`,
    [messageId, preview, params.conversationId],
  );

  if (params.senderId !== null) {
    await execute(
      `UPDATE conversation_participants
          SET unread_count = unread_count + 1
        WHERE conversation_id = ? AND user_id <> ? AND left_at IS NULL`,
      [params.conversationId, params.senderId],
    );
  }

  const row = await queryOne<Row>('SELECT * FROM messages WHERE id = ?', [messageId]);
  const [mapped] = await assembleMessages([row!], params.senderId ?? 0);

  const conversation = await queryOne<Row>(
    'SELECT uuid, listing_id FROM conversations WHERE id = ?',
    [params.conversationId],
  );
  const conversationUuid = conversation ? String(conversation.uuid) : null;
  if (conversationUuid) {
    emitToConversation(conversationUuid, 'message:new', mapped);
  }

  const peers = await loadPeerIds(params.conversationId, params.senderId);
  for (const peerId of peers) {
    emitToUser(peerId, 'chat:inbox', {
      conversationUuid,
      preview,
      messageId,
    });
  }

  if (params.senderId !== null) {
    await transaction(async (connection) => {
      const event = await eventBus.enqueue(connection, 'message.sent', 'message', messageId, {
        messageId,
        conversationId: params.conversationId,
        senderId: params.senderId,
        recipientIds: peers,
        kind: params.kind,
      });
      void eventBus.publishAfterCommit(event);
    }).catch((error) => log.debug({ err: error }, 'message.sent event skipped'));

    if (conversation?.listing_id) {
      void enqueueListingAnalytics({
        listingId: Number(conversation.listing_id),
        eventType: 'message',
        actorUserId: params.senderId,
        source: 'chat.send',
      }).catch(() => undefined);
      if (params.kind !== 'system' && params.kind !== 'call_log') {
        void recordListingLead({
          listingId: Number(conversation.listing_id),
          buyerId: params.senderId,
          channel: 'chat',
          message: params.body,
        });
      }
    }
  }

  return mapped!;
}

export async function editMessage(params: {
  conversationId: number;
  messageId: number;
  userId: number;
  body: string;
}) {
  await assertParticipant(params.conversationId, params.userId);
  const message = await queryOne<Row>(
    `SELECT id, sender_id, kind, body, created_at, deleted_at
       FROM messages WHERE id = ? AND conversation_id = ?`,
    [params.messageId, params.conversationId],
  );
  if (!message) throw notFound('Message');
  if (Number(message.sender_id) !== params.userId) throw forbidden('Only the sender can edit this message');
  if (String(message.kind) !== 'text') throw badRequest('Only text messages can be edited');
  if (message.deleted_at) throw badRequest('Deleted messages cannot be edited');
  const createdAt = new Date(message.created_at as Date).getTime();
  if (Date.now() - createdAt > env.MESSAGE_EDIT_WINDOW_MINUTES * 60_000) {
    throw forbidden('The edit window for this message has closed');
  }
  const next = params.body.trim();
  if (!next) throw badRequest('Message body is required');

  await insertAndGetId(
    `INSERT INTO message_revisions (message_id, body, edited_by) VALUES (?, ?, ?)`,
    [params.messageId, (message.body as string | null) ?? null, params.userId],
  );
  await execute(
    `UPDATE messages
        SET body = ?, is_edited = 1, edited_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [next, params.messageId],
  );

  const row = await queryOne<Row>('SELECT * FROM messages WHERE id = ?', [params.messageId]);
  const [mapped] = await assembleMessages([row!], params.userId);
  const conversation = await queryOne<Row>('SELECT uuid FROM conversations WHERE id = ?', [params.conversationId]);
  if (conversation) emitToConversation(String(conversation.uuid), 'message:edited', mapped);
  return mapped!;
}

export async function deleteMessage(params: {
  conversationId: number;
  messageId: number;
  userId: number;
  type: 'for_me' | 'for_everyone';
}) {
  await assertParticipant(params.conversationId, params.userId);
  const message = await queryOne<Row>(
    `SELECT id, sender_id, created_at, deleted_at FROM messages WHERE id = ? AND conversation_id = ?`,
    [params.messageId, params.conversationId],
  );
  if (!message) throw notFound('Message');

  if (params.type === 'for_me') {
    await execute(
      `INSERT IGNORE INTO message_hides (message_id, user_id) VALUES (?, ?)`,
      [params.messageId, params.userId],
    );
    return { deleted: true, deletionType: 'for_me' as const };
  }

  if (Number(message.sender_id) !== params.userId) {
    throw forbidden('Only the sender can delete this message for everyone');
  }
  await execute(
    `UPDATE messages
        SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, deletion_type = 'for_everyone',
            deleted_for_everyone = 1, body = NULL
      WHERE id = ?`,
    [params.userId, params.messageId],
  );
  const conversation = await queryOne<Row>('SELECT uuid FROM conversations WHERE id = ?', [params.conversationId]);
  if (conversation) {
    emitToConversation(String(conversation.uuid), 'message:deleted', {
      messageId: params.messageId,
      deletionType: 'for_everyone',
    });
  }
  return { deleted: true, deletionType: 'for_everyone' as const };
}

export async function markConversationRead(
  conversationUuid: string,
  userId: number,
  lastReadMessageId?: number | null,
  deviceId?: number | null,
) {
  const conversation = await getConversationByUuid(conversationUuid, userId);
  let last = lastReadMessageId ?? null;
  if (last == null) {
    const latest = await queryOne<Row>(
      `SELECT id FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1`,
      [conversation.id],
    );
    last = latest ? Number(latest.id) : null;
  }

  await execute(
    `UPDATE conversation_participants
        SET unread_count = 0, last_read_message_id = ?, last_read_at = CURRENT_TIMESTAMP
      WHERE conversation_id = ? AND user_id = ?`,
    [last, conversation.id, userId],
  );

  if (last) {
    await execute(
      `INSERT IGNORE INTO message_read_receipts (message_id, user_id) VALUES (?, ?)`,
      [last, userId],
    );
    await execute(
      `UPDATE messages SET status = 'read', read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE conversation_id = ? AND sender_id <> ? AND id <= ? AND status IN ('sent','delivered')`,
      [conversation.id, userId, last],
    );
  }

  if (deviceId) {
    await execute(
      `INSERT INTO conversation_device_cursors
         (user_id, device_id, conversation_id, last_read_message_id, last_sync_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         conversation_id = VALUES(conversation_id),
         last_read_message_id = VALUES(last_read_message_id),
         last_sync_at = CURRENT_TIMESTAMP`,
      [userId, deviceId, conversation.id, last],
    ).catch(() => undefined);
  }

  emitToConversation(conversationUuid, 'message:read', {
    conversationUuid,
    userId,
    lastReadMessageId: last,
  });
  emitToUser(userId, 'chat:read', { conversationUuid, lastReadMessageId: last });

  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'message.read', 'conversation', conversation.id, {
      conversationId: conversation.id,
      userId,
      messageId: last ?? 0,
    });
    void eventBus.publishAfterCommit(event);
  }).catch(() => undefined);

  return { read: true, lastMessageId: last };
}

export async function markDelivered(conversationId: number, userId: number) {
  await execute(
    `UPDATE messages
        SET status = 'delivered', delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP)
      WHERE conversation_id = ? AND sender_id <> ? AND status = 'sent'`,
    [conversationId, userId],
  );
  const conversation = await queryOne<Row>('SELECT uuid FROM conversations WHERE id = ?', [conversationId]);
  if (conversation) {
    emitToConversation(String(conversation.uuid), 'message:delivered', { conversationId, userId });
  }
}

export async function updateConversationFlags(
  conversationUuid: string,
  userId: number,
  patch: { muted?: boolean; archived?: boolean; pinned?: boolean },
) {
  const conversation = await requireConversation(conversationUuid, userId);
  await execute(
    `UPDATE conversation_participants
        SET is_muted = COALESCE(?, is_muted),
            is_archived = COALESCE(?, is_archived),
            is_pinned = COALESCE(?, is_pinned)
      WHERE conversation_id = ? AND user_id = ?`,
    [
      patch.muted === undefined ? null : patch.muted ? 1 : 0,
      patch.archived === undefined ? null : patch.archived ? 1 : 0,
      patch.pinned === undefined ? null : patch.pinned ? 1 : 0,
      Number(conversation.id),
      userId,
    ],
  );
  return getConversationByUuid(conversationUuid, userId);
}

export { assertParticipant };

async function assertConversationWritable(conversationId: number, userId: number) {
  const conversation = await queryOne<Row>(
    `SELECT status FROM conversations WHERE id = ?`,
    [conversationId],
  );
  if (!conversation) throw notFound('Conversation');
  if (String(conversation.status) === 'closed') throw forbidden('This conversation is closed');

  const peers = await loadPeerIds(conversationId, userId);
  for (const peerId of peers) {
    if (await isBlockedEitherWay(userId, peerId)) {
      throw forbidden('You cannot message this user');
    }
  }
}

function validatePayload(params: {
  kind: MessageKind;
  body?: string | null;
  attachments?: AttachmentInput[];
  location?: LocationContent | null;
  senderId: number | null;
}) {
  if (params.senderId !== null && (params.kind === 'system' || params.kind === 'call_log')) {
    throw forbidden('Clients cannot send system messages');
  }
  if (params.kind === 'text' && !params.body?.trim()) throw badRequest('Message body is required');
  if (['image', 'video', 'voice', 'audio', 'document'].includes(params.kind)) {
    if (!params.attachments?.length) throw badRequest('Attachment is required for this message type');
  }
  if (params.kind === 'location') {
    const loc = params.location;
    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) {
      throw badRequest('Location requires latitude and longitude');
    }
    if (Math.abs(loc.latitude) > 90 || Math.abs(loc.longitude) > 180) {
      throw badRequest('Location coordinates are out of range');
    }
  }
}

async function prepareAttachments(
  senderId: number | null,
  kind: MessageKind,
  attachments?: AttachmentInput[],
): Promise<AttachmentInput[]> {
  if (!attachments?.length) return [];
  const expected = attachmentKindForMessage(kind);
  return attachments.map((item) => {
    const storageKey = senderId ? assertOwnedStorageRef(senderId, item) : item.storageKey ?? null;
    return {
      ...item,
      kind: kindFromMime(item.mimeType, item.kind || expected),
      storageKey,
      url: item.url ?? '',
    };
  });
}

async function assembleMessages(rows: Row[], viewerId: number): Promise<PublicMessage[]> {
  const ids = rows.map((row) => Number(row.id));
  const attachments = await queryRows<Row>(
    `SELECT id, message_id, kind, url, storage_key, thumb_url, thumbnail_key, file_name, mime_type,
            size_bytes, width, height, duration_ms, waveform, codec, upload_status, scan_status
       FROM message_attachments
      WHERE message_id IN (${ids.map(() => '?').join(',')})
      ORDER BY id`,
    ids,
  );
  const replyIds = rows.map((row) => Number(row.reply_to_id)).filter((id) => id > 0);
  const replies =
    replyIds.length === 0
      ? []
      : await queryRows<Row>(
          `SELECT id, uuid, body, sender_id, deleted_for_everyone FROM messages WHERE id IN (${replyIds.map(() => '?').join(',')})`,
          replyIds,
        );
  const replyMap = new Map(replies.map((row) => [Number(row.id), row]));

  const byMessage = new Map<number, PublicAttachment[]>();
  for (const row of attachments) {
    if (String(row.scan_status) === 'blocked') continue;
    const messageId = Number(row.message_id);
    const signed = signedAttachmentUrls({
      attachmentId: Number(row.id),
      userId: viewerId,
      storageKey: (row.storage_key as string | null) ?? null,
      thumbnailKey: (row.thumbnail_key as string | null) ?? null,
      fallbackUrl: (row.url as string | null) ?? null,
      fallbackThumb: (row.thumb_url as string | null) ?? null,
    });
    const list = byMessage.get(messageId) ?? [];
    list.push({
      id: Number(row.id),
      kind: String(row.kind),
      url: signed.url,
      thumbUrl: signed.thumbUrl,
      fileName: (row.file_name as string | null) ?? null,
      mimeType: (row.mime_type as string | null) ?? null,
      sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
      width: row.width == null ? null : Number(row.width),
      height: row.height == null ? null : Number(row.height),
      durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
      waveform: parseWaveform(row.waveform),
      codec: (row.codec as string | null) ?? null,
      uploadStatus: String(row.upload_status ?? 'ready'),
    });
    byMessage.set(messageId, list);
  }

  return rows.map((row) => mapMessage(row, byMessage.get(Number(row.id)) ?? [], replyMap));
}

function mapMessage(
  row: Row,
  attachments: PublicAttachment[],
  replies: Map<number, Row>,
): PublicMessage {
  const deletedEveryone = Number(row.deleted_for_everyone) === 1 || Boolean(row.deleted_at);
  const deletionType = (String(row.deletion_type || 'none') as DeletionType) || 'none';
  const replyRow = row.reply_to_id ? replies.get(Number(row.reply_to_id)) : null;
  const lat = row.latitude == null ? null : Number(row.latitude);
  const lng = row.longitude == null ? null : Number(row.longitude);
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    conversationId: Number(row.conversation_id),
    senderId: row.sender_id === null ? null : Number(row.sender_id),
    kind: String(row.kind),
    body: deletedEveryone ? null : ((row.body as string | null) ?? null),
    replyTo: replyRow
      ? {
          id: Number(replyRow.id),
          uuid: String(replyRow.uuid),
          body: Number(replyRow.deleted_for_everyone) === 1 ? null : ((replyRow.body as string | null) ?? null),
          senderId: replyRow.sender_id === null ? null : Number(replyRow.sender_id),
        }
      : null,
    attachments: deletedEveryone ? [] : attachments,
    location:
      !deletedEveryone && lat != null && lng != null
        ? {
            latitude: lat,
            longitude: lng,
            accuracy: row.location_accuracy == null ? null : Number(row.location_accuracy),
            timestamp: row.location_at ? (row.location_at as Date).toISOString() : null,
            label: (row.location_label as string | null) ?? null,
          }
        : null,
    isEdited: Number(row.is_edited) === 1,
    editedAt: row.edited_at ? (row.edited_at as Date).toISOString() : null,
    deleted: deletedEveryone,
    deletionType: deletedEveryone ? 'for_everyone' : deletionType,
    status: String(row.status),
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: row.updated_at ? (row.updated_at as Date).toISOString() : null,
    metadata: parseJson(row.metadata),
  };
}

async function hydrateConversations(rows: Row[]): Promise<PublicConversation[]> {
  const peerIds = rows.map((row) => (row.peer_id == null ? null : Number(row.peer_id))).filter((id): id is number => id != null);
  const presence = await getPresenceMap(peerIds);
  return rows.map((row) => {
    const peerId = row.peer_id == null ? null : Number(row.peer_id);
    const lat = row.listing_lat == null ? null : Number(row.listing_lat);
    const lng = row.listing_lng == null ? null : Number(row.listing_lng);
    return {
      id: Number(row.id),
      uuid: String(row.uuid),
      kind: String(row.kind),
      conversationType: (String(row.conversation_type || 'buyer_seller') as ConversationType) || 'buyer_seller',
      subject: (row.subject as string | null) ?? null,
      marketplaceId: row.marketplace_id == null ? null : Number(row.marketplace_id),
      marketplaceCode: (row.marketplace_code as string | null) ?? null,
      listingId: row.listing_id == null ? null : Number(row.listing_id),
      listingUuid: row.listing_uuid ? String(row.listing_uuid) : null,
      listingTitle: (row.listing_title as string | null) ?? null,
      listingLocation: lat != null && lng != null ? { latitude: lat, longitude: lng } : null,
      businessId: row.business_id == null ? null : Number(row.business_id),
      lastMessageAt: row.last_message_at ? (row.last_message_at as Date).toISOString() : null,
      lastMessagePreview: (row.last_message_preview as string | null) ?? null,
      lastMessageId: row.last_message_id == null ? null : Number(row.last_message_id),
      messageCount: Number(row.message_count ?? 0),
      status: String(row.status),
      unreadCount: Number(row.unread_count ?? 0),
      lastReadMessageId: row.last_read_message_id == null ? null : Number(row.last_read_message_id),
      lastReadAt: row.last_read_at ? (row.last_read_at as Date).toISOString() : null,
      isPinned: Number(row.is_pinned) === 1,
      isArchived: Number(row.is_archived) === 1,
      isMuted: Number(row.is_muted) === 1,
      peerId,
      peerName: (row.peer_name as string | null) ?? null,
      peerAvatar: (row.peer_avatar as string | null) ?? null,
      peerPresence: peerId ? presence.get(peerId) ?? null : null,
    };
  });
}

function parseWaveform(value: unknown): number[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((n) => Number(n));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map((n) => Number(n));
    } catch {
      return null;
    }
  }
  return null;
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

export async function notifyOfflinePeers(params: {
  conversationId: number;
  conversationUuid: string;
  senderId: number;
  recipientIds: number[];
  mutedUserIds: Set<number>;
}) {
  for (const recipientId of params.recipientIds) {
    if (params.mutedUserIds.has(recipientId)) continue;
    if (await isBlockedEitherWay(params.senderId, recipientId)) continue;
    const presence = await getPresence(recipientId);
    if (presence.status === 'online' || presence.status === 'away') continue;

    const pref = await queryOne<Row>(
      `SELECT push, in_app FROM notification_preferences
        WHERE user_id = ? AND category_code = 'chat.message'`,
      [recipientId],
    );
    const allowInApp = pref ? Number(pref.in_app) !== 0 : true;
    if (!allowInApp && pref && Number(pref.push) === 0) continue;

    await notifyUser({
      userId: recipientId,
      categoryCode: 'chat.message',
      title: 'New message',
      body: 'You have a new message.',
      actionType: 'chat',
      actionTarget: params.conversationUuid,
      entityType: 'conversation',
      entityId: params.conversationUuid,
      data: { conversationUuid: params.conversationUuid },
      eventId: `chat.message:${params.conversationId}:${recipientId}:${Date.now()}`,
      groupKey: `chat:${params.conversationUuid}`,
    });
  }
}
