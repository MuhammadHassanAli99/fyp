import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { uuid } from '../../core/security/crypto';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { roundDecimal } from '../../core/decimal';
import { recordAudit } from '../../middleware/audit';
import { notifyUser } from '../../modules/notifications/notify';
import { createOrder } from '../../modules/payments/payments.service';
import { snapshotPropertyTransaction } from './property.commerce';
import { canReviewApplication, canTransitionLease } from './property.rules';

async function loadPropertyListing(listingId: number): Promise<Row> {
  const row = await queryOne<Row>(
    `SELECT l.*, pd.property_id, pd.rent_period, pd.min_stay_days, pd.max_stay_days, pd.security_deposit,
            pd.occupancy_type, pd.beds, pd.check_in_time, pd.check_out_time, pd.occupancy_max
       FROM listings l
       JOIN property_listing_details pd ON pd.listing_id = l.id
      WHERE l.id = ? AND l.deleted_at IS NULL`,
    [listingId],
  );
  if (!row) throw notFound('Property listing');
  return row;
}

export async function upsertAvailability(params: {
  listingId: number;
  userId: number;
  isStaff: boolean;
  availableFrom?: string | null;
  availableUntil?: string | null;
  minStayDays?: number | null;
  maxStayDays?: number | null;
  occupancyMax?: number | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  instantBook?: boolean;
  status?: 'available' | 'limited' | 'unavailable';
  blocks?: Array<{ startDate: string; endDate: string; reason?: string }>;
}) {
  const listing = await loadPropertyListing(params.listingId);
  if (Number(listing.user_id) !== params.userId && !params.isStaff) {
    throw forbidden('Only the listing owner can edit availability');
  }
  await execute(
    `INSERT INTO property_availability
       (listing_id, property_id, available_from, available_until, min_stay_days, max_stay_days,
        occupancy_max, check_in_time, check_out_time, instant_book, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       available_from = VALUES(available_from),
       available_until = VALUES(available_until),
       min_stay_days = VALUES(min_stay_days),
       max_stay_days = VALUES(max_stay_days),
       occupancy_max = VALUES(occupancy_max),
       check_in_time = VALUES(check_in_time),
       check_out_time = VALUES(check_out_time),
       instant_book = VALUES(instant_book),
       status = VALUES(status)`,
    [
      params.listingId,
      listing.property_id ?? null,
      params.availableFrom ?? null,
      params.availableUntil ?? null,
      params.minStayDays ?? null,
      params.maxStayDays ?? null,
      params.occupancyMax ?? null,
      params.checkInTime ?? null,
      params.checkOutTime ?? null,
      params.instantBook ? 1 : 0,
      params.status ?? 'available',
    ],
  );
  if (params.blocks) {
    await execute('DELETE FROM property_availability_blocks WHERE listing_id = ?', [params.listingId]);
    for (const block of params.blocks) {
      await execute(
        `INSERT INTO property_availability_blocks (listing_id, start_date, end_date, reason)
         VALUES (?, ?, ?, ?)`,
        [params.listingId, block.startDate, block.endDate, block.reason ?? 'blocked'],
      );
    }
  }
  return getAvailability(params.listingId);
}

