import type { PoolConnection } from '../../db/pool';
import { execute, queryOne, queryRows, transaction, type Row } from '../../db/query';
import { AppError, ErrorCode, badRequest, conflict, notFound } from '../../core/errors';
import { buildUpdate, toBoolean, toJson, toNumber } from '../../db/sql';
import { consumeQuota, getQuota } from '../../middleware/entitlements';
import { eventBus } from '../../core/events/event-bus';
import { createOrder } from '../payments/payments.service';
import { recordListingEvent } from './listings.events';
import { canonicalPromotionType } from './listings.lifecycle';
import { readDimensions } from './listings.lifecycle';

const formatSql = (date: Date): string => date.toISOString().slice(0, 19).replace('T', ' ');

export async function listPromotionPackages(marketplaceId?: number | null) {
  const rows = await queryRows<Row>(
    `SELECT id, code, name, description, promotion_type, duration_days, price, currency,
            priority, quota_feature, is_stackable, marketplace_id
       FROM listing_promotion_packages
      WHERE is_active = 1
        AND (marketplace_id IS NULL OR marketplace_id = ?)
      ORDER BY sort_order, id`,
    [marketplaceId ?? 0],
  );
  return rows.map(mapPackage);
}

function mapPackage(row: Row) {
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    promotionType: String(row.promotion_type),
    durationDays: Number(row.duration_days),
    price: toNumber(row.price) ?? 0,
    currency: String(row.currency),
    priority: Number(row.priority ?? 0),
    quotaFeature: (row.quota_feature as string | null) ?? null,
    stackable: toBoolean(row.is_stackable),
    eligibility: { requiresPublished: true },
  };
}

export async function listListingPromotions(listingId: number) {
  const rows = await queryRows<Row>(
    `SELECT p.id, p.kind, p.package_id, p.priority, p.source, p.order_id, p.amount, p.currency,
            p.starts_at, p.ends_at, p.status, p.impressions, p.clicks, pkg.code AS package_code, pkg.name AS package_name
       FROM listing_promotions p
       LEFT JOIN listing_promotion_packages pkg ON pkg.id = p.package_id
      WHERE p.listing_id = ?
      ORDER BY p.created_at DESC
      LIMIT 50`,
    [listingId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    kind: String(row.kind),
    packageId: row.package_id === null ? null : Number(row.package_id),
    packageCode: (row.package_code as string | null) ?? null,
    packageName: (row.package_name as string | null) ?? null,
    priority: Number(row.priority ?? 0),
    source: String(row.source),
    orderId: row.order_id === null ? null : Number(row.order_id),
    amount: toNumber(row.amount),
    currency: (row.currency as string | null) ?? null,
    startsAt: (row.starts_at as Date).toISOString(),
    endsAt: (row.ends_at as Date).toISOString(),
    status: String(row.status),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
  }));
}

export async function requestPromotion(params: {
  listingId: number;
  userId: number;
  packageCode: string;
  useQuota: boolean;
  gatewayCode?: string;
  countryId: number;
  currency: string;
}): Promise<
  | { activated: true; kind: string; endsAt: string }
  | { activated: false; order: Record<string, unknown>; payment: Record<string, unknown>; clientSecret: string | null; redirectUrl: string | null }
> {
  const listing = await queryOne<Row>('SELECT * FROM listings WHERE id = ? AND deleted_at IS NULL', [params.listingId]);
  if (!listing) throw notFound('Listing');
  const dimensions = readDimensions(listing);
  if (dimensions.lifecycleStatus !== 'published') {
    throw conflict('Only a published listing can be promoted');
  }

  const pkg = await queryOne<Row>(
    `SELECT * FROM listing_promotion_packages WHERE code = ? AND is_active = 1`,
    [params.packageCode],
  );
  if (!pkg) throw badRequest('Unknown promotion package');

  const kind = canonicalPromotionType(String(pkg.promotion_type));
  const durationDays = Number(pkg.duration_days);
  const quotaFeature = (pkg.quota_feature as string | null) ?? null;

  if (params.useQuota && quotaFeature) {
    const quota = await getQuota(params.userId, quotaFeature);
    if (!quota.unlimited && (quota.remaining === null || quota.remaining <= 0)) {
      throw new AppError('You have no remaining quota for this promotion', {
        status: 403,
        code: ErrorCode.QUOTA_EXCEEDED,
        details: { feature: quotaFeature, upgradeAvailable: true },
      });
    }
    const activated = await activatePromotion({
      listingId: params.listingId,
      userId: params.userId,
      packageId: Number(pkg.id),
      kind,
      days: durationDays,
      priority: Number(pkg.priority ?? 0),
      source: 'subscription_quota',
      amount: null,
      currency: null,
      orderId: null,
      paymentId: null,
      idempotencyKey: `quota:${params.listingId}:${pkg.code}:${Date.now()}`,
    });
    await consumeQuota(params.userId, quotaFeature);
    return { activated: true, kind: activated.kind, endsAt: activated.endsAt };
  }

  const amount = toNumber(pkg.price) ?? 0;
  const currency = String(pkg.currency);
  const order = await createOrder(params.userId, {
    kind: 'promotion',
    amount,
    currency,
    countryId: params.countryId,
    gatewayCode: params.gatewayCode ?? 'manual',
    description: `${pkg.name} for listing ${params.listingId}`,
    referenceType: 'listing_promotion',
    referenceId: params.listingId,
    metadata: {
      listingId: params.listingId,
      packageId: Number(pkg.id),
      packageCode: String(pkg.code),
      kind,
      days: durationDays,
      priority: Number(pkg.priority ?? 0),
    },
  });

  return {
    activated: false,
    order: order.order as unknown as Record<string, unknown>,
    payment: order.payment as unknown as Record<string, unknown>,
    clientSecret: order.clientSecret ?? null,
    redirectUrl: order.redirectUrl ?? null,
  };
}

