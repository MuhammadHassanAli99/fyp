import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import type { PoolConnection } from '../../db/pool';
import { uuid } from '../../core/security/crypto';
import { forbidden, notFound } from '../../core/errors';
import { toNumber } from '../../db/sql';
import { recordAudit } from '../../middleware/audit';
import { decodeVin, normalizeVin } from './vehicles.vin';

export async function createVehicleRecord(
  params: {
    ownerUserId: number;
    businessId?: number | null;
    vehicleType: string;
    makeId?: number | null;
    modelId?: number | null;
    variantId?: number | null;
    makeName?: string | null;
    modelName?: string | null;
    variantName?: string | null;
    trim?: string | null;
    generation?: string | null;
    year?: number | null;
    modelYear?: number | null;
    manufacturingDate?: string | null;
    countryOfManufacture?: number | null;
    bodyType?: string | null;
    colorExterior?: string | null;
    colorInterior?: string | null;
    colorFamily?: string | null;
    vehicleCondition?: string | null;
    engineType?: string | null;
    engineCc?: number | null;
    cylinders?: number | null;
    powerHp?: number | null;
    torqueNm?: number | null;
    engineNumber?: string | null;
    fuelType?: string | null;
    transmission?: string | null;
    drivetrain?: string | null;
    batteryKwh?: number | null;
    batteryHealthPct?: number | null;
    rangeKm?: number | null;
    chargingType?: string | null;
    chargingTimeHours?: number | null;
    acCharging?: boolean;
    dcCharging?: boolean;
    fastCharging?: boolean;
    batteryWarrantyMonths?: number | null;
    doors?: number | null;
    seats?: number | null;
    countryId: number;
    regionId?: number | null;
    cityId?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    seedListingId?: number | null;
    vin?: string | null;
    featureIds?: number[];
  },
  connection?: PoolConnection,
): Promise<number> {
  const id = await insertAndGetId(
    `INSERT INTO vehicles
       (uuid, owner_user_id, business_id, vehicle_type, make_id, model_id, variant_id,
        make_name, model_name, variant_name, trim, generation, year, model_year, manufacturing_date,
        country_of_manufacture, body_type, color_exterior, color_interior, color_family, vehicle_condition,
        engine_type, engine_cc, cylinders, power_hp, torque_nm, engine_number, fuel_type, transmission,
        drivetrain, battery_kwh, battery_health_pct, range_km, charging_type, charging_time_hours,
        ac_charging, dc_charging, fast_charging, battery_warranty_months, doors, seats,
        country_id, region_id, city_id, latitude, longitude, seed_listing_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      uuid(),
      params.ownerUserId,
      params.businessId ?? null,
      params.vehicleType,
      params.makeId ?? null,
      params.modelId ?? null,
      params.variantId ?? null,
      params.makeName ?? null,
      params.modelName ?? null,
      params.variantName ?? null,
      params.trim ?? null,
      params.generation ?? null,
      params.year ?? null,
      params.modelYear ?? null,
      params.manufacturingDate ?? null,
      params.countryOfManufacture ?? null,
      params.bodyType ?? null,
      params.colorExterior ?? null,
      params.colorInterior ?? null,
      params.colorFamily ?? null,
      params.vehicleCondition ?? null,
      params.engineType ?? null,
      params.engineCc ?? null,
      params.cylinders ?? null,
      params.powerHp ?? null,
      params.torqueNm ?? null,
      params.engineNumber ?? null,
      params.fuelType ?? null,
      params.transmission ?? null,
      params.drivetrain ?? null,
      params.batteryKwh ?? null,
      params.batteryHealthPct ?? null,
      params.rangeKm ?? null,
      params.chargingType ?? null,
      params.chargingTimeHours ?? null,
      params.acCharging ? 1 : 0,
      params.dcCharging ? 1 : 0,
      params.fastCharging ? 1 : 0,
      params.batteryWarrantyMonths ?? null,
      params.doors ?? null,
      params.seats ?? null,
      params.countryId,
      params.regionId ?? null,
      params.cityId ?? null,
      params.latitude ?? null,
      params.longitude ?? null,
      params.seedListingId ?? null,
    ],
    connection,
  );

  if (params.featureIds && params.featureIds.length > 0) {
    const unique = [...new Set(params.featureIds)];
    for (const featureId of unique) {
      await execute(
        'INSERT IGNORE INTO vehicle_feature_values (vehicle_id, feature_id) VALUES (?, ?)',
        [id, featureId],
        connection,
      );
    }
  }

  if (params.vin) {
    const vin = normalizeVin(params.vin);
    const decoded = decodeVin(vin);
    await execute(
      `INSERT INTO vehicle_vin_records
         (vehicle_id, vin, verification_status, decoded_manufacturer, decoded_model, decoded_year,
          decoded_country, decode_json)
       VALUES (?, ?, 'unverified', ?, ?, ?, ?, ?)`,
      [
        id,
        vin,
        decoded.manufacturerHint,
        decoded.vds,
        decoded.year,
        decoded.country,
        JSON.stringify(decoded),
      ],
      connection,
    );
  }

  await recordAudit({
    action: 'vehicle.created',
    entityType: 'vehicle',
    entityId: id,
    actorId: params.ownerUserId,
    after: { vehicleType: params.vehicleType, year: params.year },
  });

  return id;
}

export async function assertVehicleOwner(vehicleId: number, userId: number, isStaff: boolean): Promise<Row> {
  const row = await queryOne<Row>('SELECT * FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicleId]);
  if (!row) throw notFound('Vehicle');
  if (!isStaff && Number(row.owner_user_id) !== userId) {
    throw forbidden('You do not own this vehicle');
  }
  return row;
}

export async function getVehicle(vehicleId: number, viewerId: number | null, isStaff: boolean) {
  const row = await queryOne<Row>(
    `SELECT v.*,
            (SELECT COUNT(*) FROM vehicle_listing_details d WHERE d.vehicle_id = v.id) AS listing_count
       FROM vehicles v
      WHERE v.id = ? AND v.deleted_at IS NULL`,
    [vehicleId],
  );
  if (!row) throw notFound('Vehicle');
  const isOwner = viewerId !== null && Number(row.owner_user_id) === viewerId;
  return mapVehicle(row, isOwner || isStaff);
}

export async function listMyVehicles(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT v.*,
            (SELECT COUNT(*) FROM vehicle_listing_details d WHERE d.vehicle_id = v.id) AS listing_count
       FROM vehicles v
      WHERE v.owner_user_id = ? AND v.deleted_at IS NULL
      ORDER BY v.updated_at DESC
      LIMIT 200`,
    [userId],
  );
  return rows.map((row) => mapVehicle(row, true));
}