export async function getAvailability(listingId: number) {
  const listing = await loadPropertyListing(listingId);
  const row = await queryOne<Row>('SELECT * FROM property_availability WHERE listing_id = ?', [listingId]);
  const blocks = await queryRows<Row>(
    `SELECT id, start_date, end_date, reason FROM property_availability_blocks
      WHERE listing_id = ? ORDER BY start_date`,
    [listingId],
  );
  const rooms = await queryRows<Row>(
    `SELECT id, code, name, occupancy, bed_count, privacy, quantity FROM property_room_types WHERE listing_id = ?`,
    [listingId],
  );
  return {
    listingId,
    availableFrom: row?.available_from ? String(row.available_from).slice(0, 10) : (listing.available_from ? String(listing.available_from).slice(0, 10) : null),
    availableUntil: row?.available_until ? String(row.available_until).slice(0, 10) : null,
    minStayDays: row?.min_stay_days === null || row?.min_stay_days === undefined ? (listing.min_stay_days === null ? null : Number(listing.min_stay_days)) : Number(row.min_stay_days),
    maxStayDays: row?.max_stay_days === null || row?.max_stay_days === undefined ? (listing.max_stay_days === null ? null : Number(listing.max_stay_days)) : Number(row.max_stay_days),
    occupancyMax: row?.occupancy_max === null || row?.occupancy_max === undefined ? null : Number(row.occupancy_max),
    checkInTime: (row?.check_in_time as string | null) ?? (listing.check_in_time as string | null) ?? null,
    checkOutTime: (row?.check_out_time as string | null) ?? (listing.check_out_time as string | null) ?? null,
    instantBook: Number(row?.instant_book ?? 0) === 1,
    status: (row?.status as string | null) ?? 'available',
    blocks: blocks.map((block) => ({
      id: Number(block.id),
      startDate: String(block.start_date).slice(0, 10),
      endDate: String(block.end_date).slice(0, 10),
      reason: String(block.reason),
    })),
    roomTypes: rooms.map((room) => ({
      id: Number(room.id),
      code: String(room.code),
      name: String(room.name),
      occupancy: Number(room.occupancy),
      bedCount: room.bed_count === null ? null : Number(room.bed_count),
      privacy: String(room.privacy),
      quantity: Number(room.quantity),
    })),
  };
}

export async function datesAreAvailable(listingId: number, start: string, end: string): Promise<boolean> {
  const overlap = await queryOne<Row>(
    `SELECT id FROM property_availability_blocks
      WHERE listing_id = ? AND start_date < ? AND end_date > ? LIMIT 1`,
    [listingId, end, start],
  );
  if (overlap) return false;
  const booking = await queryOne<Row>(
    `SELECT id FROM property_bookings
      WHERE listing_id = ? AND status IN ('pending','confirmed','checked_in')
        AND check_in < ? AND check_out > ? LIMIT 1`,
    [listingId, end, start],
  );
  return !booking;
}

