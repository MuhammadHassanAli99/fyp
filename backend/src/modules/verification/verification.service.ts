import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { AppError, ErrorCode, badRequest, forbidden, notFound } from '../../core/errors';
import { encryptBytes, hmacSha256, randomHex, safeEqual, uuid } from '../../core/security/crypto';
import { isPrivateStoragePath, storage } from '../../providers/storage';
import { recordAudit } from '../../middleware/audit';
import { AuthEvent, recordAuthEvent } from '../auth/auth.security';
import { recordTrustEvent } from '../trust/trust.service';
import { assertBusinessPermission } from '../business/business.service';
import { looksMalicious } from '../users/image-inspect';
import { toPublicStatus, type AttachDocumentInput, type ReviewVerificationInput, type StartVerificationInput } from './verification.schema';
import { syncSubscriptionBadges } from '../subscriptions/subscriptions.badges';
import { syncKycFromVerification } from '../risk/risk.kyc';

const ENCRYPTION_KID = 'v1';

export async function startVerification(userId: number, input: StartVerificationInput) {
  if (input.businessId) {
    await assertBusinessPermission(input.businessId, userId, 'business.update');
    if (input.docType !== 'business_license' && input.docType !== 'tax_certificate') {
      throw badRequest('Business verification requires a business licence document type');
    }
  }

  const open = await queryOne<Row>(
    `SELECT id FROM verification_requests
      WHERE user_id = ? AND doc_type = ? AND status IN ('pending','in_review','action_required')
        AND ${input.businessId ? 'business_id = ?' : 'business_id IS NULL'}
      LIMIT 1`,
    input.businessId ? [userId, input.docType, input.businessId] : [userId, input.docType],
  );
  if (open) {
    return getVerification(Number(open.id), userId, false);
  }

  const id = await insertAndGetId(
    `INSERT INTO verification_requests
       (uuid, user_id, business_id, doc_type, doc_number, issuing_country_id, issued_on, expires_on, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      uuid(),
      userId,
      input.businessId ?? null,
      input.docType,
      input.docNumber ?? null,
      input.issuingCountryId ?? null,
      input.issuedOn ?? null,
      input.expiresOn ?? null,
    ],
  );

  void recordAudit({
    action: 'verification.started',
    entityType: 'verification_request',
    entityId: id,
    after: { docType: input.docType },
  });
  return getVerification(id, userId, false);
}

export async function attachDocument(userId: number, requestUuid: string, input: AttachDocumentInput) {
  const request = await loadOwnedRequest(requestUuid, userId);
  if (!['pending', 'action_required'].includes(String(request.status))) {
    throw badRequest('Documents can only be added while the request is pending');
  }

  const storagePath = input.storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!storagePath.startsWith(`verification/${userId}/`) || storagePath.includes('..')) {
    throw badRequest('Upload does not belong to this account');
  }
  if (!isPrivateStoragePath(storagePath)) {
    throw badRequest('Verification documents must be stored in the private verification prefix');
  }
  if (!(await storage.exists(storagePath))) throw badRequest('Upload not found');

  const raw = await storage.read(storagePath);
  if (looksMalicious(raw)) throw badRequest('This file is not a permitted document');
  if (raw.byteLength > 15 * 1024 * 1024) throw badRequest('Document is too large');

  const encrypted = encryptBytes(raw);
  const encryptedPath = storagePath.replace(/(\.[a-z0-9]+)?$/i, '.enc');
  await storage.put(encryptedPath, encrypted, 'application/octet-stream');
  await storage.delete(storagePath).catch(() => undefined);

  const docId = await insertAndGetId(
    `INSERT INTO verification_documents
       (request_id, side, file_url, storage_path, file_hash, encryption_kid, is_sensitive, mime_type, size_bytes)
     VALUES (?, ?, 'private', ?, ?, ?, 1, ?, ?)`,
    [
      request.id,
      input.side,
      encryptedPath,
      hmacSha256(encryptedPath),
      ENCRYPTION_KID,
      input.mimeType ?? 'application/octet-stream',
      raw.byteLength,
    ],
  );

  void recordAudit({
    action: 'verification.document_uploaded',
    entityType: 'verification_request',
    entityId: Number(request.id),
    after: { documentId: docId, side: input.side, mimeType: input.mimeType ?? null },
  });

  return getVerification(Number(request.id), userId, false);
}

export async function submitVerification(userId: number, requestUuid: string) {
  const request = await loadOwnedRequest(requestUuid, userId);
  const docs = await queryRows<Row>(`SELECT id FROM verification_documents WHERE request_id = ?`, [request.id]);
  if (docs.length === 0) throw badRequest('Upload at least one document before submitting');

  await execute(`UPDATE verification_requests SET status = 'in_review' WHERE id = ?`, [request.id]);
  void recordAudit({ action: 'verification.submitted', entityType: 'verification_request', entityId: Number(request.id) });
  void recordAuthEvent({ type: AuthEvent.VERIFICATION_SUBMITTED, userId, metadata: { requestId: Number(request.id) } });
  return getVerification(Number(request.id), userId, false);
}

export async function getMyVerification(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT id, uuid, doc_type, status, business_id, reviewed_at, rejection_reason, created_at
       FROM verification_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`,
    [userId],
  );
  const latest = rows[0];
  return {
    overallStatus: toPublicStatus(latest ? String(latest.status) : null),
    identityVerified: rows.some((row) => ['government_id', 'passport', 'driving_license'].includes(String(row.doc_type)) && row.status === 'approved'),
    businessVerified: rows.some((row) => row.doc_type === 'business_license' && row.status === 'approved'),
    requests: rows.map(mapRequest),
  };
}

