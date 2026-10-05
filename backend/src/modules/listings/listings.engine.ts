import type { PoolConnection } from '../../db/pool';
import { execute, queryCount, queryOne, queryRows, transaction, type Row } from '../../db/query';
import { AppError, ErrorCode, badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { buildUpdate, toJson, toNumber } from '../../db/sql';
import { env } from '../../config/env';
import { eventBus } from '../../core/events/event-bus';
import { marketplaceRegistry } from '../../marketplaces/module';
import { consumeQuota, getQuota, releaseQuota } from '../../middleware/entitlements';
import { screenListing } from '../moderation/screening.service';
import { notifyUser } from '../notifications/notify';
import { recordListingEvent } from './listings.events';
import {
  canTransitionLifecycle,
  canTransitionTransaction,
  compatStatus,
  expirationStatusFor,
  readDimensions,
  type LifecycleStatus,
  type ListingDimensions,
  type RejectionReasonCode,
  type TransactionStatus,
} from './listings.lifecycle';
import { assertListingPermission, type ListingActor, type ListingAction } from './listings.permissions';
import { upsertSearchIndex } from './listings.search-index';
import { addAvailabilityBlock } from './listings.availability';
import { refreshListingPromotionFlags } from './listings.promotions';
import { validateListingForSubmit } from './listings.validation';
import { snapshotFromRow, writeListingVersion } from './listings.versions';

const formatSql = (date: Date): string => date.toISOString().slice(0, 19).replace('T', ' ');

export async function lockListing(listingId: number, connection: PoolConnection): Promise<Row> {
  const listing = await queryOne<Row>(
    'SELECT * FROM listings WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
    [listingId],
    connection,
  );
  if (!listing) throw notFound('Listing');
  return listing;
}

export async function requireListingActor(
  listingId: number,
  actor: ListingActor,
  action: ListingAction,
): Promise<Row> {
  const listing = await queryOne<Row>('SELECT * FROM listings WHERE id = ? AND deleted_at IS NULL', [listingId]);
  if (!listing) throw notFound('Listing');
  await assertListingPermission(listing, actor, action);
  return listing;
}

async function applyDimensions(
  listingId: number,
  next: ListingDimensions,
  extra: Record<string, string | number | null | undefined>,
  connection: PoolConnection,
): Promise<void> {
  const update = buildUpdate('listings', {
    lifecycle_status: next.lifecycleStatus,
    transaction_status: next.transactionStatus,
    moderation_status: next.moderationStatus,
    expiration_status: next.expirationStatus,
    status: compatStatus(next),
    ...extra,
  });
  if (update) {
    await execute(`${update.sql} WHERE id = ?`, [...update.params, listingId], connection);
  }
}

async function recordStatusHistory(
  listingId: number,
  from: string | null,
  to: string,
  actorId: number | null,
  actorType: 'owner' | 'moderator' | 'system' | 'job' | 'ai',
  reason: string | null,
  connection: PoolConnection,
): Promise<void> {
  await execute(
    `INSERT INTO listing_status_history (listing_id, from_status, to_status, actor_id, actor_type, reason)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [listingId, from, to, actorId, actorType, reason],
    connection,
  );
}

export async function submitListing(listingId: number, actor: ListingActor): Promise<{
  status: string;
  lifecycleStatus: LifecycleStatus;
  flags: Record<string, number>;
  queued: boolean;
}> {
  const listing = await requireListingActor(listingId, actor, 'submit');
  const current = readDimensions(listing);
  if (!canTransitionLifecycle(current.lifecycleStatus, 'pending_review') && current.lifecycleStatus !== 'pending_review') {
    throw conflict(`A ${current.lifecycleStatus} listing cannot be submitted`);
  }

  const validation = await validateListingForSubmit(listingId);
  if (!validation.ok) {
    throw new AppError('Listing is not ready to submit', {
      status: 422,
      code: ErrorCode.UNPROCESSABLE,
      details: { issues: validation.issues, missingFields: validation.missingFields },
    });
  }

  await transaction(async (connection) => {
    await lockListing(listingId, connection);
    await applyDimensions(
      listingId,
      {
        lifecycleStatus: 'pending_review',
        transactionStatus: current.transactionStatus,
        moderationStatus: 'in_review',
        expirationStatus: 'active',
      },
      { last_submitted_at: formatSql(new Date()), completeness_score: validation.completenessScore },
      connection,
    );
    await recordStatusHistory(listingId, current.lifecycleStatus, 'pending_review', actor.userId, 'owner', 'submitted', connection);
    await recordListingEvent(listingId, 'SUBMITTED', { id: actor.userId, type: 'owner' }, { completeness: validation.completenessScore }, connection);
    const event = await eventBus.enqueue(connection, 'listing.submitted', 'listing', listingId, {
      listingId,
      userId: Number(listing.user_id),
      marketplaceId: Number(listing.marketplace_id),
    });
    void eventBus.publishAfterCommit(event);
  });

  const screening = await screenListing(listingId);
  await recordMarketplaceDuplicates(listingId, listing).catch(() => undefined);

  if (screening.decision === 'approve') {
    await publishListing(listingId, { ...actor, isStaff: true }, { automated: true, flags: screening.flags });
    return { status: 'published', lifecycleStatus: 'published', flags: screening.flags, queued: false };
  }

  await transaction(async (connection) => {
    await execute(
      `UPDATE listings SET moderation_status = 'in_review', moderation_state = ?, ai_flags = ? WHERE id = ?`,
      [screening.decision === 'reject' ? 'flagged' : 'under_review', JSON.stringify(screening.flags), listingId],
      connection,
    );
    await recordListingEvent(
      listingId,
      'REVIEW_STARTED',
      { id: null, type: 'ai' },
      { decision: screening.decision, flags: screening.flags, reasons: screening.reasons },
      connection,
    );
  });

  return { status: 'pending_review', lifecycleStatus: 'pending_review', flags: screening.flags, queued: true };
}

async function recordMarketplaceDuplicates(listingId: number, listing: Row): Promise<void> {
  const marketplaceId = Number(listing.marketplace_id);
  const module = marketplaceRegistry.getById(marketplaceId);
  if (!module) return;

  if (module.code === 'vehicles') {
    const detail = await queryOne<Row>('SELECT vin FROM vehicle_listing_details WHERE listing_id = ?', [listingId]);
    const vin = String(detail?.vin ?? '').trim();
    if (vin.length >= 11) {
      const dup = await queryCount(
        `SELECT COUNT(*) FROM vehicle_listing_details d
           JOIN listings l ON l.id = d.listing_id
          WHERE d.vin = ? AND d.listing_id <> ? AND l.deleted_at IS NULL
            AND l.lifecycle_status IN ('pending_review','published')`,
        [vin, listingId],
      );
      if (dup > 0) {
        await execute(
          `INSERT INTO duplicate_detections (listing_id, duplicate_of_listing_id, similarity, method, matched_fields, status)
           SELECT ?, l.id, 1, 'vin', JSON_ARRAY('vin'), 'detected'
             FROM vehicle_listing_details d JOIN listings l ON l.id = d.listing_id
            WHERE d.vin = ? AND d.listing_id <> ? AND l.deleted_at IS NULL LIMIT 1`,
          [listingId, vin, listingId],
        ).catch(() => undefined);
      }
    }
  }

  if (module.code === 'gold') {
    const detail = await queryOne<Row>(
      'SELECT serial_number, certificate_number FROM gold_listing_details WHERE listing_id = ?',
      [listingId],
    );
    const serial = String(detail?.serial_number ?? '').trim();
    if (serial.length >= 4) {
      const dup = await queryCount(
        `SELECT COUNT(*) FROM gold_listing_details d JOIN listings l ON l.id = d.listing_id
          WHERE d.serial_number = ? AND d.listing_id <> ? AND l.deleted_at IS NULL
            AND l.lifecycle_status IN ('pending_review','published')`,
        [serial, listingId],
      );
      if (dup > 0) {
        await execute(
          `INSERT INTO duplicate_detections (listing_id, duplicate_of_listing_id, similarity, method, matched_fields, status)
           SELECT ?, l.id, 1, 'gold_serial', JSON_ARRAY('serial_number'), 'detected'
             FROM gold_listing_details d JOIN listings l ON l.id = d.listing_id
            WHERE d.serial_number = ? AND d.listing_id <> ? LIMIT 1`,
          [listingId, serial, listingId],
        ).catch(() => undefined);
      }
    }
  }

  if (module.code === 'property') {
    const detail = await queryOne<Row>(
      'SELECT property_id, property_kind, area_sqm FROM property_listing_details WHERE listing_id = ?',
      [listingId],
    );
    if (detail?.property_id) {
      const dup = await queryCount(
        `SELECT COUNT(*) FROM property_listing_details d JOIN listings l ON l.id = d.listing_id
          WHERE d.property_id = ? AND d.listing_id <> ? AND l.deleted_at IS NULL
            AND l.lifecycle_status IN ('pending_review','published')`,
        [detail.property_id, listingId],
      );
      if (dup > 0) {
        await execute(
          `INSERT INTO duplicate_detections (listing_id, duplicate_of_listing_id, similarity, method, matched_fields, status)
           SELECT ?, l.id, 0.95, 'property_asset', JSON_ARRAY('property_id'), 'detected'
             FROM property_listing_details d JOIN listings l ON l.id = d.listing_id
            WHERE d.property_id = ? AND d.listing_id <> ? LIMIT 1`,
          [listingId, detail.property_id, listingId],
        ).catch(() => undefined);
      }
    }
  }
}

export async function publishListing(
  listingId: number,
  actor: ListingActor,
  options: { automated?: boolean; flags?: Record<string, number> } = {},
): Promise<{ status: string; lifecycleStatus: LifecycleStatus }> {
  if (!options.automated) {
    await requireListingActor(listingId, actor, 'approve');
  }

  const expiresAt = new Date(Date.now() + env.LISTING_TTL_DAYS * 86_400_000);

  await transaction(async (connection) => {
    const listing = await lockListing(listingId, connection);
    const current = readDimensions(listing);
    if (!canTransitionLifecycle(current.lifecycleStatus, 'published') && current.lifecycleStatus !== 'published') {
      throw conflict(`A ${current.lifecycleStatus} listing cannot be published`);
    }

    const next: ListingDimensions = {
      lifecycleStatus: 'published',
      transactionStatus: current.transactionStatus === 'sold' ? 'available' : current.transactionStatus,
      moderationStatus: 'approved',
      expirationStatus: 'active',
    };
    await applyDimensions(
      listingId,
      next,
      {
        published_at: listing.published_at ? undefined : formatSql(new Date()),
        expires_at: formatSql(expiresAt),
        rejection_reason: null,
        moderation_state: 'clean',
      },
      connection,
    );
    await recordStatusHistory(listingId, current.lifecycleStatus, 'published', actor.userId, options.automated ? 'system' : 'moderator', 'approved', connection);
    await recordListingEvent(listingId, 'APPROVED', { id: actor.userId, type: options.automated ? 'system' : 'moderator' }, options.flags ?? null, connection);
    await recordListingEvent(listingId, 'PUBLISHED', { id: actor.userId, type: options.automated ? 'system' : 'moderator' }, { expiresAt: expiresAt.toISOString() }, connection);

    const event = await eventBus.enqueue(connection, 'listing.published', 'listing', listingId, {
      listingId,
      userId: Number(listing.user_id),
      marketplaceId: Number(listing.marketplace_id),
      categoryId: Number(listing.category_id),
      countryId: Number(listing.country_id),
      cityId: listing.city_id === null ? null : Number(listing.city_id),
      price: listing.price === null ? null : String(listing.price),
      currency: (listing.currency as string | null) ?? null,
    });
    void eventBus.publishAfterCommit(event);

    const module = marketplaceRegistry.getById(Number(listing.marketplace_id));
    await module?.onPublished?.(listingId, connection);
    await upsertSearchIndex(listingId, connection);
  });

  const listing = await queryOne<Row>('SELECT user_id, title FROM listings WHERE id = ?', [listingId]);
  if (listing) {
    await notifyUser({
      userId: Number(listing.user_id),
      categoryCode: 'listing.published',
      title: `${listing.title} is live`,
      body: 'Your listing is now publicly searchable.',
      actionTarget: String(listingId),
    });
  }

  return { status: 'published', lifecycleStatus: 'published' };
}

export async function rejectListing(params: {
  listingId: number;
  actor: ListingActor;
  reasonCode: RejectionReasonCode | string;
  reason: string;
  details?: string | null;
  reviewType?: 'automated' | 'manual' | 'appeal';
}): Promise<{ status: string }> {
  await requireListingActor(params.listingId, params.actor, 'reject');

  await transaction(async (connection) => {
    const listing = await lockListing(params.listingId, connection);
    const current = readDimensions(listing);
    if (!canTransitionLifecycle(current.lifecycleStatus, 'rejected')) {
      throw conflict(`A ${current.lifecycleStatus} listing cannot be rejected`);
    }
    await applyDimensions(
      params.listingId,
      {
        lifecycleStatus: 'rejected',
        transactionStatus: current.transactionStatus,
        moderationStatus: 'rejected',
        expirationStatus: current.expirationStatus,
      },
      { rejection_reason: params.reason.slice(0, 500), moderation_state: 'actioned' },
      connection,
    );
    await execute(
      `INSERT INTO listing_rejections
         (listing_id, reason_code, reason, details, reviewer_id, review_type, appeal_status)
       VALUES (?, ?, ?, ?, ?, ?, 'none')`,
      [
        params.listingId,
        params.reasonCode,
        params.reason.slice(0, 500),
        params.details ?? null,
        params.actor.userId,
        params.reviewType ?? 'manual',
      ],
      connection,
    );
    await recordStatusHistory(params.listingId, current.lifecycleStatus, 'rejected', params.actor.userId, 'moderator', params.reason, connection);
    await recordListingEvent(
      params.listingId,
      'REJECTED',
      { id: params.actor.userId, type: 'moderator' },
      { reasonCode: params.reasonCode, reason: params.reason },
      connection,
    );
    const event = await eventBus.enqueue(connection, 'listing.rejected', 'listing', params.listingId, {
      listingId: params.listingId,
      userId: Number(listing.user_id),
      reason: params.reason,
    });
    void eventBus.publishAfterCommit(event);
    await upsertSearchIndex(params.listingId, connection);
  });

  const listing = await queryOne<Row>('SELECT user_id, title FROM listings WHERE id = ?', [params.listingId]);
  if (listing) {
    await notifyUser({
      userId: Number(listing.user_id),
      categoryCode: 'listing.rejected',
      title: `${listing.title} was not published`,
      body: params.reason,
      actionTarget: String(params.listingId),
    });
  }

  return { status: 'rejected' };
}

export async function appealRejection(listingId: number, actor: ListingActor, note: string): Promise<{ appealStatus: string }> {
  const listing = await requireListingActor(listingId, actor, 'submit');
  const current = readDimensions(listing);
  if (current.lifecycleStatus !== 'rejected') throw conflict('Only a rejected listing can be appealed');

  const open = await queryOne<Row>(
    `SELECT id FROM listing_rejections WHERE listing_id = ? AND appeal_status = 'open' ORDER BY id DESC LIMIT 1`,
    [listingId],
  );
  if (open) throw conflict('An appeal is already open');

  await execute(
    `UPDATE listing_rejections
        SET appeal_status = 'open', appeal_note = ?, appealed_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT id FROM (SELECT MAX(id) AS id FROM listing_rejections WHERE listing_id = ?) t)`,
    [note.slice(0, 1000), listingId],
  );

  await transaction(async (connection) => {
    await recordListingEvent(listingId, 'APPEALED', { id: actor.userId, type: 'owner' }, { note }, connection);
  });

  return { appealStatus: 'open' };
}

export async function archiveListing(listingId: number, actor: ListingActor, reason?: string): Promise<{ status: string }> {
  const listing = await requireListingActor(listingId, actor, 'archive');
  const current = readDimensions(listing);
  if (!canTransitionLifecycle(current.lifecycleStatus, 'archived')) {
    throw conflict(`A ${current.lifecycleStatus} listing cannot be archived`);
  }

  await transaction(async (connection) => {
    await lockListing(listingId, connection);
    await applyDimensions(
      listingId,
      { ...current, lifecycleStatus: 'archived' },
      {
        archived_at: formatSql(new Date()),
        archived_by: actor.userId,
        archived_reason: reason?.slice(0, 500) ?? null,
      },
      connection,
    );
    await recordStatusHistory(listingId, current.lifecycleStatus, 'archived', actor.userId, actor.isStaff ? 'moderator' : 'owner', reason ?? null, connection);
    await recordListingEvent(listingId, 'ARCHIVED', { id: actor.userId, type: actor.isStaff ? 'moderator' : 'owner' }, { reason: reason ?? null }, connection);
    const event = await eventBus.enqueue(connection, 'listing.archived', 'listing', listingId, {
      listingId,
      userId: Number(listing.user_id),
    });
    void eventBus.publishAfterCommit(event);
    await upsertSearchIndex(listingId, connection);
  });

  await releaseQuota(Number(listing.user_id), 'active_listings').catch(() => undefined);
  return { status: 'archived' };
}

export async function restoreListing(listingId: number, actor: ListingActor): Promise<{ status: string; lifecycleStatus: LifecycleStatus }> {
  const listing = await requireListingActor(listingId, actor, 'restore');
  const current = readDimensions(listing);
  if (current.lifecycleStatus !== 'archived') throw conflict('Only an archived listing can be restored');

  const target: LifecycleStatus = listing.published_at ? 'published' : 'draft';
  if (!canTransitionLifecycle('archived', target)) throw conflict('This listing cannot be restored');

  await transaction(async (connection) => {
    await lockListing(listingId, connection);
    await applyDimensions(
      listingId,
      {
        lifecycleStatus: target,
        transactionStatus: current.transactionStatus === 'sold' ? 'available' : current.transactionStatus,
        moderationStatus: target === 'published' ? 'approved' : 'not_reviewed',
        expirationStatus: target === 'published' ? 'active' : current.expirationStatus,
      },
      { restored_at: formatSql(new Date()), archived_at: null, archived_by: null, archived_reason: null },
      connection,
    );
    await recordStatusHistory(listingId, 'archived', target, actor.userId, actor.isStaff ? 'moderator' : 'owner', 'restored', connection);
    await recordListingEvent(listingId, 'RESTORED', { id: actor.userId, type: actor.isStaff ? 'moderator' : 'owner' }, { to: target }, connection);
    await upsertSearchIndex(listingId, connection);
  });

  return { status: target, lifecycleStatus: target };
}

export async function renewListingEngine(listingId: number, actor: ListingActor, days?: number): Promise<{ expiresAt: string; renewalCount: number }> {
  const listing = await requireListingActor(listingId, actor, 'renew');
  const current = readDimensions(listing);
  if (current.lifecycleStatus !== 'published' && current.lifecycleStatus !== 'expired') {
    throw conflict('Only a published or expired listing can be renewed');
  }

  const quota = await getQuota(actor.userId, 'renewals_per_year');
  if (!quota.unlimited && quota.remaining !== null && quota.remaining <= 0) {
    throw new AppError('You have reached the renewal limit for your plan', {
      status: 403,
      code: ErrorCode.QUOTA_EXCEEDED,
      details: { feature: 'renewals_per_year', limit: quota.limit },
    });
  }

  const extendDays = days ?? env.LISTING_TTL_DAYS;
  const previousExpiry = listing.expires_at ? new Date(listing.expires_at as Date) : null;
  const base = previousExpiry && previousExpiry.getTime() > Date.now() ? previousExpiry : new Date();
  const expiresAt = new Date(base.getTime() + extendDays * 86_400_000);

  await transaction(async (connection) => {
    await lockListing(listingId, connection);
    await applyDimensions(
      listingId,
      {
        lifecycleStatus: 'published',
        transactionStatus: current.transactionStatus === 'sold' ? current.transactionStatus : current.transactionStatus,
        moderationStatus: 'approved',
        expirationStatus: 'active',
      },
      {
        expires_at: formatSql(expiresAt),
        renewed_at: formatSql(new Date()),
        bump_at: formatSql(new Date()),
      },
      connection,
    );
    await execute('UPDATE listings SET renewal_count = renewal_count + 1 WHERE id = ?', [listingId], connection);
    await execute(
      `INSERT INTO listing_renewals
         (listing_id, previous_expires_at, new_expires_at, days, source, actor_id)
       VALUES (?, ?, ?, ?, 'owner', ?)`,
      [listingId, previousExpiry, expiresAt, extendDays, actor.userId],
      connection,
    );
    await recordStatusHistory(listingId, current.lifecycleStatus, 'published', actor.userId, 'owner', 'renewed', connection);
    await recordListingEvent(listingId, 'RENEWED', { id: actor.userId, type: 'owner' }, { expiresAt: expiresAt.toISOString() }, connection);
    const event = await eventBus.enqueue(connection, 'listing.renewed', 'listing', listingId, {
      listingId,
      userId: Number(listing.user_id),
      expiresAt: expiresAt.toISOString(),
    });
    void eventBus.publishAfterCommit(event);
    await upsertSearchIndex(listingId, connection);
  }, { retryOnDeadlock: true });

  if (!quota.unlimited) {
    await consumeQuota(actor.userId, 'renewals_per_year').catch(() => undefined);
  }

  const updated = await queryOne<Row>('SELECT renewal_count FROM listings WHERE id = ?', [listingId]);
  await notifyUser({
    userId: Number(listing.user_id),
    categoryCode: 'listing.renewed',
    title: `${listing.title} was renewed`,
    body: `New expiry: ${expiresAt.toISOString()}`,
    actionTarget: String(listingId),
  });

  return { expiresAt: expiresAt.toISOString(), renewalCount: Number(updated?.renewal_count ?? 0) };
}

export async function setTransactionStatus(params: {
  listingId: number;
  actor: ListingActor;
  to: TransactionStatus;
  buyerId?: number | null;
  startsAt?: Date;
  endsAt?: Date;
}): Promise<{ transactionStatus: TransactionStatus }> {
  const listing = await requireListingActor(params.listingId, params.actor, 'change_transaction');
  const current = readDimensions(listing);
  if (current.lifecycleStatus !== 'published') {
    throw conflict('Transaction state can only change on a published listing');
  }
  if (!canTransitionTransaction(current.transactionStatus, params.to)) {
    throw conflict(`Cannot move from ${current.transactionStatus} to ${params.to}`);
  }

  await transaction(async (connection) => {
    const locked = await lockListing(params.listingId, connection);
    const latest = readDimensions(locked);
    if (latest.transactionStatus === 'sold' && params.to === 'sold') {
      throw conflict('Listing is already sold');
    }
    if (latest.transactionStatus === 'reserved' && params.to === 'reserved') {
      throw conflict('Listing is already reserved');
    }
    if (!canTransitionTransaction(latest.transactionStatus, params.to)) {
      throw conflict(`Cannot move from ${latest.transactionStatus} to ${params.to}`);
    }

    const extra: Record<string, string | number | null | undefined> = {};
    if (params.to === 'sold') extra.sold_at = formatSql(new Date());

    const rentalKeepsAvailable =
      String(locked.operation) === 'rent' && (params.to === 'rented' || params.to === 'reserved');
    const persistedTransaction = rentalKeepsAvailable ? 'available' : params.to;

    await applyDimensions(
      params.listingId,
      { ...latest, transactionStatus: persistedTransaction },
      extra,
      connection,
    );

    if ((params.to === 'reserved' || params.to === 'rented') && params.startsAt && params.endsAt) {
      await addAvailabilityBlock({
        listingId: params.listingId,
        kind: params.to === 'rented' ? 'rented' : 'reserved',
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        createdBy: params.actor.userId,
        connection,
      });
    }

    const eventName = params.to === 'sold' ? 'SOLD' : params.to === 'rented' ? 'RENTED' : params.to === 'reserved' ? 'RESERVED' : 'UPDATED';
    await recordListingEvent(
      params.listingId,
      eventName,
      { id: params.actor.userId, type: 'owner' },
      { buyerId: params.buyerId ?? null },
      connection,
    );
    await recordStatusHistory(params.listingId, latest.transactionStatus, params.to, params.actor.userId, 'owner', params.to, connection);

    if (params.to === 'sold') {
      const event = await eventBus.enqueue(connection, 'listing.sold', 'listing', params.listingId, {
        listingId: params.listingId,
        userId: Number(locked.user_id),
        buyerId: params.buyerId ?? null,
      });
      void eventBus.publishAfterCommit(event);
    } else if (params.to === 'rented') {
      const event = await eventBus.enqueue(connection, 'listing.rented', 'listing', params.listingId, {
        listingId: params.listingId,
        userId: Number(locked.user_id),
      });
      void eventBus.publishAfterCommit(event);
    }
    await upsertSearchIndex(params.listingId, connection);
  }, { retryOnDeadlock: true, isolation: 'REPEATABLE READ' });

  if (params.to === 'sold') {
    await releaseQuota(Number(listing.user_id), 'active_listings').catch(() => undefined);
    await notifyUser({
      userId: Number(listing.user_id),
      categoryCode: 'listing.sold',
      title: `${listing.title} marked sold`,
      body: 'The listing is no longer available in search.',
      actionTarget: String(params.listingId),
    });
  }

  return { transactionStatus: params.to };
}

export async function expireDueListings(now = new Date()): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT id, user_id, title, lifecycle_status, transaction_status, moderation_status, status
       FROM listings
      WHERE deleted_at IS NULL
        AND lifecycle_status = 'published'
        AND expires_at IS NOT NULL
        AND expires_at <= ?
      LIMIT 200`,
    [now],
  );

  for (const listing of rows) {
    await transaction(async (connection) => {
      const locked = await lockListing(Number(listing.id), connection);
      const current = readDimensions(locked);
      if (current.lifecycleStatus !== 'published') return;
      await applyDimensions(
        Number(listing.id),
        { ...current, lifecycleStatus: 'expired', expirationStatus: 'expired' },
        {},
        connection,
      );
      await recordStatusHistory(Number(listing.id), 'published', 'expired', null, 'job', 'expired', connection);
      await recordListingEvent(Number(listing.id), 'EXPIRED', { id: null, type: 'job' }, null, connection);
      await execute(
        `UPDATE listing_promotions SET status = 'expired'
          WHERE listing_id = ? AND status IN ('scheduled','active')`,
        [listing.id],
        connection,
      );
      await refreshListingPromotionFlags(Number(listing.id), connection);
      const event = await eventBus.enqueue(connection, 'listing.expired', 'listing', Number(listing.id), {
        listingId: Number(listing.id),
        userId: Number(listing.user_id),
      });
      void eventBus.publishAfterCommit(event);
      await upsertSearchIndex(Number(listing.id), connection);
    }).catch(() => undefined);

    await releaseQuota(Number(listing.user_id), 'active_listings').catch(() => undefined);
    await notifyUser({
      userId: Number(listing.user_id),
      categoryCode: 'listing.expired',
      title: `${listing.title} has expired`,
      body: 'Renew to put this listing back in search.',
      actionTarget: String(listing.id),
    });
  }
  return rows.length;
}

