import { execute, insertAndGetId, queryOne, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { roundDecimal } from '../../core/decimal';
import { recordAudit } from '../../middleware/audit';
import { notifyUser } from '../../modules/notifications/notify';
import { createOrder } from '../../modules/payments/payments.service';
import { VEHICLE_MARKETPLACE_ID } from './vehicles.rules';

export async function buyVehicleListing(params: {
  listingId: number;
  buyerId: number;
  countryId: number;
  gatewayCode: string;
  offerId?: number | null;
  returnUrl?: string | null;
}) {
  const listing = await queryOne<Row>(
    `SELECT l.*, vd.vehicle_id, vd.vehicle_type, vd.make_name, vd.model_name, vd.year, vd.mileage_km, vd.vin
       FROM listings l
       JOIN vehicle_listing_details vd ON vd.listing_id = l.id
      WHERE l.id = ? AND l.deleted_at IS NULL`,
    [params.listingId],
  );
  if (!listing) throw notFound('Vehicle listing');
  if (Number(listing.marketplace_id) !== VEHICLE_MARKETPLACE_ID) throw badRequest('Not a vehicle listing');
  if (Number(listing.user_id) === params.buyerId) throw forbidden('You cannot buy your own listing');
  if (String(listing.status) !== 'published' && String(listing.status) !== 'reserved') {
    throw conflict('This listing is not available');
  }
  if (String(listing.operation) === 'rent') throw badRequest('Use a rental booking for rent listings');
  if (String(listing.operation) === 'auction') throw badRequest('Use bidding for auction listings');

  const price = toNumber(listing.price);
  const currency = String(listing.currency ?? '');
  if (price === null || price <= 0 || !currency) throw badRequest('This listing does not have a fixed price');

  const checkout = await createOrder(params.buyerId, {
    kind: 'listing_purchase',
    amount: Number(roundDecimal(price, 2)),
    currency,
    countryId: params.countryId,
    gatewayCode: params.gatewayCode,
    description: `Vehicle listing ${listing.reference_code}`,
    referenceType: 'listing',
    referenceId: params.listingId,
    returnUrl: params.returnUrl ?? null,
    metadata: {
      legalTransfer: 'not_performed_by_marketplace',
      note: 'Payment does not transfer legal title or complete registration.',
    },
  });

  await snapshotVehicleTransaction({
    orderId: checkout.order.id,
    offerId: params.offerId ?? null,
    listingId: params.listingId,
    vehicleId: listing.vehicle_id === null ? null : Number(listing.vehicle_id),
    transactionType: 'sale',
    price,
    currency,
    sellerId: Number(listing.user_id),
    buyerId: params.buyerId,
  });

  await execute(`UPDATE listings SET status = 'reserved' WHERE id = ? AND status IN ('published','reserved')`, [
    params.listingId,
  ]);
  if (listing.vehicle_id) {
    await execute(`UPDATE vehicles SET availability_status = 'reserved' WHERE id = ?`, [listing.vehicle_id]);
  }

  await recordAudit({
    action: 'vehicle.order.created',
    entityType: 'order',
    entityId: checkout.order.id,
    after: { listingId: params.listingId, amount: String(price), currency },
  });

  await notifyUser({
    userId: Number(listing.user_id),
    categoryCode: 'vehicle.payment',
    title: 'Vehicle checkout started',
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
      'Paying through the marketplace does not transfer legal ownership or complete destination registration.',
  };
}

export async function snapshotVehicleTransaction(params: {
  orderId?: number | null;
  offerId?: number | null;
  bookingId?: number | null;
  listingId: number;
  vehicleId: number | null;
  transactionType: 'sale' | 'rent' | 'auction' | 'parts';
  price: number;
  currency: string;
  sellerId: number;
  buyerId: number;
}) {
  const listing = await queryOne<Row>(
    `SELECT l.country_id, vd.vehicle_id, vd.vehicle_type, vd.make_name, vd.model_name, vd.year, vd.mileage_km, vd.vin
       FROM listings l
       JOIN vehicle_listing_details vd ON vd.listing_id = l.id
      WHERE l.id = ?`,
    [params.listingId],
  );
  if (!listing) return;
  const vehicleId = params.vehicleId ?? (listing.vehicle_id === null ? null : Number(listing.vehicle_id));
  if (!vehicleId) return;
  await insertAndGetId(
    `INSERT INTO vehicle_transaction_snapshots
       (order_id, offer_id, booking_id, vehicle_id, listing_id, vehicle_type, transaction_type,
        make_name, model_name, year, mileage_km, vin, price, currency, seller_id, buyer_id, snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.orderId ?? null,
      params.offerId ?? null,
      params.bookingId ?? null,
      vehicleId,
      params.listingId,
      String(listing.vehicle_type),
      params.transactionType,
      listing.make_name,
      listing.model_name,
      listing.year,
      listing.mileage_km,
      listing.vin,
      roundDecimal(params.price, 2),
      params.currency,
      params.sellerId,
      params.buyerId,
      JSON.stringify({
        originalPrice: params.price,
        originalCurrency: params.currency,
        legalTransfer: 'not_performed_by_marketplace',
      }),
    ],
  );
}