export async function getVerificationByUuid(requestUuid: string, userId: number, isStaff: boolean) {
  const row = await queryOne<Row>(`SELECT id FROM verification_requests WHERE uuid = ?`, [requestUuid]);
  if (!row) throw notFound('Verification request');
  return getVerification(Number(row.id), userId, isStaff);
}

export async function getVerification(id: number, userId: number, isStaff: boolean) {
  const row = await queryOne<Row>(`SELECT * FROM verification_requests WHERE id = ?`, [id]);
  if (!row) throw notFound('Verification request');
  if (!isStaff && Number(row.user_id) !== userId) throw forbidden('You cannot view this verification request');

  const docs = await queryRows<Row>(
    `SELECT id, side, mime_type, size_bytes, uploaded_at FROM verification_documents WHERE request_id = ?`,
    [id],
  );

  return {
    ...mapRequest(row),
    documents: docs.map((doc) => ({
      id: Number(doc.id),
      side: String(doc.side),
      mimeType: (doc.mime_type as string | null) ?? null,
      sizeBytes: doc.size_bytes === null ? null : Number(doc.size_bytes),
      uploadedAt: (doc.uploaded_at as Date).toISOString(),
    })),
  };
}

export async function reviewVerification(staffId: number, requestUuid: string, input: ReviewVerificationInput) {
  const row = await queryOne<Row>(`SELECT * FROM verification_requests WHERE uuid = ?`, [requestUuid]);
  if (!row) throw notFound('Verification request');
  if (input.decision === 'rejected' && !input.reason) throw badRequest('A reason is required when rejecting');

  await execute(
    `UPDATE verification_requests
        SET status = ?, reviewer_id = ?, reviewed_at = CURRENT_TIMESTAMP, rejection_reason = ?
      WHERE id = ?`,
    [input.decision, staffId, input.reason ?? null, row.id],
  );

  if (input.decision === 'approved') {
    if (row.business_id) {
      await execute(`UPDATE business_profiles SET verified_at = CURRENT_TIMESTAMP, verified_by = ?, status = 'active' WHERE id = ?`, [
        staffId,
        row.business_id,
      ]);
      await execute(
        `INSERT INTO user_badges (user_id, badge_id)
         SELECT ?, id FROM badges WHERE code = 'business_verified'
         ON DUPLICATE KEY UPDATE awarded_at = CURRENT_TIMESTAMP`,
        [row.user_id],
      );
      await recordTrustEvent({
        userId: Number(row.user_id),
        type: 'business_verified',
        source: 'verification',
        delta: 18,
        explanation: 'Business verification approved',
        referenceType: 'verification_request',
        referenceId: Number(row.id),
      });
    } else {
      await execute(
        `INSERT INTO user_badges (user_id, badge_id)
         SELECT ?, id FROM badges WHERE code IN ('verified','id_verified')
         ON DUPLICATE KEY UPDATE awarded_at = CURRENT_TIMESTAMP`,
        [row.user_id],
      );
      await recordTrustEvent({
        userId: Number(row.user_id),
        type: 'identity_verified',
        source: 'verification',
        delta: 15,
        explanation: 'Identity verification approved',
        referenceType: 'verification_request',
        referenceId: Number(row.id),
      });
    }
    await syncSubscriptionBadges(Number(row.user_id));
  }

  if (input.decision === 'revoked') {
    await recordTrustEvent({
      userId: Number(row.user_id),
      type: 'verification_revoked',
      source: 'verification',
      delta: -10,
      explanation: 'Verification revoked',
      referenceType: 'verification_request',
      referenceId: Number(row.id),
    });
  }

  void recordAudit({
    action: `verification.${input.decision}`,
    entityType: 'verification_request',
    entityId: Number(row.id),
    actorType: 'admin',
    actorId: staffId,
    after: { decision: input.decision, reason: input.reason ?? null },
  });

  await syncKycFromVerification({
    userId: Number(row.user_id),
    decision: input.decision,
    docType: String(row.doc_type),
  }).catch(() => undefined);

  return getVerification(Number(row.id), Number(row.user_id), true);
}

