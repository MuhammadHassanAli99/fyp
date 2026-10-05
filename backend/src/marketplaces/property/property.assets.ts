import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import type { PoolConnection } from '../../db/pool';
import { uuid } from '../../core/security/crypto';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { toNumber } from '../../db/sql';
import { getMapProvider } from '../../providers/maps';
import { recordAudit } from '../../middleware/audit';

export async function createPropertyRecord(
  params: {
    ownerUserId: number;
    businessId?: number | null;
    propertyKind: string;
    usageType: string;
    title?: string | null;
    countryId: number;
    regionId?: number | null;
    cityId?: number | null;
    areaId?: number | null;
    neighborhood?: string | null;
    buildingName?: string | null;
    postalCode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    locationPrivacy?: 'public_exact' | 'approximate' | 'private';
    projectId?: number | null;
    unitId?: number | null;
  },
  connection?: PoolConnection,
): Promise<number> {
  const privacy = params.locationPrivacy ?? 'approximate';
  let publicLat = params.latitude ?? null;
  let publicLng = params.longitude ?? null;
  if (privacy !== 'public_exact' && params.latitude != null && params.longitude != null) {
    const approx = getMapProvider().approximate(params.latitude, params.longitude, params.ownerUserId);
    publicLat = approx.latitude;
    publicLng = approx.longitude;
  }

  return insertAndGetId(
    `INSERT INTO properties
       (uuid, owner_user_id, business_id, property_kind, usage_type, title, country_id, region_id,
        city_id, area_id, neighborhood, building_name, postal_code, latitude, longitude,
        public_latitude, public_longitude, location_privacy, project_id, unit_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      params.ownerUserId,
      params.businessId ?? null,
      params.propertyKind,
      params.usageType,
      params.title ?? null,
      params.countryId,
      params.regionId ?? null,
      params.cityId ?? null,
      params.areaId ?? null,
      params.neighborhood ?? null,
      params.buildingName ?? null,
      params.postalCode ?? null,
      privacy === 'private' ? null : (params.latitude ?? null),
      privacy === 'private' ? null : (params.longitude ?? null),
      publicLat,
      publicLng,
      privacy,
      params.projectId ?? null,
      params.unitId ?? null,
    ],
    connection,
  );
}

export async function assertPropertyOwner(propertyId: number, userId: number, isStaff: boolean): Promise<Row> {
  const row = await queryOne<Row>(
    'SELECT * FROM properties WHERE id = ? AND deleted_at IS NULL',
    [propertyId],
  );
  if (!row) throw notFound('Property');
  if (!isStaff && Number(row.owner_user_id) !== userId) {
    throw forbidden('You do not own this property');
  }
  return row;
}

export async function getProperty(propertyId: number, viewerId: number | null, isStaff: boolean) {
  const row = await queryOne<Row>(
    `SELECT p.*,
            (SELECT COUNT(*) FROM property_listing_details d WHERE d.property_id = p.id) AS listing_count
       FROM properties p
      WHERE p.id = ? AND p.deleted_at IS NULL`,
    [propertyId],
  );
  if (!row) throw notFound('Property');
  const isOwner = viewerId !== null && Number(row.owner_user_id) === viewerId;
  return mapProperty(row, isOwner || isStaff);
}

export async function listMyProperties(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT p.*,
            (SELECT COUNT(*) FROM property_listing_details d WHERE d.property_id = p.id) AS listing_count
       FROM properties p
      WHERE p.owner_user_id = ? AND p.deleted_at IS NULL
      ORDER BY p.updated_at DESC
      LIMIT 200`,
    [userId],
  );
  return rows.map((row) => mapProperty(row, true));
}