export async function activatePromotion(params: {
  listingId: number;
  userId: number;
  packageId: number | null;
  kind: string;
  days: number;
  priority: number;
  source: 'purchase' | 'subscription_quota' | 'promo' | 'admin';
  amount: number | null;
  currency: string | null;
  orderId: number | null;
  paymentId: number | null;
  idempotencyKey: string;
}): Promise<{ kind: string; endsAt: string; promotionId: number }> {
  const endsAt = new Date(Date.now() + params.days * 86_400_000);
  const storedKind = toStoredKind(params.kind);

  const result = await transaction(async (connection) => {
    const listing = await queryOne<Row>(
      'SELECT id, status, lifecycle_status, is_featured, is_boosted FROM listings WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [params.listingId],
      connection,
    );
    if (!listing) throw notFound('Listing');
    if (String(listing.lifecycle_status ?? listing.status) !== 'published' && String(listing.status) !== 'published') {
      throw conflict('Only a published listing can be promoted');
    }

    const existing = await queryOne<Row>(
      `SELECT id FROM listing_promotions
        WHERE listing_id = ? AND kind = ? AND status IN ('scheduled','active')
          AND ends_at > CURRENT_TIMESTAMP
        LIMIT 1 FOR UPDATE`,
      [params.listingId, storedKind],
      connection,
    );
    if (existing && !isStackable(params.kind)) {
      throw conflict('This promotion is already active on the listing');
    }

    const inserted = await execute(
      `INSERT INTO listing_promotions
         (listing_id, user_id, kind, package_id, priority, source, order_id, payment_id, amount, currency,
          starts_at, activated_at, ends_at, status, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, 'active', ?)`,
      [
        params.listingId,
        params.userId,
        storedKind,
        params.packageId,
        params.priority,
        params.source,
        params.orderId,
        params.paymentId,
        params.amount,
        params.currency,
        endsAt,
        params.idempotencyKey,
      ],
      connection,
    );

    const columns: Record<string, string | number | null> = { bump_at: formatSql(new Date()) };
    const type = canonicalPromotionType(params.kind);
    if (type === 'featured' || type === 'premium' || type === 'homepage') {
      columns.is_featured = 1;
      columns.featured_until = formatSql(endsAt);
      columns.search_rank = Math.max(3, params.priority / 30);
    }
    if (type === 'boosted' || type === 'top_search' || type === 'premium' || type === 'category_top' || type === 'location_top') {
      columns.is_boosted = 1;
      columns.boosted_until = formatSql(endsAt);
      columns.search_rank = Math.max(2, params.priority / 40);
    }
    if (type === 'urgent') columns.is_urgent = 1;

    const update = buildUpdate('listings', columns);
    if (update) await execute(`${update.sql} WHERE id = ?`, [...update.params, params.listingId], connection);

    const eventType = type === 'featured' || type === 'premium' || type === 'homepage' ? 'FEATURED' : 'BOOSTED';
    await recordListingEvent(
      params.listingId,
      eventType,
      { id: params.userId, type: 'owner' },
      { kind: params.kind, endsAt: endsAt.toISOString(), promotionId: inserted.insertId },
      connection,
    );

    const event = await eventBus.enqueue(connection, 'listing.promoted', 'listing', params.listingId, {
      listingId: params.listingId,
      userId: params.userId,
      kind: params.kind,
      endsAt: endsAt.toISOString(),
    });
    void eventBus.publishAfterCommit(event);

    return { promotionId: inserted.insertId };
  }, { retryOnDeadlock: true });

  return { kind: params.kind, endsAt: endsAt.toISOString(), promotionId: result.promotionId };
}