export async function markExpiringListings(now = new Date()): Promise<number> {
  const warning = new Date(now.getTime() + 3 * 86_400_000);
  const result = await execute(
    `UPDATE listings
        SET expiration_status = 'expiring'
      WHERE deleted_at IS NULL
        AND lifecycle_status = 'published'
        AND expiration_status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at > ?
        AND expires_at <= ?`,
    [now, warning],
  );

  const rows = await queryRows<Row>(
    `SELECT id, user_id, title, expires_at FROM listings
      WHERE lifecycle_status = 'published' AND expiration_status = 'expiring'
        AND expires_at IS NOT NULL AND expires_at <= ?
        AND expires_at > DATE_SUB(?, INTERVAL 1 HOUR)
      LIMIT 100`,
    [warning, now],
  );
  for (const row of rows) {
    await notifyUser({
      userId: Number(row.user_id),
      categoryCode: 'listing.expiring',
      title: `${row.title} expires soon`,
      body: `Renew before ${(row.expires_at as Date).toISOString()} to stay in search.`,
      actionTarget: String(row.id),
    });
  }
  return result.affectedRows;
}

export async function captureVersionOnUpdate(params: {
  listingId: number;
  row: Row;
  changedFields: string[];
  userId: number;
  connection: PoolConnection;
}): Promise<void> {
  if (params.changedFields.length === 0) return;
  const version = Number(params.row.current_version ?? 0) + 1;
  await writeListingVersion({
    listingId: params.listingId,
    version,
    snapshot: snapshotFromRow(params.row),
    changedFields: params.changedFields,
    changedBy: params.userId,
    reason: params.changedFields.includes('price') ? 'price_change' : 'update',
    connection: params.connection,
  });
}

