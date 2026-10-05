import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { toNumber } from '../../db/sql';
import { recordAudit } from '../../middleware/audit';
import { notifyUser } from '../../modules/notifications/notify';

export async function createVerificationRequest(params: {
  listingId: number;
  userId: number;
  method: 'laboratory' | 'authorized_dealer' | 'physical_inspection' | 'xrf' | 'hallmark' | 'certificate';
  providerName?: string | null;
  orderId?: number | null;
  notes?: string | null;
}) {
  const listing = await queryOne<Row>('SELECT id, user_id, marketplace_id FROM listings WHERE id = ? AND deleted_at IS NULL', [
    params.listingId,
  ]);
  if (!listing) throw notFound('Listing');
  if (Number(listing.marketplace_id) !== 1) throw badRequest('Physical verification is a Gold marketplace flow');

  const id = await insertAndGetId(
    `INSERT INTO gold_verification_requests
       (uuid, listing_id, order_id, requested_by, method, provider_name, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, 'requested', ?)`,
    [
      uuid(),
      params.listingId,
      params.orderId ?? null,
      params.userId,
      params.method,
      params.providerName ?? null,
      params.notes ?? null,
    ],
  );

  await recordAudit({
    action: 'gold.verification.requested',
    entityType: 'gold_verification_request',
    entityId: id,
    after: { listingId: params.listingId, method: params.method },
  });

  await notifyUser({
    userId: Number(listing.user_id),
    categoryCode: 'gold.verification',
    title: 'Verification requested',
    body: `A ${params.method.replace(/_/g, ' ')} check was requested for your gold listing.`,
    actionType: 'verification',
    actionTarget: String(params.listingId),
    data: { listingId: params.listingId, requestId: id },
  });

  return getVerificationRequest(id);
}

export async function getVerificationRequest(id: number) {
  const row = await queryOne<Row>(
    `SELECT r.*, res.outcome, res.measured_karat, res.measured_fineness, res.measured_weight_g,
            res.method_detail, res.performed_by, res.performed_at AS result_at, res.notes AS result_notes
       FROM gold_verification_requests r
       LEFT JOIN gold_verification_results res ON res.request_id = r.id
      WHERE r.id = ?
      ORDER BY res.id DESC
      LIMIT 1`,
    [id],
  );
  if (!row) throw notFound('Verification request');
  return mapRequest(row);
}

export async function recordVerificationResult(params: {
  requestId: number;
  actorId: number;
  isStaff: boolean;
  outcome: 'pass' | 'fail' | 'inconclusive';
  measuredKarat?: number | null;
  measuredFineness?: number | null;
  measuredWeightG?: number | null;
  methodDetail?: string | null;
  performedBy?: string | null;
  notes?: string | null;
  reportDocumentId?: number | null;
}) {
  if (!params.isStaff) throw forbidden('Only staff can record physical verification results');
  const request = await queryOne<Row>('SELECT * FROM gold_verification_requests WHERE id = ?', [params.requestId]);
  if (!request) throw notFound('Verification request');

  await insertAndGetId(
    `INSERT INTO gold_verification_results
       (request_id, measured_karat, measured_fineness, measured_weight_g, method_detail, outcome,
        report_document_id, performed_by, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.requestId,
      params.measuredKarat ?? null,
      params.measuredFineness ?? null,
      params.measuredWeightG ?? null,
      params.methodDetail ?? null,
      params.outcome,
      params.reportDocumentId ?? null,
      params.performedBy ?? null,
      params.notes ?? null,
    ],
  );

  await execute(
    `UPDATE gold_verification_requests
        SET status = 'completed', completed_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [params.requestId],
  );

  if (params.outcome === 'pass') {
    await execute(`UPDATE listings SET is_verified = 1 WHERE id = ?`, [request.listing_id]);
  }

  await recordAudit({
    action: 'gold.verification.completed',
    entityType: 'gold_verification_request',
    entityId: params.requestId,
    actorId: params.actorId,
    after: { outcome: params.outcome },
  });

  const listing = await queryOne<Row>('SELECT user_id FROM listings WHERE id = ?', [request.listing_id]);
  if (listing) {
    await notifyUser({
      userId: Number(listing.user_id),
      categoryCode: 'gold.verification',
      title: 'Physical verification result',
      body: `Outcome: ${params.outcome}. Physical verification is authoritative for high-value authenticity decisions.`,
      actionType: 'verification',
      actionTarget: String(request.listing_id),
      data: { listingId: Number(request.listing_id), outcome: params.outcome },
    });
  }

  return getVerificationRequest(params.requestId);
}

function mapRequest(row: Row) {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    listingId: Number(row.listing_id),
    orderId: row.order_id === null ? null : Number(row.order_id),
    method: String(row.method),
    providerName: (row.provider_name as string | null) ?? null,
    status: String(row.status),
    scheduledAt: row.scheduled_at ? (row.scheduled_at as Date).toISOString() : null,
    completedAt: row.completed_at ? (row.completed_at as Date).toISOString() : null,
    notes: (row.notes as string | null) ?? null,
    result: row.outcome
      ? {
          outcome: String(row.outcome),
          measuredKarat: toNumber(row.measured_karat),
          measuredFineness: row.measured_fineness === null ? null : Number(row.measured_fineness),
          measuredWeightG: toNumber(row.measured_weight_g),
          methodDetail: (row.method_detail as string | null) ?? null,
          performedBy: (row.performed_by as string | null) ?? null,
          performedAt: row.result_at ? (row.result_at as Date).toISOString() : null,
          notes: (row.result_notes as string | null) ?? null,
        }
      : null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function listVerificationRequests(listingId: number) {
  const rows = await queryRows<Row>(
    `SELECT * FROM gold_verification_requests WHERE listing_id = ? ORDER BY created_at DESC`,
    [listingId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    uuid: String(row.uuid),
    method: String(row.method),
    status: String(row.status),
    createdAt: (row.created_at as Date).toISOString(),
  }));
}
