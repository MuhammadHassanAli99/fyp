import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { recordAudit } from '../../middleware/audit';
import { notifyUser } from '../../modules/notifications/notify';
import { isPrivateStoragePath } from '../../providers/storage';
import { assertVehicleOwner } from './vehicles.assets';

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const BLOCKED_EXT = /\.(exe|bat|cmd|sh|js|msi|dll|com|scr|ps1)$/i;

export function assertSafeVehicleDocumentFile(storagePath: string, mimeType?: string | null): void {
  if (!isPrivateStoragePath(storagePath) && !storagePath.startsWith('document/')) {
    throw badRequest('Vehicle documents must be stored on a private path');
  }
  if (BLOCKED_EXT.test(storagePath)) throw badRequest('This file type is not allowed');
  if (mimeType && !ALLOWED_MIME.has(mimeType)) {
    throw badRequest('Only PDF and common image types are accepted');
  }
}

export async function uploadVehicleDocument(params: {
  vehicleId: number;
  userId: number;
  isStaff: boolean;
  docType: string;
  title?: string | null;
  storagePath: string;
  listingDocumentId?: number | null;
  mimeType?: string | null;
}) {
  await assertVehicleOwner(params.vehicleId, params.userId, params.isStaff);
  assertSafeVehicleDocumentFile(params.storagePath, params.mimeType);

  const id = await insertAndGetId(
    `INSERT INTO vehicle_documents
       (uuid, vehicle_id, listing_document_id, doc_type, title, storage_path, uploaded_by,
        verification_status, processing_status, scan_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'validating', 'pending')`,
    [
      uuid(),
      params.vehicleId,
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

  await processVehicleDocument(id);
  await recordAudit({
    action: 'vehicle.document.uploaded',
    entityType: 'vehicle_document',
    entityId: id,
    after: { vehicleId: params.vehicleId, docType: params.docType },
  });
  return getVehicleDocument(id, params.userId, params.isStaff);
}

export async function processVehicleDocument(id: number): Promise<void> {
  const row = await queryOne<Row>('SELECT * FROM vehicle_documents WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!row) return;
  if (BLOCKED_EXT.test(String(row.storage_path))) {
    await execute(
      `UPDATE vehicle_documents
          SET scan_status = 'blocked', processing_status = 'failed', verification_status = 'rejected',
              rejection_reason = 'Blocked file type'
        WHERE id = ?`,
      [id],
    );
    return;
  }
  const classified = String(row.doc_type);
  await execute(
    `UPDATE vehicle_documents
        SET scan_status = 'skipped_no_scanner',
            processing_status = 'review',
            verification_status = 'needs_review',
            ocr_text = ?,
            extracted_data = ?
      WHERE id = ?`,
    [
      `Heuristic classification: ${classified}. OCR success is not legal ownership or customs verification.`,
      JSON.stringify({ classifiedAs: classified, legalOwnershipVerified: false, customsCleared: false }),
      id,
    ],
  );
}

export async function getVehicleDocument(id: number, userId: number, isStaff: boolean) {
  const row = await queryOne<Row>(
    `SELECT d.*, v.owner_user_id
       FROM vehicle_documents d
       JOIN vehicles v ON v.id = d.vehicle_id
      WHERE d.id = ? AND d.deleted_at IS NULL`,
    [id],
  );
  if (!row) throw notFound('Document');
  const owner = Number(row.owner_user_id) === userId || isStaff;
  if (!owner) throw forbidden('Vehicle documents are not public');
  return mapDocument(row, true);
}

export async function listVehicleDocuments(vehicleId: number, userId: number | null, isStaff: boolean) {
  const vehicle = await queryOne<Row>('SELECT owner_user_id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [
    vehicleId,
  ]);
  if (!vehicle) throw notFound('Vehicle');
  const owner = isStaff || (userId !== null && Number(vehicle.owner_user_id) === userId);
  const rows = await queryRows<Row>(
    `SELECT * FROM vehicle_documents WHERE vehicle_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    [vehicleId],
  );
  return rows.map((row) => mapDocument(row, owner));
}

export async function verifyVehicleDocument(params: {
  documentId: number;
  actorId: number;
  isStaff: boolean;
  decision: 'verified' | 'rejected';
  reason?: string | null;
}) {
  if (!params.isStaff) throw forbidden('Only staff can verify vehicle documents');
  const row = await queryOne<Row>('SELECT * FROM vehicle_documents WHERE id = ? AND deleted_at IS NULL', [
    params.documentId,
  ]);
  if (!row) throw notFound('Document');
  await execute(
    `UPDATE vehicle_documents
        SET verification_status = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP,
            rejection_reason = ?, processing_status = 'complete'
      WHERE id = ?`,
    [params.decision, params.actorId, params.reason ?? null, params.documentId],
  );
  const vehicle = await queryOne<Row>('SELECT owner_user_id FROM vehicles WHERE id = ?', [Number(row.vehicle_id)]);
  if (vehicle) {
    await notifyUser({
      userId: Number(vehicle.owner_user_id),
      categoryCode: 'vehicle.document',
      title: 'Document review update',
      body: `A ${String(row.doc_type)} document was ${params.decision}.`,
      actionType: 'verification',
      actionTarget: String(row.vehicle_id),
    });
  }
  await recordAudit({
    action: 'vehicle.document.verified',
    entityType: 'vehicle_document',
    entityId: params.documentId,
    after: { decision: params.decision },
  });
  return getVehicleDocument(params.documentId, params.actorId, true);
}

export async function protectVehicleDocuments(): Promise<number> {
  const result = await execute(
    `UPDATE vehicle_documents SET processing_status = processing_status
      WHERE deleted_at IS NULL AND verification_status IN ('pending','needs_review')`,
  );
  const listing = await execute(
    `UPDATE listing_documents d
       JOIN listings l ON l.id = d.listing_id
      SET d.is_public = 0
      WHERE l.marketplace_id = 3
        AND d.doc_type IN ('registration','title','bill_of_sale','vin_photo','customs_declaration','import_permit')
        AND d.is_public = 1`,
  );
  return result.affectedRows + listing.affectedRows;
}

function mapDocument(row: Row, includePath: boolean) {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    vehicleId: Number(row.vehicle_id),
    docType: String(row.doc_type),
    title: (row.title as string | null) ?? null,
    storagePath: includePath ? String(row.storage_path) : undefined,
    verificationStatus: String(row.verification_status),
    processingStatus: String(row.processing_status),
    scanStatus: String(row.scan_status),
    createdAt: (row.created_at as Date).toISOString(),
  };
}
