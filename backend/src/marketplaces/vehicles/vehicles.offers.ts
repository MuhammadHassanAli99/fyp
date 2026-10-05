import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { recordAudit } from '../../middleware/audit';
import { notifyUser } from '../../modules/notifications/notify';
import { recordListingLead } from '../../modules/seller/seller.leads-ingest';
import { roundDecimal } from '../../core/decimal';
import { assertOfferTransition, type OfferStatus } from './vehicles.offer-state';
import { VEHICLE_MARKETPLACE_ID } from './vehicles.rules';

async function loadListingForOffer(listingId: number): Promise<Row> {
  const row = await queryOne<Row>(
    `SELECT l.id, l.user_id, l.status, l.operation, l.allow_offers, l.price, l.currency, l.title, l.marketplace_id
       FROM listings l
      WHERE l.id = ? AND l.deleted_at IS NULL`,
    [listingId],
  );
  if (!row) throw notFound('Listing');
  if (Number(row.marketplace_id) !== VEHICLE_MARKETPLACE_ID) {
    throw badRequest('Offers on this route are for Vehicle listings');
  }
  return row;
}

function mapOffer(row: Row) {
  return {
    id: Number(row.id),
    listingId: Number(row.listing_id),
    buyerId: Number(row.buyer_id),
    sellerId: Number(row.seller_id),
    amount: toNumber(row.amount),
    currency: String(row.currency),
    message: (row.message as string | null) ?? null,
    conditions: (row.conditions as string | null) ?? null,
    depositAmount: toNumber(row.deposit_amount),
    status: String(row.status),
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    expiresAt: row.expires_at ? (row.expires_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

async function auditOffer(
  offerId: number,
  actorId: number,
  action: string,
  fromStatus: string | null,
  toStatus: string,
  amount?: string | number | null,
  currency?: string | null,
  message?: string | null,
) {
  await execute(
    `INSERT INTO vehicle_offer_events
       (offer_id, actor_id, action, from_status, to_status, amount, currency, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [offerId, actorId, action, fromStatus, toStatus, amount ?? null, currency ?? null, message ?? null],
  );
  await recordAudit({
    action: `vehicle.offer.${action}`,
    entityType: 'listing_offer',
    entityId: offerId,
    after: { fromStatus, toStatus, amount, currency },
  });
}

export async function createVehicleOffer(params: {
  listingId: number;
  buyerId: number;
  amount: number;
  currency: string;
  message?: string | null;
  conditions?: string | null;
  depositAmount?: number | null;
  expiresAt?: string | null;
}) {
  const listing = await loadListingForOffer(params.listingId);
  if (Number(listing.user_id) === params.buyerId) throw badRequest('You cannot offer on your own listing');
  if (String(listing.status) !== 'published') throw conflict('This listing is not open for offers');
  if (!Number(listing.allow_offers)) throw forbidden('The seller is not accepting offers');
  if (String(listing.operation) === 'rent') {
    throw badRequest('Use a rental booking for rent listings');
  }
  if (params.amount <= 0) throw badRequest('Offer amount must be positive');

  const amount = roundDecimal(params.amount, 2);
  const id = await insertAndGetId(
    `INSERT INTO listing_offers
       (listing_id, buyer_id, seller_id, amount, currency, message, conditions, deposit_amount, deposit_currency, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      params.listingId,
      params.buyerId,
      Number(listing.user_id),
      amount,
      params.currency,
      params.message ?? null,
      params.conditions ?? null,
      params.depositAmount ?? null,
      params.depositAmount ? params.currency : null,
      params.expiresAt ?? null,
    ],
  );
  await auditOffer(id, params.buyerId, 'created', null, 'pending', amount, params.currency, params.message);
  void recordListingLead({
    listingId: params.listingId,
    buyerId: params.buyerId,
    channel: 'offer',
  });
  await notifyUser({
    userId: Number(listing.user_id),
    categoryCode: 'vehicle.offer',
    title: 'New vehicle offer',
    body: `An offer of ${amount} ${params.currency} was made on ${String(listing.title)}.`,
    actionType: 'offer',
    actionTarget: String(params.listingId),
    data: { listingId: params.listingId, offerId: id, summary: `Offer ${amount} ${params.currency}` },
  });
  return getVehicleOffer(id, params.buyerId, false);
}

export async function getVehicleOffer(id: number, userId: number, isStaff: boolean) {
  const row = await queryOne<Row>('SELECT * FROM listing_offers WHERE id = ?', [id]);
  if (!row) throw notFound('Offer');
  if (!isStaff && Number(row.buyer_id) !== userId && Number(row.seller_id) !== userId) {
    throw forbidden('This offer does not belong to you');
  }
  return mapOffer(row);
}

export async function listVehicleOffers(params: { listingId?: number; userId: number; role: 'buyer' | 'seller' }) {
  const rows = await queryRows<Row>(
    params.listingId
      ? `SELECT * FROM listing_offers WHERE listing_id = ? AND (buyer_id = ? OR seller_id = ?) ORDER BY created_at DESC LIMIT 200`
      : `SELECT * FROM listing_offers WHERE ${params.role === 'seller' ? 'seller_id' : 'buyer_id'} = ? ORDER BY created_at DESC LIMIT 200`,
    params.listingId ? [params.listingId, params.userId, params.userId] : [params.userId],
  );
  return rows.map(mapOffer);
}

export async function counterVehicleOffer(params: {
  offerId: number;
  userId: number;
  amount: number;
  currency: string;
  message?: string | null;
  conditions?: string | null;
  depositAmount?: number | null;
}) {
  const current = await queryOne<Row>('SELECT * FROM listing_offers WHERE id = ?', [params.offerId]);
  if (!current) throw notFound('Offer');
  if (Number(current.buyer_id) !== params.userId && Number(current.seller_id) !== params.userId) {
    throw forbidden('This offer does not belong to you');
  }
  assertOfferTransition(current.status as OfferStatus, 'countered');
  const amount = roundDecimal(params.amount, 2);
  const id = await insertAndGetId(
    `INSERT INTO listing_offers
       (listing_id, buyer_id, seller_id, amount, currency, message, conditions, deposit_amount, deposit_currency,
        status, parent_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      Number(current.listing_id),
      Number(current.buyer_id),
      Number(current.seller_id),
      amount,
      params.currency,
      params.message ?? null,
      params.conditions ?? null,
      params.depositAmount ?? null,
      params.depositAmount ? params.currency : null,
      params.offerId,
      current.expires_at,
    ],
  );
  await execute(`UPDATE listing_offers SET status = 'countered', responded_at = CURRENT_TIMESTAMP WHERE id = ?`, [
    params.offerId,
  ]);
  await auditOffer(params.offerId, params.userId, 'countered', String(current.status), 'countered', amount, params.currency);
  const notifyId =
    params.userId === Number(current.seller_id) ? Number(current.buyer_id) : Number(current.seller_id);
  await notifyUser({
    userId: notifyId,
    categoryCode: 'vehicle.offer',
    title: 'Counter offer',
    body: `A counter offer of ${amount} ${params.currency} was made.`,
    actionType: 'offer',
    actionTarget: String(current.listing_id),
    data: { listingId: Number(current.listing_id), offerId: id, summary: `Counter ${amount} ${params.currency}` },
  });
  return getVehicleOffer(id, params.userId, false);
}

export async function respondToVehicleOffer(params: {
  offerId: number;
  userId: number;
  action: 'accepted' | 'rejected' | 'cancelled';
  message?: string | null;
}) {
  const current = await queryOne<Row>('SELECT * FROM listing_offers WHERE id = ?', [params.offerId]);
  if (!current) throw notFound('Offer');
  const isBuyer = Number(current.buyer_id) === params.userId;
  const isSeller = Number(current.seller_id) === params.userId;
  if (!isBuyer && !isSeller) throw forbidden('This offer does not belong to you');
  if ((params.action === 'accepted' || params.action === 'rejected') && !isSeller) {
    throw forbidden('Only the seller can accept or reject an offer');
  }
  const toStatus = params.action === 'cancelled' ? 'cancelled' : params.action;
  assertOfferTransition(String(current.status) as OfferStatus, toStatus as OfferStatus);
  await execute(
    `UPDATE listing_offers SET status = ?, responded_at = CURRENT_TIMESTAMP, message = COALESCE(?, message) WHERE id = ?`,
    [toStatus, params.message ?? null, params.offerId],
  );
  await auditOffer(params.offerId, params.userId, params.action, String(current.status), toStatus);
  const other = isSeller ? Number(current.buyer_id) : Number(current.seller_id);
  await notifyUser({
    userId: other,
    categoryCode: 'vehicle.offer',
    title: `Offer ${toStatus}`,
    body: `The offer is now ${toStatus}.`,
    actionType: 'offer',
    actionTarget: String(current.listing_id),
    data: { listingId: Number(current.listing_id), offerId: params.offerId, summary: `Offer ${toStatus}` },
  });
  if (toStatus === 'accepted') {
    await execute(`UPDATE listings SET status = 'reserved' WHERE id = ? AND status = 'published'`, [
      Number(current.listing_id),
    ]);
  }
  return getVehicleOffer(params.offerId, params.userId, false);
}

export async function expireVehicleOffers(): Promise<number> {
  const result = await execute(
    `UPDATE listing_offers o
       JOIN listings l ON l.id = o.listing_id
        SET o.status = 'expired'
      WHERE l.marketplace_id = ${VEHICLE_MARKETPLACE_ID}
        AND o.status IN ('pending','countered')
        AND o.expires_at IS NOT NULL
        AND o.expires_at < CURRENT_TIMESTAMP`,
  );
  return result.affectedRows;
}