export async function listListingEvents(listingId: number, limit = 100) {
  const rows = await queryRows<Row>(
    `SELECT event_type, actor_id, actor_type, payload, created_at
       FROM listing_events WHERE listing_id = ? ORDER BY id DESC LIMIT ?`,
    [listingId, limit],
  );
  return rows.map((row) => ({
    eventType: String(row.event_type),
    actorId: row.actor_id === null ? null : Number(row.actor_id),
    actorType: String(row.actor_type),
    payload: toJson<Record<string, unknown>>(row.payload, {}),
    createdAt: (row.created_at as Date).toISOString(),
  }));
}

export async function listRejections(listingId: number) {
  const rows = await queryRows<Row>(
    `SELECT id, reason_code, reason, details, reviewer_id, review_type, appeal_status, appeal_note, created_at
       FROM listing_rejections WHERE listing_id = ? ORDER BY id DESC`,
    [listingId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    reasonCode: String(row.reason_code),
    reason: String(row.reason),
    details: (row.details as string | null) ?? null,
    reviewerId: row.reviewer_id === null ? null : Number(row.reviewer_id),
    reviewType: String(row.review_type),
    appealStatus: String(row.appeal_status),
    appealNote: (row.appeal_note as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}

export { expirationStatusFor, toNumber };
