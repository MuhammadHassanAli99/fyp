import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { recordAudit } from '../../middleware/audit';
import { notifyUser } from '../../modules/notifications/notify';
import { isPrivateStoragePath } from '../../providers/storage';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const BLOCKED_EXT = /\.(exe|bat|cmd|sh|js|msi|dll|com|scr|ps1)$/i;

export function assertSafePropertyDocumentFile(storagePath: string, mimeType?: string | null): void {
  if (!isPrivateStoragePath(storagePath) && !storagePath.startsWith('document/')) {
    throw badRequest('Property documents must be stored on a private path');
  }
  if (BLOCKED_EXT.test(storagePath)) throw badRequest('This file type is not allowed');
  if (mimeType && !ALLOWED_MIME.has(mimeType)) {
    throw badRequest('Only PDF and common image types are accepted');
  }
}

export async function uploadPropertyDocument(params: {
  propertyId: number;
  userId: number;
  isStaff: boolean;
  docType: 'ownership' | 'title_registry' | 'map' | 'approval' | 'noc' | 'tax' | 'building_approval' | 'completion_certificate' | 'other';
  title?: string | null;
  storagePath: string;
  listingDocumentId?: number | null;
  mimeType?: string | null;
}) {
  const property = await queryOne<Row>('SELECT id, owner_user_id FROM properties WHERE id = ? AND deleted_at IS NULL', [
    params.propertyId,
  ]);
  if (!property) throw notFound('Property');
  if (Number(property.owner_user_id) !== params.userId && !params.isStaff) {
    throw forbidden('You cannot upload documents for this property');
  }
  assertSafePropertyDocumentFile(params.storagePath, params.mimeType);

  const id = await insertAndGetId(
    `INSERT INTO property_documents
       (uuid, property_id, listing_document_id, doc_type, title, storage_path, uploaded_by,
        verification_status, processing_status, scan_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'validating', 'pending')`,
    [
      uuid(),
      params.propertyId,
      params.listingDocumentId ?? null,
      params.docType,
      params.title ?? null,
      params.storagePath,
      params.userId,
    ],
  );

  if (params.listingDocumentId) {
    await execute(`UPDATE listing_documents SET is_public = 0, verification_status = 'pending' WHERE id = ?`, [
      params.listingDocumentId,
    ]);
  }

  await processPropertyDocument(id);

  await recordAudit({
    action: 'property.document.uploaded',
    entityType: 'property_document',
    entityId: id,
    after: { propertyId: params.propertyId, docType: params.docType },
  });

  return getPropertyDocument(id, params.userId, params.isStaff);
}

export async function processPropertyDocument(id: number): Promise<void> {
  const row = await queryOne<Row>('SELECT * FROM property_documents WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!row) return;

  if (BLOCKED_EXT.test(String(row.storage_path))) {
    await execute(
      `UPDATE property_documents
          SET scan_status = 'blocked', processing_status = 'failed', verification_status = 'rejected',
              rejection_reason = 'Blocked file type'
        WHERE id = ?`,
      [id],
    );
    return;
  }

  const classified = String(row.doc_type);
  const ocrHint = `Heuristic classification: ${classified}. OCR success is not legal ownership verification.`;
  await execute(
    `UPDATE property_documents
        SET scan_status = 'skipped_no_scanner',
            processing_status = 'review',
            verification_status = 'needs_review',
            ocr_text = ?,
            extracted_data = ?
      WHERE id = ?`,
    [ocrHint, JSON.stringify({ classifiedAs: classified, legalOwnershipVerified: false }), id],
  );
}

export async function getPropertyDocument(id: number, userId: number, isStaff: boolean) {
  const row = await queryOne<Row>(
    `SELECT d.*, p.owner_user_id
       FROM property_documents d
       JOIN properties p ON p.id = d.property_id
      WHERE d.id = ? AND d.deleted_at IS NULL`,
    [id],
  );
  if (!row) throw notFound('Document');
  const owner = Number(row.owner_user_id) === userId || isStaff;
  if (!owner) throw forbidden('Property documents are not public');
  return mapDocument(row, true);
}

export async function listPropertyDocuments(propertyId: number, userId: number | null, isStaff: boolean) {
  const property = await queryOne<Row>('SELECT owner_user_id FROM properties WHERE id = ? AND deleted_at IS NULL', [
    propertyId,
  ]);
  if (!property) throw notFound('Property');
  const owner = isStaff || (userId !== null && Number(property.owner_user_id) === userId);
  const rows = await queryRows<Row>(
    `SELECT * FROM property_documents WHERE property_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    [propertyId],
  );
  return rows.map((row) => mapDocument(row, owner));
}

export async function verifyPropertyDocument(params: {
  documentId: number;
  actorId: number;
  isStaff: boolean;
  decision: 'verified' | 'rejected';
  reason?: string | null;
}) {
  if (!params.isStaff) throw forbidden('Only staff can verify property documents');
  const row = await queryOne<Row>('SELECT * FROM property_documents WHERE id = ? AND deleted_at IS NULL', [
    params.documentId,
  ]);
  if (!row) throw notFound('Document');
  await execute(
    `UPDATE property_documents
        SET verification_status = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP,
            rejection_reason = ?, processing_status = 'complete'
      WHERE id = ?`,
    [params.decision, params.actorId, params.reason ?? null, params.documentId],
  );
  if (row.listing_document_id) {
    await execute(
      `UPDATE listing_documents
          SET verified_by = ?, verified_at = IF(? = 'verified', CURRENT_TIMESTAMP, NULL),
              verification_status = ?, rejection_reason = ?, is_public = 0
        WHERE id = ?`,
      [params.actorId, params.decision, params.decision, params.reason ?? null, Number(row.listing_document_id)],
    );
  }
  const property = await queryOne<Row>('SELECT owner_user_id FROM properties WHERE id = ?', [Number(row.property_id)]);
  if (property) {
    await notifyUser({
      userId: Number(property.owner_user_id),
      categoryCode: 'property.document',
      title: params.decision === 'verified' ? 'Document verified' : 'Document rejected',
      body:
        params.decision === 'verified'
          ? 'A property document passed review. This is not a legal title certificate by itself.'
          : (params.reason ?? 'A property document was rejected.'),
      actionType: 'verification',
      actionTarget: String(row.property_id),
    });
  }
  await recordAudit({
    action: 'property.document.verified',
    entityType: 'property_document',
    entityId: params.documentId,
    after: { decision: params.decision },
  });
  return getPropertyDocument(params.documentId, params.actorId, true);
}

export async function protectPropertyDocuments(): Promise<number> {
  const result = await execute(
    `UPDATE listing_documents d
       JOIN listings l ON l.id = d.listing_id
      SET d.is_public = 0
      WHERE l.marketplace_id = 2
        AND d.doc_type IN ('ownership','title_deed','title_registry','map','approval','noc','tax_receipt',
                           'building_approval','completion_certificate')
        AND d.is_public = 1`,
  );
  return result.affectedRows;
}

function mapDocument(row: Row, includePath: boolean) {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    propertyId: Number(row.property_id),
    docType: String(row.doc_type),
    title: (row.title as string | null) ?? null,
    verificationStatus: String(row.verification_status),
    processingStatus: String(row.processing_status),
    scanStatus: String(row.scan_status),
    hasFile: true,
    storagePath: includePath ? String(row.storage_path) : null,
    ocrComplete: Boolean(row.ocr_text),
    legalOwnershipVerified: false,
    disclaimer: 'OCR or classification success does not mean legal ownership has been verified.',
    createdAt: (row.created_at as Date).toISOString(),
  };
}
