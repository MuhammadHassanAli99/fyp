import { env } from '../../config/env';
import { uuid } from '../../core/security/crypto';
import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { cache, cacheKeys } from '../../config/cache';
import { loggerFor } from '../../config/logger';
import { telecom } from '../../providers/telecom';
import { assertNotBlocked } from '../chat/blocks.service';

const log = loggerFor('calls.masked');

export interface MaskedSessionPublic {
  uuid: string;
  listingId: number | null;
  status: string;
  expiresAt: string | null;
  /** Always null for Flutter — real and proxy numbers stay server-side unless PSTN dial-out is required. */
  dialHint: null;
}

function dayKey(userId: number): string {
  return cacheKeys.maskedDaily(userId, new Date().toISOString().slice(0, 10));
}

export async function allocateMaskedSession(params: {
  callerId: number;
  listingIdOrUuid: string | number;
}) {
  const listing = await queryOne<Row>(
    `SELECT id, uuid, user_id, allow_calls, status
       FROM listings
      WHERE deleted_at IS NULL AND (id = ? OR uuid = ?)`,
    [Number(params.listingIdOrUuid) || 0, String(params.listingIdOrUuid)],
  );
  if (!listing) throw notFound('Listing');
  if (listing.status !== 'published') throw badRequest('This listing is not available');
  if (Number(listing.allow_calls) === 0) throw badRequest('The seller has disabled calling for this listing');

  const calleeId = Number(listing.user_id);
  if (calleeId === params.callerId) throw badRequest('You cannot start a masked call on your own listing');
  await assertNotBlocked(params.callerId, calleeId, 'call this seller');

  const used = (await cache.get<number>(dayKey(params.callerId))) ?? 0;
  if (used >= env.MASKED_CALLS_PER_DAY) {
    throw forbidden('Daily masked-call limit reached');
  }

  const callee = await queryOne<Row>(
    `SELECT phone_e164 FROM users WHERE id = ?`,
    [calleeId],
  );
  const caller = await queryOne<Row>(
    `SELECT phone_e164 FROM users WHERE id = ?`,
    [params.callerId],
  );

  const sessionUuid = uuid();
  const ttlSeconds = env.MASKED_CALL_TTL_HOURS * 3600;
  const bridge = await telecom.allocate({
    sessionUuid,
    listingId: Number(listing.id),
    callerRealNumber: (caller?.phone_e164 as string | null) ?? null,
    calleeRealNumber: (callee?.phone_e164 as string | null) ?? null,
    ttlSeconds,
  });

  let maskedNumberId: number | null = null;
  if (callee?.phone_e164) {
    const proxy = bridge.proxyNumber ?? `masked:${sessionUuid}`;
    maskedNumberId = await insertAndGetId(
      `INSERT INTO masked_numbers
         (uuid, user_id, listing_id, proxy_number, real_number, provider, provider_ref, purpose, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'listing_contact', ?)`,
      [
        uuid(),
        calleeId,
        Number(listing.id),
        proxy,
        String(callee.phone_e164),
        bridge.provider,
        bridge.providerSessionId,
        bridge.expiresAt,
      ],
    );
  }

  await insertAndGetId(
    `INSERT INTO masked_call_sessions
       (uuid, listing_id, caller_id, callee_id, masked_number_id, provider, provider_session_id, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'allocated', ?)`,
    [
      sessionUuid,
      Number(listing.id),
      params.callerId,
      calleeId,
      maskedNumberId,
      bridge.provider,
      bridge.providerSessionId,
      bridge.expiresAt,
    ],
  );

  await cache.set(dayKey(params.callerId), used + 1, 24 * 3600);
  log.info({ sessionUuid, listingId: Number(listing.id), callerId: params.callerId }, 'masked session allocated');

  return {
    uuid: sessionUuid,
    listingId: Number(listing.id),
    status: 'allocated',
    expiresAt: bridge.expiresAt.toISOString(),
    dialHint: null,
  } satisfies MaskedSessionPublic;
}

export async function revokeMaskedSession(sessionUuid: string, userId: number) {
  const row = await queryOne<Row>(
    `SELECT id, caller_id, callee_id, provider_session_id, status
       FROM masked_call_sessions WHERE uuid = ?`,
    [sessionUuid],
  );
  if (!row) throw notFound('Masked session');
  if (Number(row.caller_id) !== userId && Number(row.callee_id) !== userId) {
    throw forbidden('You cannot revoke this session');
  }
  if (row.provider_session_id) {
    await telecom.revoke(String(row.provider_session_id));
  }
  await execute(
    `UPDATE masked_call_sessions SET status = 'revoked', ended_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [Number(row.id)],
  );
  await execute(
    `UPDATE masked_numbers SET revoked_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT masked_number_id FROM masked_call_sessions WHERE id = ?)`,
    [Number(row.id)],
  ).catch(() => undefined);
  return { revoked: true };
}

export async function expireMaskedSessions(limit = 100): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT id, provider_session_id FROM masked_call_sessions
      WHERE status IN ('allocated','ringing') AND expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP
      LIMIT ?`,
    [limit],
  );
  for (const row of rows) {
    if (row.provider_session_id) {
      await telecom.revoke(String(row.provider_session_id)).catch(() => undefined);
    }
    await execute(`UPDATE masked_call_sessions SET status = 'expired', ended_at = CURRENT_TIMESTAMP WHERE id = ?`, [
      Number(row.id),
    ]);
  }
  return rows.length;
}