export async function applyForRental(params: {
  listingId: number;
  applicantId: number;
  message?: string | null;
  occupants?: number | null;
  desiredStart?: string | null;
  desiredEnd?: string | null;
}) {
  const listing = await loadPropertyListing(params.listingId);
  if (String(listing.operation) !== 'rent') throw badRequest('Applications are for rent listings');
  if (Number(listing.user_id) === params.applicantId) throw badRequest('You cannot apply to your own listing');
  const id = await insertAndGetId(
    `INSERT INTO property_applications
       (uuid, listing_id, property_id, applicant_id, landlord_id, message, occupants, desired_start, desired_end, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
    [
      uuid(),
      params.listingId,
      listing.property_id ?? null,
      params.applicantId,
      Number(listing.user_id),
      params.message ?? null,
      params.occupants ?? null,
      params.desiredStart ?? null,
      params.desiredEnd ?? null,
    ],
  );
  await recordAudit({
    action: 'property.application.submitted',
    entityType: 'property_application',
    entityId: id,
    after: { listingId: params.listingId },
  });
  await notifyUser({
    userId: Number(listing.user_id),
    categoryCode: 'property.application',
    title: 'New rental application',
    body: `Someone applied for ${String(listing.title)}.`,
    actionType: 'listing',
    actionTarget: String(params.listingId),
    data: { listingId: params.listingId, applicationId: id },
  });
  return getApplication(id, params.applicantId, false);
}

export async function listApplications(params: { listingId?: number; userId: number; role: 'applicant' | 'landlord' }) {
  const rows = await queryRows<Row>(
    params.listingId
      ? `SELECT * FROM property_applications WHERE listing_id = ? AND (applicant_id = ? OR landlord_id = ?) ORDER BY created_at DESC LIMIT 200`
      : `SELECT * FROM property_applications WHERE ${params.role === 'landlord' ? 'landlord_id' : 'applicant_id'} = ? ORDER BY created_at DESC LIMIT 200`,
    params.listingId ? [params.listingId, params.userId, params.userId] : [params.userId],
  );
  return rows.map(mapApplication);
}

export async function getApplication(id: number, userId: number, isStaff: boolean) {
  const row = await queryOne<Row>('SELECT * FROM property_applications WHERE id = ?', [id]);
  if (!row) throw notFound('Application');
  if (!isStaff && Number(row.applicant_id) !== userId && Number(row.landlord_id) !== userId) {
    throw forbidden('This application does not belong to you');
  }
  return mapApplication(row);
}

export async function reviewApplication(params: {
  applicationId: number;
  userId: number;
  isStaff: boolean;
  decision: 'accepted' | 'rejected';
  reason?: string | null;
}) {
  const row = await queryOne<Row>('SELECT * FROM property_applications WHERE id = ?', [params.applicationId]);
  if (!row) throw notFound('Application');
  if (Number(row.landlord_id) !== params.userId && !params.isStaff) {
    throw forbidden('Only the landlord can review this application');
  }
  if (!canReviewApplication(String(row.status))) {
    throw conflict('This application is no longer awaiting review');
  }
  await execute(
    `UPDATE property_applications SET status = ?, rejection_reason = ? WHERE id = ?`,
    [params.decision, params.reason ?? null, params.applicationId],
  );
  await notifyUser({
    userId: Number(row.applicant_id),
    categoryCode: 'property.application',
    title: params.decision === 'accepted' ? 'Application accepted' : 'Application rejected',
    body: params.decision === 'accepted' ? 'Your rental application was accepted.' : (params.reason ?? 'Your application was not accepted.'),
    actionType: 'listing',
    actionTarget: String(row.listing_id),
  });
  if (params.decision === 'accepted') {
    const lease = await createLeaseFromApplication(params.applicationId);
    return { application: await getApplication(params.applicationId, params.userId, params.isStaff), lease };
  }
  return { application: await getApplication(params.applicationId, params.userId, params.isStaff), lease: null };
}

export async function createLeaseFromApplication(applicationId: number) {
  const app = await queryOne<Row>(
    `SELECT a.*, l.price, l.currency, pd.security_deposit, pd.rent_period, pd.property_id AS details_property_id
       FROM property_applications a
       JOIN listings l ON l.id = a.listing_id
       JOIN property_listing_details pd ON pd.listing_id = a.listing_id
      WHERE a.id = ?`,
    [applicationId],
  );
  if (!app) throw notFound('Application');
  const propertyId = Number(app.property_id ?? app.details_property_id);
  if (!propertyId) throw badRequest('This listing is not linked to a property asset');
  const start = app.desired_start ? String(app.desired_start).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const frequency = String(app.rent_period ?? 'monthly') === 'weekly' ? 'weekly' : 'monthly';
  const id = await insertAndGetId(
    `INSERT INTO property_leases
       (uuid, property_id, listing_id, landlord_id, tenant_id, application_id, start_date, end_date,
        rent_amount, currency, deposit_amount, payment_frequency, status, next_due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_signature', ?)`,
    [
      uuid(),
      propertyId,
      Number(app.listing_id),
      Number(app.landlord_id),
      Number(app.applicant_id),
      applicationId,
      start,
      app.desired_end ? String(app.desired_end).slice(0, 10) : null,
      roundDecimal(toNumber(app.price) ?? 0, 2),
      String(app.currency ?? 'USD'),
      toNumber(app.security_deposit),
      frequency,
      start,
    ],
  );
  await recordAudit({ action: 'property.lease.created', entityType: 'property_lease', entityId: id });
  return getLease(id, Number(app.landlord_id), true);
}

export async function getLease(id: number, userId: number, isStaff: boolean) {
  const row = await queryOne<Row>('SELECT * FROM property_leases WHERE id = ?', [id]);
  if (!row) throw notFound('Lease');
  if (!isStaff && Number(row.landlord_id) !== userId && Number(row.tenant_id) !== userId) {
    throw forbidden('This lease does not belong to you');
  }
  const payments = await queryRows<Row>(
    `SELECT id, due_date, amount, currency, status, paid_at, receipt_ref, order_id
       FROM property_lease_payments WHERE lease_id = ? ORDER BY due_date`,
    [id],
  );
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    propertyId: Number(row.property_id),
    listingId: Number(row.listing_id),
    landlordId: Number(row.landlord_id),
    tenantId: Number(row.tenant_id),
    startDate: String(row.start_date).slice(0, 10),
    endDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
    rentAmount: toNumber(row.rent_amount),
    currency: String(row.currency),
    depositAmount: toNumber(row.deposit_amount),
    paymentFrequency: String(row.payment_frequency),
    status: String(row.status),
    nextDueDate: row.next_due_date ? String(row.next_due_date).slice(0, 10) : null,
    payments: payments.map((pay) => ({
      id: Number(pay.id),
      dueDate: String(pay.due_date).slice(0, 10),
      amount: toNumber(pay.amount),
      currency: String(pay.currency),
      status: String(pay.status),
      paidAt: pay.paid_at ? (pay.paid_at as Date).toISOString() : null,
      receiptRef: (pay.receipt_ref as string | null) ?? null,
      orderId: pay.order_id === null ? null : Number(pay.order_id),
    })),
  };
}

