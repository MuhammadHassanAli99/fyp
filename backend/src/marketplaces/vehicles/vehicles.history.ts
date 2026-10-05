import { execute, insertAndGetId, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { forbidden, notFound } from '../../core/errors';
import { toNumber } from '../../db/sql';
import { assertVehicleOwner } from './vehicles.assets';

export async function addHistoryEvent(params: {
  vehicleId: number;
  userId: number;
  isStaff: boolean;
  eventType: 'ownership' | 'registration' | 'accident' | 'mileage' | 'service' | 'inspection' | 'import' | 'export' | 'damage' | 'auction' | 'recall' | 'other';
  occurredAt?: string | null;
  source?: string;
  summary?: string | null;
  payload?: unknown;
}) {
  await assertVehicleOwner(params.vehicleId, params.userId, params.isStaff);
  const id = await insertAndGetId(
    `INSERT INTO vehicle_history_events (vehicle_id, event_type, occurred_at, source, is_verified, summary, payload)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [
      params.vehicleId,
      params.eventType,
      params.occurredAt ?? null,
      params.source ?? 'owner_declared',
      params.summary ?? null,
      params.payload ? JSON.stringify(params.payload) : null,
    ],
  );
  return { id, isVerified: false, disclaimer: 'Declared history is not verified unless an authoritative source exists.' };
}

export async function listHistory(vehicleId: number) {
  const rows = await queryRows<Row>(
    `SELECT * FROM vehicle_history_events WHERE vehicle_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 200`,
    [vehicleId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    eventType: String(row.event_type),
    occurredAt: row.occurred_at ? String(row.occurred_at).slice(0, 10) : null,
    source: String(row.source),
    isVerified: Number(row.is_verified) === 1,
    summary: row.summary,
  }));
}

export async function addServiceRecord(params: {
  vehicleId: number;
  userId: number;
  isStaff: boolean;
  servicedAt: string;
  mileageValue?: number | null;
  mileageUnit?: string | null;
  workshop?: string | null;
  serviceType?: string | null;
  parts?: string | null;
  costAmount?: number | null;
  costCurrency?: string | null;
  invoicePath?: string | null;
  notes?: string | null;
  visibility?: 'private' | 'authorized' | 'public';
}) {
  await assertVehicleOwner(params.vehicleId, params.userId, params.isStaff);
  const id = await insertAndGetId(
    `INSERT INTO vehicle_service_records
       (uuid, vehicle_id, serviced_at, mileage_value, mileage_unit, workshop, service_type, parts,
        cost_amount, cost_currency, invoice_path, notes, visibility, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      params.vehicleId,
      params.servicedAt,
      params.mileageValue ?? null,
      params.mileageUnit ?? null,
      params.workshop ?? null,
      params.serviceType ?? null,
      params.parts ?? null,
      params.costAmount ?? null,
      params.costCurrency ?? null,
      params.invoicePath ?? null,
      params.notes ?? null,
      params.visibility ?? 'private',
      params.userId,
    ],
  );
  return { id };
}

export async function listServiceRecords(vehicleId: number, userId: number | null, isStaff: boolean) {
  const vehicle = await queryRows<Row>(`SELECT owner_user_id FROM vehicles WHERE id = ? AND deleted_at IS NULL`, [
    vehicleId,
  ]);
  if (vehicle.length === 0) throw notFound('Vehicle');
  const owner = isStaff || (userId !== null && Number(vehicle[0]!.owner_user_id) === userId);
  const rows = await queryRows<Row>(
    `SELECT * FROM vehicle_service_records WHERE vehicle_id = ? ORDER BY serviced_at DESC LIMIT 200`,
    [vehicleId],
  );
  return rows
    .filter((row) => owner || String(row.visibility) === 'public')
    .map((row) => ({
      id: Number(row.id),
      servicedAt: String(row.serviced_at).slice(0, 10),
      mileageValue: row.mileage_value === null ? null : Number(row.mileage_value),
      workshop: owner ? row.workshop : null,
      serviceType: row.service_type,
      costAmount: owner ? toNumber(row.cost_amount) : null,
      visibility: String(row.visibility),
    }));
}

export async function addMileageReading(params: {
  vehicleId: number;
  userId: number;
  isStaff: boolean;
  value: number;
  unit: string;
  source?: 'owner' | 'inspection' | 'service' | 'import' | 'odometer_photo' | 'system';
}) {
  await assertVehicleOwner(params.vehicleId, params.userId, params.isStaff);
  const km = params.unit === 'mi' ? Math.round(params.value * 1.60934) : params.unit === 'hours' ? null : params.value;
  const id = await insertAndGetId(
    `INSERT INTO vehicle_mileage_readings
       (vehicle_id, value, unit, value_km, source, verification_status, created_by)
     VALUES (?, ?, ?, ?, ?, 'unverified', ?)`,
    [params.vehicleId, params.value, params.unit, km, params.source ?? 'owner', params.userId],
  );
  if (km !== null) {
    await execute(`UPDATE vehicle_listing_details SET mileage_km = ?, mileage = ?, mileage_unit = ? WHERE vehicle_id = ?`, [
      km,
      params.value,
      params.unit,
      params.vehicleId,
    ]);
  }
  return { id, verificationStatus: 'unverified' };
}

export function assertHistoryAuthorized(_userId: number | null): void {
  if (!_userId) throw forbidden('Private service records require authorization');
}
