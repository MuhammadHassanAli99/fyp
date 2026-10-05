import { execute, insertAndGetId, queryOne, queryRows, transaction, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { uuid } from '../../core/security/crypto';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { roundDecimal } from '../../core/decimal';
import { recordAudit } from '../../middleware/audit';
import { notifyUser } from '../../modules/notifications/notify';
import { createOrder } from '../../modules/payments/payments.service';
import { snapshotVehicleTransaction } from './vehicles.commerce';
import { VEHICLE_MARKETPLACE_ID } from './vehicles.rules';

async function loadVehicleListing(listingId: number): Promise<Row> {
  const row = await queryOne<Row>(
    `SELECT l.*, vd.vehicle_id, vd.rent_period, vd.security_deposit, vd.km_limit_per_day, vd.extra_km_rate
       FROM listings l
       JOIN vehicle_listing_details vd ON vd.listing_id = l.id
      WHERE l.id = ? AND l.deleted_at IS NULL`,
    [listingId],
  );
  if (!row) throw notFound('Vehicle listing');
  if (Number(row.marketplace_id) !== VEHICLE_MARKETPLACE_ID) throw badRequest('Not a vehicle listing');
  return row;
}

export async function upsertAvailability(params: {
  listingId: number;
  userId: number;
  isStaff: boolean;
  availableFrom?: string | null;
  availableUntil?: string | null;
  status?: 'available' | 'reserved' | 'rented' | 'maintenance' | 'sold' | 'unavailable';
  pickupLocation?: string | null;
  returnLocation?: string | null;
  blocks?: Array<{ startDate: string; endDate: string; reason?: string }>;
}) {
  const listing = await loadVehicleListing(params.listingId);
  if (Number(listing.user_id) !== params.userId && !params.isStaff) {
    throw forbidden('Only the listing owner can edit availability');
  }
  await execute(
    `INSERT INTO vehicle_availability
       (listing_id, vehicle_id, available_from, available_until, status, pickup_location, return_location)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       available_from = VALUES(available_from),
       available_until = VALUES(available_until),
       status = VALUES(status),
       pickup_location = VALUES(pickup_location),
       return_location = VALUES(return_location)`,
    [
      params.listingId,
      listing.vehicle_id ?? null,
      params.availableFrom ?? null,
      params.availableUntil ?? null,
      params.status ?? 'available',
      params.pickupLocation ?? null,
      params.returnLocation ?? null,
    ],
  );
  if (params.blocks) {
    await execute('DELETE FROM vehicle_availability_blocks WHERE listing_id = ?', [params.listingId]);
    for (const block of params.blocks) {
      await execute(
        `INSERT INTO vehicle_availability_blocks (listing_id, start_date, end_date, reason)
         VALUES (?, ?, ?, ?)`,
        [params.listingId, block.startDate, block.endDate, block.reason ?? 'blocked'],
      );
    }
  }
  return getAvailability(params.listingId);
}

export async function getAvailability(listingId: number) {
  const row = await queryOne<Row>('SELECT * FROM vehicle_availability WHERE listing_id = ?', [listingId]);
  const blocks = await queryRows<Row>(
    `SELECT start_date, end_date, reason FROM vehicle_availability_blocks WHERE listing_id = ? ORDER BY start_date`,
    [listingId],
  );
  return {
    listingId,
    availableFrom: row?.available_from ? String(row.available_from).slice(0, 10) : null,
    availableUntil: row?.available_until ? String(row.available_until).slice(0, 10) : null,
    status: row ? String(row.status) : 'available',
    pickupLocation: (row?.pickup_location as string | null) ?? null,
    returnLocation: (row?.return_location as string | null) ?? null,
    blocks: blocks.map((block) => ({
      startDate: String(block.start_date).slice(0, 10),
      endDate: String(block.end_date).slice(0, 10),
      reason: String(block.reason),
    })),
  };
}

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export async function createRentalBooking(params: {
  listingId: number;
  renterId: number;
  countryId: number;
  startDate: string;
  endDate: string;
  durationCode?: string | null;
  gatewayCode: string;
}) {
  if (params.endDate < params.startDate) throw badRequest('Return date must be on or after pickup date');
  const listing = await loadVehicleListing(params.listingId);
  if (Number(listing.user_id) === params.renterId) throw forbidden('You cannot rent your own vehicle');
  if (String(listing.status) !== 'published') throw conflict('This listing is not available');
  if (String(listing.operation) !== 'rent') throw badRequest('This listing is not a rental');

  const blocked = await queryRows<Row>(
    `SELECT start_date, end_date FROM vehicle_availability_blocks WHERE listing_id = ?`,
    [params.listingId],
  );
  for (const block of blocked) {
    if (
      rangesOverlap(
        params.startDate,
        params.endDate,
        String(block.start_date).slice(0, 10),
        String(block.end_date).slice(0, 10),
      )
    ) {
      throw conflict('Those dates are blocked');
    }
  }
  const existing = await queryRows<Row>(
    `SELECT start_date, end_date FROM vehicle_rental_bookings
      WHERE listing_id = ? AND status IN ('pending','confirmed','active')`,
    [params.listingId],
  );
  for (const booking of existing) {
    if (
      rangesOverlap(
        params.startDate,
        params.endDate,
        String(booking.start_date).slice(0, 10),
        String(booking.end_date).slice(0, 10),
      )
    ) {
      throw conflict('Those dates are already booked');
    }
  }

  const nights =
    Math.max(1, Math.round((new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) / 86_400_000));
  const daily = toNumber(listing.price) ?? 0;
  const amount = Number(roundDecimal(daily * nights, 2));
  const currency = String(listing.currency ?? '');
  if (amount <= 0 || !currency) throw badRequest('This rental does not have a price');

  return transaction(async (connection) => {
    const checkout = await createOrder(params.renterId, {
      kind: 'booking_payment',
      amount,
      currency,
      countryId: params.countryId,
      gatewayCode: params.gatewayCode,
      description: `Vehicle rental ${listing.reference_code}`,
      referenceType: 'listing',
      referenceId: params.listingId,
    });

    const id = await insertAndGetId(
      `INSERT INTO vehicle_rental_bookings
         (uuid, listing_id, vehicle_id, renter_id, owner_id, start_date, end_date, duration_code,
          amount, currency, deposit_amount, mileage_allowance, extra_mileage_rate, order_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        uuid(),
        params.listingId,
        listing.vehicle_id ?? null,
        params.renterId,
        Number(listing.user_id),
        params.startDate,
        params.endDate,
        params.durationCode ?? listing.rent_period ?? null,
        amount,
        currency,
        listing.security_deposit,
        listing.km_limit_per_day,
        listing.extra_km_rate,
        checkout.order.id,
      ],
      connection,
    );

    await execute(
      `INSERT INTO vehicle_availability_blocks (listing_id, start_date, end_date, reason)
       VALUES (?, ?, ?, 'booked')`,
      [params.listingId, params.startDate, params.endDate],
      connection,
    );

    await snapshotVehicleTransaction({
      orderId: checkout.order.id,
      bookingId: id,
      listingId: params.listingId,
      vehicleId: listing.vehicle_id === null ? null : Number(listing.vehicle_id),
      transactionType: 'rent',
      price: amount,
      currency,
      sellerId: Number(listing.user_id),
      buyerId: params.renterId,
    });

    await recordAudit({
      action: 'vehicle.rental.booked',
      entityType: 'vehicle_rental_booking',
      entityId: id,
      after: { listingId: params.listingId, startDate: params.startDate, endDate: params.endDate },
    });
    await notifyUser({
      userId: Number(listing.user_id),
      categoryCode: 'vehicle.rental',
      title: 'New rental booking',
      body: `${String(listing.title)} was booked from ${params.startDate} to ${params.endDate}.`,
      actionType: 'listing',
      actionTarget: String(params.listingId),
      data: { listingId: params.listingId, summary: 'New rental booking' },
    });

    return { bookingId: id, ...checkout, amount, currency, nights };
  });
}

export async function expireRentalBookings(): Promise<number> {
  const result = await execute(
    `UPDATE vehicle_rental_bookings
        SET status = 'expired'
      WHERE status = 'pending' AND start_date < CURRENT_DATE`,
  );
  return result.affectedRows;
}