export async function getPublicLocation(listingId: number) {
  const row = await queryOne<Row>(
    `SELECT l.id, l.title, l.hide_exact_location, l.latitude, l.longitude, l.area_id,
            a.name AS area_name, pd.society_name, pd.public_latitude, pd.public_longitude,
            pd.location_privacy, pd.property_id
       FROM listings l
       JOIN property_listing_details pd ON pd.listing_id = l.id
       LEFT JOIN areas a ON a.id = l.area_id
      WHERE l.id = ? AND l.deleted_at IS NULL`,
    [listingId],
  );
  if (!row) throw notFound('Listing');
  const hide =
    Number(row.hide_exact_location) === 1 || String(row.location_privacy ?? 'approximate') !== 'public_exact';
  const label = hide
    ? `Near ${String(row.area_name || row.society_name || 'this area')}`
    : String(row.area_name || row.society_name || 'Exact location');
  const provider = getMapProvider();
  const exactLat = toNumber(row.latitude);
  const exactLng = toNumber(row.longitude);
  const publicLat = toNumber(row.public_latitude);
  const publicLng = toNumber(row.public_longitude);
  const coords =
    hide && exactLat !== null && exactLng !== null
      ? publicLat !== null && publicLng !== null
        ? { latitude: publicLat, longitude: publicLng }
        : provider.approximate(exactLat, exactLng, listingId)
      : { latitude: exactLat, longitude: exactLng };
  return {
    listingId,
    propertyId: row.property_id === null ? null : Number(row.property_id),
    label,
    approximate: hide,
    ...coords,
  };
}

export async function getExactLocation(listingId: number, userId: number, isStaff: boolean) {
  const row = await queryOne<Row>(
    `SELECT l.id, l.user_id, l.latitude, l.longitude, l.address, l.hide_exact_location, pd.property_id
       FROM listings l
       JOIN property_listing_details pd ON pd.listing_id = l.id
      WHERE l.id = ? AND l.deleted_at IS NULL`,
    [listingId],
  );
  if (!row) throw notFound('Listing');
  const owner = Number(row.user_id) === userId || isStaff;
  const authorized =
    owner ||
    (await isAcceptedCounterparty(listingId, userId)) ||
    (await isActiveTenant(Number(row.property_id), userId));
  if (!authorized) throw forbidden('Exact location is only available to the owner or an accepted party');
  return {
    listingId,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    address: (row.address as string | null) ?? null,
    exact: true,
  };
}

async function isAcceptedCounterparty(listingId: number, userId: number): Promise<boolean> {
  const offer = await queryOne<Row>(
    `SELECT id FROM listing_offers
      WHERE listing_id = ? AND buyer_id = ? AND status = 'accepted' LIMIT 1`,
    [listingId, userId],
  );
  if (offer) return true;
  const booking = await queryOne<Row>(
    `SELECT id FROM property_bookings
      WHERE listing_id = ? AND guest_id = ? AND status IN ('confirmed','checked_in') LIMIT 1`,
    [listingId, userId],
  );
  return Boolean(booking);
}

async function isActiveTenant(propertyId: number | null, userId: number): Promise<boolean> {
  if (!propertyId) return false;
  const lease = await queryOne<Row>(
    `SELECT id FROM property_leases WHERE property_id = ? AND tenant_id = ? AND status = 'active' LIMIT 1`,
    [propertyId, userId],
  );
  return Boolean(lease);
}

function mapProperty(row: Row, includeExact: boolean) {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    ownerUserId: Number(row.owner_user_id),
    businessId: row.business_id === null ? null : Number(row.business_id),
    propertyKind: String(row.property_kind),
    usageType: String(row.usage_type),
    title: (row.title as string | null) ?? null,
    countryId: Number(row.country_id),
    cityId: row.city_id === null ? null : Number(row.city_id),
    areaId: row.area_id === null ? null : Number(row.area_id),
    neighborhood: (row.neighborhood as string | null) ?? null,
    buildingName: (row.building_name as string | null) ?? null,
    locationPrivacy: String(row.location_privacy),
    latitude: includeExact ? toNumber(row.latitude) : toNumber(row.public_latitude),
    longitude: includeExact ? toNumber(row.longitude) : toNumber(row.public_longitude),
    publicLatitude: toNumber(row.public_latitude),
    publicLongitude: toNumber(row.public_longitude),
    listingCount: Number(row.listing_count ?? 0),
    projectId: row.project_id === null || row.project_id === undefined ? null : Number(row.project_id),
    status: String(row.status),
  };
}

export async function recordPropertyAudit(action: string, entityType: string, entityId: number, after?: unknown) {
  await recordAudit({ action, entityType, entityId, after });
}

export { execute };
