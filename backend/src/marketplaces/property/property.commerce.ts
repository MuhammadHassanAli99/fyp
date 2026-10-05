import { execute, insertAndGetId, queryOne, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { roundDecimal } from '../../core/decimal';
import { recordAudit } from '../../middleware/audit';
import { notifyUser } from '../../modules/notifications/notify';
import { createOrder } from '../../modules/payments/payments.service';

export async function buyPropertyListing(params: {
  listingId: number;
  buyerId: number;
  countryId: number;
  gatewayCode: string;
  offerId?: number | null;
  returnUrl?: string | null;
}) {
  const listing = await queryOne<Row>(
    `SELECT l.*, pd.property_id, pd.property_kind, pd.area_value, pd.area_unit, pd.area_sqm,
            a.name AS area_name, pd.society_name
       FROM listings l
       JOIN property_listing_details pd ON pd.listing_id = l.id
       LEFT JOIN areas a ON a.id = l.area_id
      WHERE l.id = ? AND l.deleted_at IS NULL`,
    [params.listingId],
  );
  if (!listing) throw notFound('Property listing');
  if (Number(listing.marketplace_id) !== 2) throw badRequest('Not a property listing');
  if (Number(listing.user_id) === params.buyerId) throw forbidden('You cannot buy your own listing');
  if (String(listing.status) !== 'published' && String(listing.status) !== 'reserved') {
    throw conflict('This listing is not available');
  }
  if (String(listing.operation) === 'rent') throw badRequest('Use booking or a rental application for rent listings');

  const price = toNumber(listing.price);
  const currency = String(listing.currency ?? '');
  if (price === null || price <= 0 || !currency) throw badRequest('This listing does not have a fixed price');

  const checkout = await createOrder(params.buyerId, {
    kind: 'listing_purchase',
    amount: Number(roundDecimal(price, 2)),
    currency,
    countryId: params.countryId,
    gatewayCode: params.gatewayCode,
    description: `Property listing ${listing.reference_code}`,
    referenceType: 'listing',
    referenceId: params.listingId,
    returnUrl: params.returnUrl ?? null,
    metadata: {
      legalTransfer: 'not_performed_by_marketplace',
      note: 'Payment does not transfer legal title. Regional legal processes remain separate.',
    },
  });

  await snapshotPropertyTransaction({
    orderId: checkout.order.id,
    offerId: params.offerId ?? null,
    listingId: params.listingId,
    propertyId: listing.property_id === null ? null : Number(listing.property_id),
    transactionType: 'sale',
    price,
    currency,
    sellerId: Number(listing.user_id),
    buyerId: params.buyerId,
  });

  await execute(`UPDATE listings SET status = 'reserved' WHERE id = ? AND status IN ('published','reserved')`, [
    params.listingId,
  ]);

  await recordAudit({
    action: 'property.order.created',
    entityType: 'order',
    entityId: checkout.order.id,
    after: { listingId: params.listingId, amount: String(price), currency },
  });

  await notifyUser({
    userId: Number(listing.user_id),
    categoryCode: 'property.payment',
    title: 'Property checkout started',
    body: `A buyer started checkout for ${String(listing.title)}. Marketplace payment is not a legal title transfer.`,
    actionType: 'payment',
    actionTarget: checkout.order.uuid,
  });

  return {
    ...checkout,
    listingId: params.listingId,
    originalPrice: price,
    originalCurrency: currency,
    legalTransfer: 'not_performed_by_marketplace',
    disclaimer:
      'Paying through the marketplace does not transfer legal ownership. Completion follows the regional legal process.',
  };
}

export async function snapshotPropertyTransaction(params: {
  orderId?: number | null;
  offerId?: number | null;
  leaseId?: number | null;
  bookingId?: number | null;
  listingId: number;
  propertyId: number | null;
  transactionType: 'sale' | 'rent' | 'booking';
  price: number;
  currency: string;
  sellerId: number;
  buyerId: number;
}) {
  const listing = await queryOne<Row>(
    `SELECT l.country_id, l.city_id, pd.property_kind, pd.area_value, pd.area_unit, pd.area_sqm,
            pd.property_id, a.name AS area_name, pd.society_name, l.operation
       FROM listings l
       JOIN property_listing_details pd ON pd.listing_id = l.id
       LEFT JOIN areas a ON a.id = l.area_id
      WHERE l.id = ?`,
    [params.listingId],
  );
  if (!listing) return;
  const propertyId = params.propertyId ?? (listing.property_id === null ? null : Number(listing.property_id));
  if (!propertyId) return;

  const badges = await queryRowsSafe(propertyId, params.listingId);

  await insertAndGetId(
    `INSERT INTO property_transaction_snapshots
       (order_id, offer_id, lease_id, booking_id, property_id, listing_id, property_kind, transaction_type,
        area_value, area_unit, area_sqm, location_label, country_id, city_id, price, currency,
        seller_id, buyer_id, verification_state, payment_status, legal_status, snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_payment', 'not_started', ?)`,
    [
      params.orderId ?? null,
      params.offerId ?? null,
      params.leaseId ?? null,
      params.bookingId ?? null,
      propertyId,
      params.listingId,
      String(listing.property_kind),
      params.transactionType,
      toNumber(listing.area_value),
      listing.area_unit,
      toNumber(listing.area_sqm),
      String(listing.area_name || listing.society_name || ''),
      listing.country_id === null ? null : Number(listing.country_id),
      listing.city_id === null ? null : Number(listing.city_id),
      roundDecimal(params.price, 2),
      params.currency,
      params.sellerId,
      params.buyerId,
      JSON.stringify(badges),
      JSON.stringify({
        transactionType: params.transactionType,
        legalNote: 'Marketplace payment is separate from legal transfer or lease execution.',
      }),
    ],
  );
}

async function queryRowsSafe(propertyId: number, listingId: number) {
  const { queryRows } = await import('../../db/query');
  const rows = await queryRows<Row>(
    `SELECT dimension, status FROM property_verifications
      WHERE property_id = ? AND (listing_id = ? OR listing_id IS NULL)`,
    [propertyId, listingId],
  ).catch(() => [] as Row[]);
  return Object.fromEntries(rows.map((row) => [String(row.dimension), String(row.status)]));
}