/**
 * Staff-only document access. Returns a short-lived HMAC token, never a public URL.
 * The token is exchanged at GET /verification/documents/:id/content.
 */
export async function issueDocumentAccess(staffId: number, documentId: number) {
  const doc = await queryOne<Row>(
    `SELECT d.id, d.storage_path, d.mime_type, r.user_id
       FROM verification_documents d
       JOIN verification_requests r ON r.id = d.request_id
      WHERE d.id = ?`,
    [documentId],
  );
  if (!doc) throw notFound('Document');
  if (!doc.storage_path) throw new AppError('Document is not available', { status: 410, code: ErrorCode.NOT_FOUND });

  const expiresAt = Date.now() + 5 * 60 * 1000;
  const nonce = randomHex(8);
  const payload = `${documentId}.${staffId}.${expiresAt}.${nonce}`;
  const token = `${payload}.${hmacSha256(payload)}`;

  void recordAudit({
    action: 'verification.document_accessed',
    entityType: 'verification_document',
    entityId: documentId,
    actorType: 'admin',
    actorId: staffId,
  });

  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export function parseDocumentAccessToken(token: string): { documentId: number; staffId: number } {
  const parts = token.split('.');
  if (parts.length !== 5) throw forbidden('Invalid document token');
  const [documentId, staffId, expiresAt, nonce, signature] = parts;
  if (!documentId || !staffId || !expiresAt || !nonce || !signature) throw forbidden('Invalid document token');
  const payload = `${documentId}.${staffId}.${expiresAt}.${nonce}`;
  if (!safeEqual(hmacSha256(payload), signature)) throw forbidden('Invalid document token');
  if (Number(expiresAt) < Date.now()) throw forbidden('Document access has expired');
  return { documentId: Number(documentId), staffId: Number(staffId) };
}

export async function readProtectedDocument(documentId: number) {
  const doc = await queryOne<Row>(
    `SELECT storage_path, mime_type, encryption_kid FROM verification_documents WHERE id = ?`,
    [documentId],
  );
  if (!doc?.storage_path) throw notFound('Document');
  const encrypted = await storage.read(String(doc.storage_path));
  const { decryptBytes } = await import('../../core/security/crypto');
  const bytes = doc.encryption_kid ? decryptBytes(encrypted) : encrypted;
  return { bytes, mimeType: String(doc.mime_type ?? 'application/octet-stream') };
}

async function loadOwnedRequest(requestUuid: string, userId: number) {
  const row = await queryOne<Row>(`SELECT * FROM verification_requests WHERE uuid = ?`, [requestUuid]);
  if (!row) throw notFound('Verification request');
  if (Number(row.user_id) !== userId) throw forbidden('You cannot modify this verification request');
  return row;
}

const mapRequest = (row: Row) => ({
  id: Number(row.id),
  uuid: String(row.uuid),
  docType: String(row.doc_type),
  status: toPublicStatus(String(row.status)),
  businessId: row.business_id === null ? null : Number(row.business_id),
  reviewedAt: row.reviewed_at ? (row.reviewed_at as Date).toISOString() : null,
  rejectionReason: (row.rejection_reason as string | null) ?? null,
  createdAt: (row.created_at as Date).toISOString(),
});