export async function changeLeaseStatus(params: {
  leaseId: number;
  userId: number;
  isStaff: boolean;
  status: 'pending_signature' | 'active' | 'expired' | 'terminated' | 'cancelled';
}) {
  const row = await queryOne<Row>('SELECT * FROM property_leases WHERE id = ?', [params.leaseId]);
  if (!row) throw notFound('Lease');
  if (!params.isStaff && Number(row.landlord_id) !== params.userId && Number(row.tenant_id) !== params.userId) {
    throw forbidden('This lease does not belong to you');
  }
  if (!canTransitionLease(String(row.status), params.status)) {
    throw conflict(`Lease cannot move from ${String(row.status)} to ${params.status}`);
  }
  await execute('UPDATE property_leases SET status = ? WHERE id = ?', [params.status, params.leaseId]);
  if (params.status === 'active') {
    await execute(`UPDATE listings SET status = 'rented' WHERE id = ?`, [Number(row.listing_id)]);
    await scheduleNextRent(params.leaseId);
  }
  await recordAudit({
    action: 'property.lease.changed',
    entityType: 'property_lease',
    entityId: params.leaseId,
    after: { status: params.status },
  });
  return getLease(params.leaseId, params.userId, params.isStaff);
}

export async function payLease(params: {
  leaseId: number;
  userId: number;
  countryId: number;
  gatewayCode: string;
  kind: 'rental_deposit' | 'rental_payment';
}) {
  const lease = await queryOne<Row>('SELECT * FROM property_leases WHERE id = ?', [params.leaseId]);
  if (!lease) throw notFound('Lease');
  if (Number(lease.tenant_id) !== params.userId) throw forbidden('Only the tenant can pay this lease');
  const amount =
    params.kind === 'rental_deposit' ? toNumber(lease.deposit_amount) : toNumber(lease.rent_amount);
  if (!amount || amount <= 0) throw badRequest('No amount is due for this payment kind');
  const checkout = await createOrder(params.userId, {
    kind: params.kind,
    amount,
    currency: String(lease.currency),
    countryId: params.countryId,
    gatewayCode: params.gatewayCode,
    description: `Property ${params.kind} for lease ${lease.uuid}`,
    referenceType: 'property_lease',
    referenceId: params.leaseId,
  });
  if (params.kind === 'rental_payment') {
    const dueRaw = lease.next_due_date;
    const dueDate =
      dueRaw instanceof Date
        ? dueRaw.toISOString().slice(0, 10)
        : dueRaw
          ? String(dueRaw).slice(0, 10)
          : new Date().toISOString().slice(0, 10);
    await execute(
      `INSERT INTO property_lease_payments (lease_id, due_date, amount, currency, order_id, status)
       VALUES (?, ?, ?, ?, ?, 'due')`,
      [params.leaseId, dueDate, amount, String(lease.currency), checkout.order.id],
    );
  }
  await snapshotPropertyTransaction({
    orderId: checkout.order.id,
    listingId: Number(lease.listing_id),
    propertyId: Number(lease.property_id),
    transactionType: 'rent',
    price: amount,
    currency: String(lease.currency),
    sellerId: Number(lease.landlord_id),
    buyerId: params.userId,
    leaseId: params.leaseId,
  });
  await notifyUser({
    userId: Number(lease.landlord_id),
    categoryCode: 'property.payment',
    title: 'Rental payment started',
    body: `A ${params.kind.replace('_', ' ')} was initiated.`,
    actionType: 'payment',
    actionTarget: checkout.order.uuid,
  });
  return checkout;
}

