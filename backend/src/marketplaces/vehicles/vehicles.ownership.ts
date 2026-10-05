import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { forbidden, notFound } from '../../core/errors';
import { recordAudit } from '../../middleware/audit';
import { notifyUser } from '../../modules/notifications/notify';
import { assertVehicleOwner } from './vehicles.assets';

export async function submitOwnership(params: {
  vehicleId: number;
  userId: number;
  isStaff: boolean;
  ownershipType?: string;
}) {
  await assertVehicleOwner(params.vehicleId, params.userId, params.isStaff);
  const id = await insertAndGetId(
    `INSERT INTO vehicle_ownership
       (vehicle_id, owner_user_id, ownership_type, status, submitted_at)
     VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
    [params.vehicleId, params.userId, params.ownershipType ?? 'registered_owner'],
  );
  await recordAudit({
    action: 'vehicle.ownership.submitted',
    entityType: 'vehicle_ownership',
    entityId: id,
    after: { vehicleId: params.vehicleId, status: 'pending' },
  });
  return getOwnership(params.vehicleId);
}

export async function getOwnership(vehicleId: number) {
  const rows = await queryRows<Row>(
    `SELECT * FROM vehicle_ownership WHERE vehicle_id = ? ORDER BY created_at DESC`,
    [vehicleId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    vehicleId: Number(row.vehicle_id),
    ownerUserId: Number(row.owner_user_id),
    ownershipType: String(row.ownership_type),
    status: String(row.status),
    submittedAt: row.submitted_at ? (row.submitted_at as Date).toISOString() : null,
    verifiedAt: row.verified_at ? (row.verified_at as Date).toISOString() : null,
    rejectionReason: (row.rejection_reason as string | null) ?? null,
  }));
}

export async function reviewOwnership(params: {
  ownershipId: number;
  actorId: number;
  isStaff: boolean;
  status: 'partially_verified' | 'verified' | 'rejected' | 'expired';
  reason?: string | null;
}) {
  if (!params.isStaff) throw forbidden('Only staff can verify vehicle ownership');
  const row = await queryOne<Row>('SELECT * FROM vehicle_ownership WHERE id = ?', [params.ownershipId]);
  if (!row) throw notFound('Ownership record');
  await execute(
    `UPDATE vehicle_ownership
        SET status = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP, rejection_reason = ?
      WHERE id = ?`,
    [params.status, params.actorId, params.reason ?? null, params.ownershipId],
  );
  await recordAudit({
    action: 'vehicle.ownership.reviewed',
    entityType: 'vehicle_ownership',
    entityId: params.ownershipId,
    after: { status: params.status },
  });
  const ownerId = Number(row.owner_user_id);
  await notifyUser({
    userId: ownerId,
    categoryCode: 'vehicle.verification',
    title: 'Ownership review update',
    body: `Vehicle ownership is now ${params.status}. This is not a government title transfer.`,
    actionType: 'verification',
    actionTarget: String(row.vehicle_id),
  });
  return getOwnership(Number(row.vehicle_id));
}

export async function reviewVin(params: {
  vehicleId: number;
  actorId: number;
  isStaff: boolean;
  status: 'partially_verified' | 'verified' | 'rejected' | 'expired';
}) {
  if (!params.isStaff) throw forbidden('Only staff can verify a VIN');
  const row = await queryOne<Row>('SELECT id FROM vehicle_vin_records WHERE vehicle_id = ?', [params.vehicleId]);
  if (!row) throw notFound('VIN record');
  await execute(
    `UPDATE vehicle_vin_records
        SET verification_status = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP
      WHERE vehicle_id = ?`,
    [params.status, params.actorId, params.vehicleId],
  );
  await recordAudit({
    action: 'vehicle.vin.reviewed',
    entityType: 'vehicle_vin',
    entityId: params.vehicleId,
    after: { status: params.status },
  });
  return queryOne<Row>('SELECT * FROM vehicle_vin_records WHERE vehicle_id = ?', [params.vehicleId]);
}

export async function listVerificationBadges(vehicleId: number) {
  const [ownership, vin, registration] = await Promise.all([
    queryOne<Row>(
      `SELECT status FROM vehicle_ownership WHERE vehicle_id = ? ORDER BY created_at DESC LIMIT 1`,
      [vehicleId],
    ),
    queryOne<Row>(`SELECT verification_status FROM vehicle_vin_records WHERE vehicle_id = ?`, [vehicleId]),
    queryOne<Row>(
      `SELECT verification_status FROM vehicle_registrations WHERE vehicle_id = ? ORDER BY created_at DESC LIMIT 1`,
      [vehicleId],
    ),
  ]);
  const badges = [];
  if (ownership && String(ownership.status) === 'verified') {
    badges.push({ code: 'ownership', label: 'Ownership reviewed', status: 'verified' });
  }
  if (vin && String(vin.verification_status) === 'verified') {
    badges.push({ code: 'vin', label: 'VIN reviewed', status: 'verified' });
  }
  if (registration && String(registration.verification_status) === 'verified') {
    badges.push({ code: 'registration', label: 'Registration reviewed', status: 'verified' });
  }
  return {
    vehicleId,
    badges,
    disclaimer: 'Badges are platform reviews. They are not government title, customs or theft clearance.',
  };
}