function toStoredKind(kind: string): string {
  const type = canonicalPromotionType(kind);
  if (type === 'featured') return 'feature';
  if (type === 'boosted') return 'boost';
  if (type === 'top_search') return 'top_of_search';
  return type;
}

function isStackable(kind: string): boolean {
  const type = canonicalPromotionType(kind);
  return type !== 'bump';
}

export async function activatePaidPromotion(orderId: number, paymentId: number, userId: number): Promise<void> {
  const order = await queryOne<Row>(
    `SELECT id, kind, reference_type, reference_id, metadata, status, total_amount, currency, user_id
       FROM orders WHERE id = ?`,
    [orderId],
  );
  if (!order) return;
  if (String(order.kind) !== 'promotion') return;
  if (String(order.reference_type) !== 'listing_promotion') return;

  const metadata = toJson<Record<string, unknown>>(order.metadata, {});
  const listingId = Number(order.reference_id ?? metadata.listingId);
  if (!Number.isFinite(listingId) || listingId <= 0) return;

  const existing = await queryOne<Row>(
    `SELECT id FROM listing_promotions WHERE order_id = ? AND status IN ('scheduled','active') LIMIT 1`,
    [orderId],
  );
  if (existing) return;

  await activatePromotion({
    listingId,
    userId: Number(order.user_id ?? userId),
    packageId: metadata.packageId ? Number(metadata.packageId) : null,
    kind: String(metadata.kind ?? 'boost'),
    days: Number(metadata.days ?? 7),
    priority: Number(metadata.priority ?? 0),
    source: 'purchase',
    amount: toNumber(order.total_amount),
    currency: (order.currency as string | null) ?? null,
    orderId,
    paymentId,
    idempotencyKey: `order:${orderId}`,
  });
}

export async function expirePromotions(now = new Date()): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT id, listing_id, kind FROM listing_promotions
      WHERE status = 'active' AND ends_at <= ?`,
    [now],
  );
  if (rows.length === 0) return 0;

  await execute(
    `UPDATE listing_promotions SET status = 'expired' WHERE status = 'active' AND ends_at <= ?`,
    [now],
  );

  for (const row of rows) {
    await refreshListingPromotionFlags(Number(row.listing_id));
    await transaction(async (connection) => {
      await recordListingEvent(
        Number(row.listing_id),
        'PROMOTION_ENDED',
        { id: null, type: 'job' },
        { promotionId: Number(row.id), kind: String(row.kind) },
        connection,
      );
      const event = await eventBus.enqueue(connection, 'listing.promotion_expired', 'listing', Number(row.listing_id), {
        listingId: Number(row.listing_id),
        kind: String(row.kind),
      });
      void eventBus.publishAfterCommit(event);
    }).catch(() => undefined);
  }
  return rows.length;
}

export async function refreshListingPromotionFlags(listingId: number, connection?: PoolConnection): Promise<void> {
  const active = await queryRows<Row>(
    `SELECT kind, ends_at, priority FROM listing_promotions
      WHERE listing_id = ? AND status = 'active' AND ends_at > CURRENT_TIMESTAMP`,
    [listingId],
    connection,
  );

  let featuredUntil: Date | null = null;
  let boostedUntil: Date | null = null;
  let isUrgent = false;
  let rank = 1;
  for (const row of active) {
    const type = canonicalPromotionType(String(row.kind));
    const ends = row.ends_at as Date;
    if (type === 'featured' || type === 'premium' || type === 'homepage') {
      if (!featuredUntil || ends.getTime() > featuredUntil.getTime()) featuredUntil = ends;
      rank = Math.max(rank, 3);
    }
    if (type === 'boosted' || type === 'top_search' || type === 'category_top' || type === 'location_top' || type === 'premium') {
      if (!boostedUntil || ends.getTime() > boostedUntil.getTime()) boostedUntil = ends;
      rank = Math.max(rank, 2);
    }
    if (type === 'urgent') isUrgent = true;
    rank = Math.max(rank, Number(row.priority ?? 0) / 40);
  }

  await execute(
    `UPDATE listings
        SET is_featured = ?, featured_until = ?, is_boosted = ?, boosted_until = ?, is_urgent = ?, search_rank = ?
      WHERE id = ?`,
    [
      featuredUntil ? 1 : 0,
      featuredUntil,
      boostedUntil ? 1 : 0,
      boostedUntil,
      isUrgent ? 1 : 0,
      rank,
      listingId,
    ],
    connection,
  );
}
