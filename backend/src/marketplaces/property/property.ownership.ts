import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { recordAudit } from '../../middleware/audit';
import { notifyUser } from '../../modules/notifications/notify';

const OWNERSHIP_STATUSES = [
  'unverified',
  'pending',
  'partially_verified',
  'verified',
  'rejected',
  'expired',
] as const;

export async function submitOwnership(params: {
  propertyId: number;
  userId: number;
  ownershipType: 'freehold' | 'leasehold' | 'power_of_attorney' | 'allotment' | 'shared' | 'other';
  sharePercent?: number | null;
}) {
  const property = await queryOne<Row>('SELECT id, owner_user_id FROM properties WHERE id = ? AND deleted_at IS NULL', [
    params.propertyId,
  ]);
  if (!property) throw notFound('Property');
  if (Number(property.owner_user_id) !== params.userId) {
    throw forbidden('Only the property owner can submit ownership records');
  }

  const id = await insertAndGetId(
    `INSERT INTO property_ownership
       (property_id, owner_user_id, ownership_type, share_percent, status, submitted_at)
     VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
    [params.propertyId, params.userId, params.ownershipType, params.sharePercent ?? null],
  );

  await execute(
    `INSERT INTO property_verifications (property_id, dimension, status)
     VALUES (?, 'ownership', 'pending')
     ON DUPLICATE KEY UPDATE status = 'pending'`,
    [params.propertyId],
  );

  await recordAudit({
    action: 'property.ownership.submitted',
    entityType: 'property_ownership',
    entityId: id,
    after: { propertyId: params.propertyId, status: 'pending' },
  });

  return getOwnership(params.propertyId);
}

export async function getOwnership(propertyId: number) {
  const rows = await queryRows<Row>(
    `SELECT * FROM property_ownership WHERE property_id = ? ORDER BY created_at DESC`,
    [propertyId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    propertyId: Number(row.property_id),
    ownerUserId: Number(row.owner_user_id),
    ownershipType: String(row.ownership_type),
    sharePercent: row.share_percent === null ? null : Number(row.share_percent),
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
  if (!params.isStaff) throw forbidden('Only staff can change ownership verification');
  if (!(OWNERSHIP_STATUSES as readonly string[]).includes(params.status)) {
    throw badRequest('Invalid ownership status');
  }
  const row = await queryOne<Row>('SELECT * FROM property_ownership WHERE id = ?', [params.ownershipId]);
  if (!row) throw notFound('Ownership record');

  await execute(
    `UPDATE property_ownership
        SET status = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP, rejection_reason = ?
      WHERE id = ?`,
    [params.status, params.actorId, params.reason ?? null, params.ownershipId],
  );

  const dimensionStatus = params.status === 'verified' || params.status === 'partially_verified' ? 'verified' : params.status;
  await execute(
    `INSERT INTO property_verifications (property_id, dimension, status, verified_by, verified_at, rejection_reason)
     VALUES (?, 'ownership', ?, ?, CURRENT_TIMESTAMP, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), verified_by = VALUES(verified_by),
       verified_at = VALUES(verified_at), rejection_reason = VALUES(rejection_reason)`,
    [Number(row.property_id), dimensionStatus === 'expired' ? 'expired' : dimensionStatus, params.actorId, params.reason ?? null],
  );

  await recordAudit({
    action: 'property.ownership.status_changed',
    entityType: 'property_ownership',
    entityId: params.ownershipId,
    after: { status: params.status },
  });

  await notifyUser({
    userId: Number(row.owner_user_id),
    categoryCode: 'property.verification',
    title: 'Ownership review update',
    body: `Ownership status is now ${params.status.replace(/_/g, ' ')}.`,
    actionType: 'verification',
    actionTarget: String(row.property_id),
  });

  return getOwnership(Number(row.property_id));
}

export async function setVerificationDimension(params: {
  propertyId: number;
  listingId?: number | null;
  actorId: number;
  isStaff: boolean;
  dimension: 'seller_identity' | 'business_identity' | 'ownership' | 'documents' | 'location' | 'listing_information' | 'property_inspection';
  status: 'pending' | 'verified' | 'rejected' | 'expired';
  reason?: string | null;
}) {
  if (!params.isStaff) throw forbidden('Verification badges can only be set after backend review');
  await execute(
    `INSERT INTO property_verifications
       (property_id, listing_id, dimension, status, verified_by, verified_at, rejection_reason)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), verified_by = VALUES(verified_by),
       verified_at = VALUES(verified_at), rejection_reason = VALUES(rejection_reason)`,
    [
      params.propertyId,
      params.listingId ?? null,
      params.dimension,
      params.status,
      params.actorId,
      params.reason ?? null,
    ],
  );
  await recordAudit({
    action: 'property.verification.changed',
    entityType: 'property_verification',
    entityId: params.propertyId,
    after: { dimension: params.dimension, status: params.status },
  });
  return listVerificationBadges(params.propertyId, params.listingId ?? null);
}

export async function listVerificationBadges(propertyId: number, listingId?: number | null) {
  const rows = await queryRows<Row>(
    `SELECT dimension, status, verified_at
       FROM property_verifications
      WHERE property_id = ? AND (listing_id IS NULL OR listing_id = ?)`,
    [propertyId, listingId ?? null],
  );
  const badges: Record<string, { status: string; verifiedAt: string | null; label: string }> = {};
  for (const row of rows) {
    if (String(row.status) !== 'verified') continue;
    const dimension = String(row.dimension);
    badges[dimension] = {
      status: 'verified',
      verifiedAt: row.verified_at ? (row.verified_at as Date).toISOString() : null,
      label: badgeLabel(dimension),
    };
  }
  return badges;
}

function badgeLabel(dimension: string): string {
  switch (dimension) {
    case 'seller_identity':
      return 'Verified Seller';
    case 'documents':
      return 'Documents Reviewed';
    case 'location':
      return 'Location Verified';
    case 'ownership':
      return 'Ownership Verified';
    case 'business_identity':
      return 'Verified Agency';
    case 'property_inspection':
      return 'Inspected';
    default:
      return 'Reviewed';
  }
}
