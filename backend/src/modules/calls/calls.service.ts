import { env } from '../../config/env';
import { execute, insertAndGetId, queryOne, queryRows, transaction, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { emitToUser } from '../../realtime/socket';
import { eventBus } from '../../core/events/event-bus';
import { cache, cacheKeys } from '../../config/cache';
import { loggerFor } from '../../config/logger';
import { sendMessage } from '../chat/chat.service';
import { assertNotBlocked } from '../chat/blocks.service';
import { assertParticipant } from '../chat/chat.access';
import { notifyUser } from '../notifications/notify';
import { enqueueListingAnalytics } from '../listings/listings.analytics';
import { recordListingLead } from '../seller/seller.leads-ingest';
import {
  assertCallTransition,
  historyStatus,
  isTerminalCallState,
  normalizeCallState,
  type CallState,
} from './calls.state';
import { iceServersForUser } from './calls.ice';

export { iceServersForUser, type IceServer } from './calls.ice';

const log = loggerFor('calls');

export async function listCallHistory(userId: number, limit = 30) {
  const rows = await queryRows<Row>(
    `SELECT id, uuid, conversation_id, listing_id, marketplace_id, caller_id, callee_id, kind,
            direction, status, started_at, answered_at, ended_at, duration_secs, created_at
       FROM calls
      WHERE caller_id = ? OR callee_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
    [userId, userId, limit],
  );
  return rows.map(mapCall);
}

export async function getCall(callUuid: string, userId: number) {
  const row = await queryOne<Row>('SELECT * FROM calls WHERE uuid = ?', [callUuid]);
  if (!row) throw notFound('Call');
  if (Number(row.caller_id) !== userId && Number(row.callee_id) !== userId) {
    throw forbidden('You are not a participant in this call');
  }
  return {
    ...mapCall(row),
    iceServers: iceServersForUser(userId),
  };
}

export async function initiateCall(params: {
  callerId: number;
  calleeId?: number | null;
  conversationId?: number | null;
  conversationUuid?: string | null;
  listingId?: number | string | null;
  kind?: 'voice' | 'video';
}) {
  const kind = params.kind ?? 'voice';
  if (params.callerId === params.calleeId) throw badRequest('You cannot call yourself');

  let conversationId = params.conversationId ?? null;
  let listingId: number | null = null;
  let marketplaceId: number | null = null;
  let calleeId = params.calleeId ?? null;

  if (params.conversationUuid || conversationId) {
    const conversation = await queryOne<Row>(
      `SELECT id, listing_id, marketplace_id FROM conversations WHERE ${params.conversationUuid ? 'uuid = ?' : 'id = ?'}`,
      [params.conversationUuid ?? conversationId],
    );
    if (!conversation) throw notFound('Conversation');
    conversationId = Number(conversation.id);
    listingId = conversation.listing_id == null ? null : Number(conversation.listing_id);
    marketplaceId = conversation.marketplace_id == null ? null : Number(conversation.marketplace_id);
    await assertParticipant(conversationId, params.callerId);
    if (!calleeId) {
      const peer = await queryOne<Row>(
        `SELECT user_id FROM conversation_participants
          WHERE conversation_id = ? AND user_id <> ? AND left_at IS NULL LIMIT 1`,
        [conversationId, params.callerId],
      );
      calleeId = peer ? Number(peer.user_id) : null;
    }
  }

  if (params.listingId) {
    const listing = await queryOne<Row>(
      `SELECT id, user_id, allow_calls, status, marketplace_id
         FROM listings WHERE deleted_at IS NULL AND (id = ? OR uuid = ?)`,
      [Number(params.listingId) || 0, String(params.listingId)],
    );
    if (!listing) throw notFound('Listing');
    if (listing.status !== 'published') throw badRequest('This listing is not available');
    if (Number(listing.allow_calls) === 0) throw badRequest('The seller has disabled calling for this listing');
    listingId = Number(listing.id);
    marketplaceId = Number(listing.marketplace_id);
    calleeId = calleeId ?? Number(listing.user_id);
  }

  if (!calleeId) throw badRequest('Call recipient is required');
  if (calleeId === params.callerId) throw badRequest('You cannot call yourself');
  await assertNotBlocked(params.callerId, calleeId, 'call this user');

  if (await cache.get<string>(cacheKeys.callLock(params.callerId))) {
    throw badRequest('You already have an active call');
  }

  if (await cache.get<string>(cacheKeys.callLock(calleeId))) {
    const busyUuid = uuid();
    const busyId = await insertAndGetId(
      `INSERT INTO calls
         (uuid, conversation_id, listing_id, marketplace_id, caller_id, callee_id, kind, direction, status, provider, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'outgoing', 'busy', 'internal', CURRENT_TIMESTAMP)`,
      [busyUuid, conversationId, listingId, marketplaceId, params.callerId, calleeId, kind],
    );
    const busy = mapCall((await queryOne<Row>('SELECT * FROM calls WHERE id = ?', [busyId]))!);
    emitToUser(params.callerId, 'call:status', busy);
    return { ...busy, iceServers: iceServersForUser(params.callerId) };
  }

  const callUuid = uuid();
  const timeoutAt = new Date(Date.now() + env.CALL_RING_TIMEOUT_SECONDS * 1000);
  const id = await insertAndGetId(
    `INSERT INTO calls
       (uuid, conversation_id, listing_id, marketplace_id, caller_id, callee_id, kind, direction,
        status, signaling_state, provider, started_at, timeout_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'outgoing', 'ringing', 'none', 'internal', CURRENT_TIMESTAMP, ?)`,
    [callUuid, conversationId, listingId, marketplaceId, params.callerId, calleeId, kind, timeoutAt],
  );

  await cache.set(cacheKeys.callLock(params.callerId), callUuid, env.CALL_RING_TIMEOUT_SECONDS + 30);
  await cache.set(cacheKeys.callLock(calleeId), callUuid, env.CALL_RING_TIMEOUT_SECONDS + 30);

  const mapped = mapCall((await queryOne<Row>('SELECT * FROM calls WHERE id = ?', [id]))!);
  const payload = {
    ...mapped,
    iceServers: iceServersForUser(calleeId),
  };

  emitToUser(calleeId, 'call:incoming', payload);
  emitToUser(params.callerId, 'call:outgoing', { ...mapped, iceServers: iceServersForUser(params.callerId) });

  if (conversationId) {
    await sendMessage({
      conversationId,
      senderId: params.callerId,
      kind: 'call_log',
      body: kind === 'video' ? 'Video call started' : 'Voice call started',
    }).catch(() => undefined);
  }

  if (listingId) {
    void enqueueListingAnalytics({
      listingId,
      eventType: 'call',
      actorUserId: params.callerId,
      source: 'call.initiate',
    }).catch(() => undefined);
    void recordListingLead({
      listingId,
      buyerId: params.callerId,
      channel: 'call',
    });
  }

  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'call.started', 'call', id, {
      callId: id,
      callerId: params.callerId,
      calleeId,
      kind,
    });
    void eventBus.publishAfterCommit(event);
  }).catch(() => undefined);

  return { ...mapped, iceServers: iceServersForUser(params.callerId) };
}

export async function transitionCall(params: {
  callUuid: string;
  userId: number;
  next: CallState;
  endReason?: string | null;
}) {
  const row = await queryOne<Row>('SELECT * FROM calls WHERE uuid = ?', [params.callUuid]);
  if (!row) throw notFound('Call');
  if (Number(row.caller_id) !== params.userId && Number(row.callee_id) !== params.userId) {
    throw forbidden('You are not a participant in this call');
  }

  const from = normalizeCallState(String(row.status));
  const to = params.next;
  assertCallTransition(from, to);

  const answered = to === 'accepted' || to === 'connecting' || to === 'connected';
  const ended = isTerminalCallState(to);

  await execute(
    `UPDATE calls SET
        status = ?,
        answered_at = CASE WHEN ? = 1 THEN COALESCE(answered_at, CURRENT_TIMESTAMP) ELSE answered_at END,
        ended_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE ended_at END,
        duration_secs = CASE
          WHEN ? = 1 AND answered_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, answered_at, CURRENT_TIMESTAMP)
          ELSE duration_secs
        END,
        end_reason = COALESCE(?, end_reason),
        signaling_state = CASE
          WHEN ? IN ('connecting','connected') THEN 'connected'
          ELSE signaling_state
        END
      WHERE uuid = ?`,
    [to, answered ? 1 : 0, ended ? 1 : 0, ended ? 1 : 0, params.endReason ?? null, to, params.callUuid],
  );

  if (ended) {
    await cache.del(cacheKeys.callLock(Number(row.caller_id)));
    await cache.del(cacheKeys.callLock(Number(row.callee_id)));
  }

  const updated = await queryOne<Row>('SELECT * FROM calls WHERE uuid = ?', [params.callUuid]);
  const mapped = mapCall(updated!);
  emitToUser(mapped.callerId, 'call:status', mapped);
  emitToUser(mapped.calleeId, 'call:status', mapped);

  if (to === 'ended' || to === 'failed') {
    await transaction(async (connection) => {
      const event = await eventBus.enqueue(connection, 'call.ended', 'call', mapped.id, {
        callId: mapped.id,
        durationSecs: mapped.durationSecs,
        status: to,
      });
      void eventBus.publishAfterCommit(event);
    }).catch(() => undefined);
  }

  if (to === 'missed' || to === 'timeout') {
    await transaction(async (connection) => {
      const event = await eventBus.enqueue(connection, 'call.missed', 'call', mapped.id, {
        callId: mapped.id,
        calleeId: mapped.calleeId,
        callerId: mapped.callerId,
      });
      void eventBus.publishAfterCommit(event);
    }).catch(() => undefined);
    await notifyUser({
      userId: mapped.calleeId,
      categoryCode: 'chat.missed',
      title: 'Missed call',
      body: 'You missed a call.',
      actionType: 'chat',
      actionTarget: mapped.uuid,
    });
  }

  return mapped;
}

export async function signalCall(params: {
  callUuid: string;
  userId: number;
  type: 'offer' | 'answer' | 'ice' | 'hangup' | 'ice-restart';
  payload?: unknown;
}) {
  const row = await queryOne<Row>('SELECT * FROM calls WHERE uuid = ?', [params.callUuid]);
  if (!row) throw notFound('Call');
  const callerId = Number(row.caller_id);
  const calleeId = Number(row.callee_id);
  if (params.userId !== callerId && params.userId !== calleeId) {
    throw forbidden('You are not a participant in this call');
  }

  const from = normalizeCallState(String(row.status));
  if (params.type === 'hangup') {
    const next: CallState = from === 'ringing' ? (params.userId === callerId ? 'cancelled' : 'rejected') : 'ended';
    return transitionCall({ callUuid: params.callUuid, userId: params.userId, next });
  }

  if (params.type === 'offer' && from === 'ringing') {
    await execute(`UPDATE calls SET signaling_state = 'offer' WHERE uuid = ?`, [params.callUuid]);
  }
  if (params.type === 'answer') {
    if (from === 'ringing') {
      await transitionCall({ callUuid: params.callUuid, userId: params.userId, next: 'accepted' });
    }
    await execute(`UPDATE calls SET signaling_state = 'answer' WHERE uuid = ?`, [params.callUuid]);
  }
  if (params.type === 'ice') {
    await execute(`UPDATE calls SET signaling_state = 'ice' WHERE uuid = ? AND signaling_state <> 'connected'`, [
      params.callUuid,
    ]);
  }
  if (params.type === 'ice-restart') {
    await execute(`UPDATE calls SET ice_restart_count = ice_restart_count + 1 WHERE uuid = ?`, [params.callUuid]);
  }

  const target = params.userId === callerId ? calleeId : callerId;
  emitToUser(target, 'call:signal', {
    callUuid: params.callUuid,
    type: params.type,
    fromUserId: params.userId,
    payload: params.payload ?? null,
  });

  log.debug({ callUuid: params.callUuid, type: params.type }, 'call signal relayed');
  return { relayed: true };
}

export async function timeoutRingingCalls(limit = 50): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT uuid, caller_id FROM calls
      WHERE status = 'ringing' AND timeout_at IS NOT NULL AND timeout_at < CURRENT_TIMESTAMP
      LIMIT ?`,
    [limit],
  );
  for (const row of rows) {
    await transitionCall({
      callUuid: String(row.uuid),
      userId: Number(row.caller_id),
      next: 'timeout',
      endReason: 'ring_timeout',
    }).catch((error) => log.debug({ err: error }, 'call timeout skipped'));
  }
  return rows.length;
}

export async function updateCallStatus(callUuid: string, userId: number, status: string) {
  return transitionCall({ callUuid, userId, next: normalizeCallState(status) });
}

export { historyStatus };

const mapCall = (row: Row) => {
  const status = normalizeCallState(String(row.status));
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    conversationId: row.conversation_id == null ? null : Number(row.conversation_id),
    listingId: row.listing_id == null ? null : Number(row.listing_id),
    marketplaceId: row.marketplace_id == null ? null : Number(row.marketplace_id),
    callerId: Number(row.caller_id),
    calleeId: Number(row.callee_id),
    kind: String(row.kind),
    direction: String(row.direction),
    status,
    historyStatus: historyStatus(status),
    startedAt: row.started_at ? (row.started_at as Date).toISOString() : null,
    answeredAt: row.answered_at ? (row.answered_at as Date).toISOString() : null,
    endedAt: row.ended_at ? (row.ended_at as Date).toISOString() : null,
    durationSecs: Number(row.duration_secs ?? 0),
    createdAt: (row.created_at as Date).toISOString(),
  };
};