export async function listVehicleMarkers(bounds: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  limit: number;
}) {
  const rows = await queryRows<Row>(
    `SELECT l.id, l.title, l.latitude, l.longitude, l.hide_exact_location
       FROM listings l
       JOIN vehicle_listing_details vd ON vd.listing_id = l.id
      WHERE l.marketplace_id = 3
        AND l.status = 'published'
        AND l.deleted_at IS NULL
        AND l.latitude BETWEEN ? AND ?
        AND l.longitude BETWEEN ? AND ?
      LIMIT ?`,
    [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng, bounds.limit],
  );
  return rows
    .filter((row) => row.latitude != null && row.longitude != null)
    .map((row) => {
      const hide = Number(row.hide_exact_location) === 1;
      const lat = Number(row.latitude);
      const lng = Number(row.longitude);
      return {
        listingId: Number(row.id),
        latitude: hide ? Number((lat + 0.002).toFixed(5)) : lat,
        longitude: hide ? Number((lng - 0.002).toFixed(5)) : lng,
        title: String(row.title),
        approximate: hide,
      };
    });
}

function mapVehicle(row: Row, includePrivate: boolean) {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    ownerUserId: includePrivate ? Number(row.owner_user_id) : undefined,
    businessId: row.business_id === null ? null : Number(row.business_id),
    vehicleType: String(row.vehicle_type),
    makeId: row.make_id === null ? null : Number(row.make_id),
    modelId: row.model_id === null ? null : Number(row.model_id),
    variantId: row.variant_id === null ? null : Number(row.variant_id),
    makeName: row.make_name,
    modelName: row.model_name,
    variantName: row.variant_name,
    trim: row.trim,
    generation: row.generation,
    year: row.year === null ? null : Number(row.year),
    modelYear: row.model_year === null ? null : Number(row.model_year),
    vehicleCondition: row.vehicle_condition,
    fuelType: row.fuel_type,
    transmission: row.transmission,
    drivetrain: row.drivetrain,
    engineCc: toNumber(row.engine_cc),
    listingCount: Number(row.listing_count ?? 0),
    availabilityStatus: row.availability_status,
    status: row.status,
  };
}
