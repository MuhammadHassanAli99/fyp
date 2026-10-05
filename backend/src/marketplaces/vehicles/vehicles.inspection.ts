import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { toNumber } from '../../db/sql';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { recordAudit } from '../../middleware/audit';

export function gradeFor(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

export function resultFor(score: number): 'pass' | 'pass_with_warnings' | 'requires_repair' | 'fail' {
  if (score >= 80) return 'pass';
  if (score >= 65) return 'pass_with_warnings';
  if (score >= 50) return 'requires_repair';
  return 'fail';
}

export async function createStructuredInspection(params: {
  listingId: number;
  vehicleId?: number | null;
  inspectorId: number;
  isStaff: boolean;
  checklistCode: string;
  inspectorName?: string | null;
  items: Array<{ itemCode: string; score?: number; result?: string; notes?: string; measurement?: string }>;
}) {
  if (!params.isStaff) throw forbidden('Only staff inspectors can submit a structured inspection');
  if (params.items.length === 0) throw badRequest('An inspection needs at least one checklist item');
  const listing = await queryOne<Row>(
    `SELECT l.id, l.user_id, vd.vehicle_id FROM listings l
       JOIN vehicle_listing_details vd ON vd.listing_id = l.id
      WHERE l.id = ?`,
    [params.listingId],
  );
  if (!listing) throw notFound('Listing');
  const scores = params.items.map((item) => item.score).filter((value): value is number => typeof value === 'number');
  const overall = scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)) : null;
  const grade = overall === null ? null : gradeFor(overall);
  const result = overall === null ? null : resultFor(overall);
  const inspectionUuid = uuid();
  const id = await insertAndGetId(
    `INSERT INTO vehicle_inspections
       (uuid, listing_id, vehicle_id, inspector_id, inspector_name, checklist_code, overall_score, grade, result, checklist)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      inspectionUuid,
      params.listingId,
      params.vehicleId ?? listing.vehicle_id ?? null,
      params.inspectorId,
      params.inspectorName ?? null,
      params.checklistCode,
      overall,
      grade,
      result,
      JSON.stringify(params.items),
    ],
  );
  for (const item of params.items) {
    await execute(
      `INSERT INTO vehicle_inspection_items (inspection_id, item_code, score, result, notes, measurement)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, item.itemCode, item.score ?? null, item.result ?? 'not_checked', item.notes ?? null, item.measurement ?? null],
    );
  }
  if (overall !== null) {
    await execute(
      `UPDATE vehicle_listing_details
          SET is_inspected = 1, inspection_score = ?, inspection_grade = ?, inspected_at = CURRENT_TIMESTAMP
        WHERE listing_id = ?`,
      [overall, grade, params.listingId],
    );
  }
  await recordAudit({
    action: 'vehicle.inspection.created',
    entityType: 'vehicle_inspection',
    entityId: id,
    after: { listingId: params.listingId, result, overall },
  });
  return getStructuredInspection(params.listingId);
}

export async function getStructuredInspection(listingId: number) {
  const row = await queryOne<Row>(
    'SELECT * FROM vehicle_inspections WHERE listing_id = ? ORDER BY inspected_at DESC LIMIT 1',
    [listingId],
  );
  if (!row) return null;
  const items = await queryRows<Row>(
    'SELECT item_code, name, group_code, score, result, notes, measurement FROM vehicle_inspection_items WHERE inspection_id = ?',
    [row.id],
  );
  return {
    uuid: String(row.uuid),
    listingId: Number(row.listing_id),
    vehicleId: row.vehicle_id === null ? null : Number(row.vehicle_id),
    checklistCode: (row.checklist_code as string | null) ?? null,
    overallScore: toNumber(row.overall_score),
    grade: row.grade,
    result: row.result,
    items: items.map((item) => ({
      code: String(item.item_code),
      name: item.name,
      groupCode: item.group_code,
      score: toNumber(item.score),
      result: String(item.result),
      notes: item.notes,
      measurement: item.measurement,
    })),
    inspectedAt: (row.inspected_at as Date).toISOString(),
  };
}