export async function createBooking(params: {
  listingId: number;
  guestId: number;
  countryId: number;
  gatewayCode: string;
  checkIn: string;
  checkOut: string;
  guests?: number;
  roomTypeId?: number | null;
}) {
  const listing = await loadPropertyListing(params.listingId);
  if (String(listing.operation) !== 'rent') throw badRequest('Bookings are for rent listings');
  if (Number(listing.user_id) === params.guestId) throw badRequest('You cannot book your own listing');
  if (!(await datesAreAvailable(params.listingId, params.checkIn, params.checkOut))) {
    throw conflict('Those dates are not available');
  }
  const nights = Math.max(
    1,
    Math.round((new Date(params.checkOut).getTime() - new Date(params.checkIn).getTime()) / 86_400_000),
  );
  const unit = toNumber(listing.price) ?? 0;
  const amount = Number(roundDecimal(unit * nights, 2));
  if (amount <= 0) throw badRequest('This listing does not have a bookable price');
  const checkout = await createOrder(params.guestId, {
    kind: 'booking_payment',
    amount,
    currency: String(listing.currency ?? 'USD'),
    countryId: params.countryId,
    gatewayCode: params.gatewayCode,
    description: `Stay at ${String(listing.title)}`,
    referenceType: 'property_booking',
    referenceId: params.listingId,
  });
  const id = await insertAndGetId(
    `INSERT INTO property_bookings
       (uuid, listing_id, property_id, room_type_id, guest_id, host_id, check_in, check_out, guests,
        amount, currency, order_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      uuid(),
      params.listingId,
      listing.property_id ?? null,
      params.roomTypeId ?? null,
      params.guestId,
      Number(listing.user_id),
      params.checkIn,
      params.checkOut,
      params.guests ?? 1,
      amount,
      String(listing.currency ?? 'USD'),
      checkout.order.id,
    ],
  );
  await execute(
    `INSERT INTO property_availability_blocks (listing_id, start_date, end_date, reason)
     VALUES (?, ?, ?, 'booked')`,
    [params.listingId, params.checkIn, params.checkOut],
  );
  await snapshotPropertyTransaction({
    orderId: checkout.order.id,
    listingId: params.listingId,
    propertyId: listing.property_id === null ? null : Number(listing.property_id),
    transactionType: 'booking',
    price: amount,
    currency: String(listing.currency ?? 'USD'),
    sellerId: Number(listing.user_id),
    buyerId: params.guestId,
    bookingId: id,
  });
  await notifyUser({
    userId: Number(listing.user_id),
    categoryCode: 'property.booking',
    title: 'New booking',
    body: `${String(listing.title)} was booked from ${params.checkIn} to ${params.checkOut}.`,
    actionType: 'listing',
    actionTarget: String(params.listingId),
  });
  return { bookingId: id, ...checkout, nights, amount, currency: listing.currency };
}

export async function upsertRoomType(params: {
  listingId: number;
  userId: number;
  code: string;
  name: string;
  occupancy: number;
  bedCount?: number | null;
  privacy?: 'private' | 'shared' | 'mixed';
  quantity: number;
}) {
  const listing = await loadPropertyListing(params.listingId);
  if (Number(listing.user_id) !== params.userId) throw forbidden('Only the host can manage rooms');
  const id = await insertAndGetId(
    `INSERT INTO property_room_types
       (listing_id, property_id, code, name, occupancy, bed_count, privacy, quantity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), occupancy = VALUES(occupancy),
       bed_count = VALUES(bed_count), privacy = VALUES(privacy), quantity = VALUES(quantity)`,
    [
      params.listingId,
      listing.property_id ?? null,
      params.code,
      params.name,
      params.occupancy,
      params.bedCount ?? null,
      params.privacy ?? 'private',
      params.quantity,
    ],
  );
  return { id, listingId: params.listingId, code: params.code };
}

export async function scheduleNextRent(leaseId: number): Promise<void> {
  const lease = await queryOne<Row>('SELECT * FROM property_leases WHERE id = ?', [leaseId]);
  if (!lease || String(lease.status) !== 'active') return;
  const due = lease.next_due_date ? new Date(String(lease.next_due_date)) : new Date();
  const days = String(lease.payment_frequency) === 'weekly' ? 7 : Number(lease.custom_interval_days ?? 30);
  due.setUTCDate(due.getUTCDate() + days);
  const dueStr = due.toISOString().slice(0, 10);
  await execute(
    `INSERT INTO property_lease_payments (lease_id, due_date, amount, currency, status)
     VALUES (?, ?, ?, ?, 'scheduled')`,
    [leaseId, dueStr, lease.rent_amount, lease.currency],
  );
  await execute('UPDATE property_leases SET next_due_date = ? WHERE id = ?', [dueStr, leaseId]);
}

export async function remindDueRent(): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT p.id, p.tenant_id, p.landlord_id, p.rent_amount, p.currency, p.next_due_date, l.title
       FROM property_leases p
       JOIN listings l ON l.id = p.listing_id
      WHERE p.status = 'active' AND p.next_due_date IS NOT NULL
        AND p.next_due_date <= DATE_ADD(CURRENT_DATE, INTERVAL 3 DAY)
        AND p.next_due_date >= CURRENT_DATE`,
  );
  for (const row of rows) {
    await notifyUser({
      userId: Number(row.tenant_id),
      categoryCode: 'property.lease',
      title: 'Rent due',
      body: `Rent of ${row.rent_amount} ${row.currency} is due on ${String(row.next_due_date).slice(0, 10)} for ${String(row.title)}.`,
      actionType: 'payment',
      actionTarget: String(row.id),
    });
  }
  return rows.length;
}

export async function expireLeasesAndBookings(): Promise<{ leases: number; bookings: number }> {
  const leases = await execute(
    `UPDATE property_leases SET status = 'expired'
      WHERE status = 'active' AND end_date IS NOT NULL AND end_date < CURRENT_DATE`,
  );
  const bookings = await execute(
    `UPDATE property_bookings SET status = 'expired'
      WHERE status = 'pending' AND created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 HOUR)`,
  );
  return { leases: leases.affectedRows, bookings: bookings.affectedRows };
}

function mapApplication(row: Row) {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    listingId: Number(row.listing_id),
    applicantId: Number(row.applicant_id),
    landlordId: Number(row.landlord_id),
    message: (row.message as string | null) ?? null,
    occupants: row.occupants === null ? null : Number(row.occupants),
    desiredStart: row.desired_start ? String(row.desired_start).slice(0, 10) : null,
    desiredEnd: row.desired_end ? String(row.desired_end).slice(0, 10) : null,
    status: String(row.status),
    identityVerified: Number(row.identity_verified) === 1,
    createdAt: (row.created_at as Date).toISOString(),
  };
}
