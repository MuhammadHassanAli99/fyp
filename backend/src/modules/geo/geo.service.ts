import { queryOne, queryRows, type Row } from '../../db/query';
import { escapeLike, haversineExpression, toBoolean, toNumber, where, type SqlValue } from '../../db/sql';
import { remember } from '../../config/cache';
import { notFound } from '../../core/errors';

/**
 * Geography (§1 Location, §11 Maps).
 *
 * The hierarchy is country → region (province/state) → city → area. Everything
 * here is reference data that changes a few times a year, so every read is
 * cached; the only uncached paths are the coordinate lookups, which are unique
 * per request anyway.
 *
 * Radius work uses `haversineExpression` with a bounding-box prefilter, the same
 * pattern as the listing feed — a bare haversine over every city is a full scan.
 */

export interface RegionSummary {
  id: number;
  countryId: number;
  parentId: number | null;
  code: string | null;
  name: string;
  type: string;
  latitude: number | null;
  longitude: number | null;
  cityCount: number;
}

export interface CitySummary {
  id: number;
  countryId: number;
  regionId: number | null;
  regionName: string | null;
  name: string;
  slug: string;
  latitude: number | null;
  longitude: number | null;
  population: number | null;
  timezone: string | null;
  isPopular: boolean;
}

export interface AreaSummary {
  id: number;
  cityId: number;
  parentId: number | null;
  name: string;
  slug: string;
  latitude: number | null;
  longitude: number | null;
}

const mapRegion = (row: Row): RegionSummary => ({
  id: Number(row.id),
  countryId: Number(row.country_id),
  parentId: row.parent_id === null ? null : Number(row.parent_id),
  code: (row.code as string | null) ?? null,
  name: String(row.name),
  type: String(row.type),
  latitude: toNumber(row.latitude),
  longitude: toNumber(row.longitude),
  cityCount: Number(row.city_count ?? 0),
});

const mapCity = (row: Row): CitySummary => ({
  id: Number(row.id),
  countryId: Number(row.country_id),
  regionId: row.region_id === null ? null : Number(row.region_id),
  regionName: (row.region_name as string | null) ?? null,
  name: String(row.name),
  slug: String(row.slug),
  latitude: toNumber(row.latitude),
  longitude: toNumber(row.longitude),
  population: row.population === null ? null : Number(row.population),
  timezone: (row.timezone as string | null) ?? null,
  isPopular: toBoolean(row.is_popular),
});

const mapArea = (row: Row): AreaSummary => ({
  id: Number(row.id),
  cityId: Number(row.city_id),
  parentId: row.parent_id === null ? null : Number(row.parent_id),
  name: String(row.name),
  slug: String(row.slug),
  latitude: toNumber(row.latitude),
  longitude: toNumber(row.longitude),
});

export const listRegions = (countryId: number): Promise<RegionSummary[]> =>
  remember(`geo:regions:${countryId}`, 3600, async () => {
    const rows = await queryRows<Row>(
      `SELECT r.id, r.country_id, r.parent_id, r.code, r.name, r.type, r.latitude, r.longitude,
              (SELECT COUNT(*) FROM cities c WHERE c.region_id = r.id AND c.is_active = 1) AS city_count
         FROM regions r
        WHERE r.country_id = ? AND r.is_active = 1
        ORDER BY r.name`,
      [countryId],
    );
    return rows.map(mapRegion);
  });

/**
 * City picker feed. `search` is a prefix match on purpose: a leading wildcard
 * cannot use the index, and users type the start of a city name.
 */
export async function listCities(params: {
  countryId: number;
  regionId?: number | null;
  search?: string | null;
  popularOnly?: boolean;
  limit: number;
}): Promise<CitySummary[]> {
  const search = params.search?.trim() ?? '';

  // Only the unfiltered list is worth caching; a search term makes the key
  // unbounded and the query is already index-only.
  if (search.length === 0) {
    const key = `geo:cities:${params.countryId}:${params.regionId ?? 'all'}:${params.popularOnly ? 'pop' : 'all'}:${params.limit}`;
    return remember(key, 3600, () => queryCities(params, null));
  }
  return queryCities(params, search);
}

async function queryCities(
  params: { countryId: number; regionId?: number | null; popularOnly?: boolean; limit: number },
  search: string | null,
): Promise<CitySummary[]> {
  const builder = where();
  builder.eq('c.country_id', params.countryId);
  builder.bool('c.is_active', true);
  builder.eq('c.region_id', params.regionId ?? null);
  if (params.popularOnly) builder.bool('c.is_popular', true);
  builder.startsWith('c.name', search);

  const { sql, params: whereParams } = builder.build();

  const rows = await queryRows<Row>(
    `SELECT c.id, c.country_id, c.region_id, c.name, c.slug, c.latitude, c.longitude,
            c.population, c.timezone, c.is_popular, r.name AS region_name
       FROM cities c
       LEFT JOIN regions r ON r.id = c.region_id
       ${sql}
       ORDER BY c.is_popular DESC, c.population DESC, c.name
       LIMIT ?`,
    [...whereParams, params.limit],
  );
  return rows.map(mapCity);
}

export async function listAreas(cityId: number, search?: string | null): Promise<AreaSummary[]> {
  const term = search?.trim() ?? '';
  if (term.length === 0) {
    return remember(`geo:areas:${cityId}`, 3600, () => queryAreas(cityId, null));
  }
  return queryAreas(cityId, term);
}

async function queryAreas(cityId: number, search: string | null): Promise<AreaSummary[]> {
  const builder = where();
  builder.eq('city_id', cityId);
  builder.bool('is_active', true);
  builder.startsWith('name', search);
  const { sql, params: whereParams } = builder.build();

  const rows = await queryRows<Row>(
    `SELECT id, city_id, parent_id, name, slug, latitude, longitude
       FROM areas ${sql} ORDER BY name LIMIT 500`,
    whereParams,
  );
  return rows.map(mapArea);
}

export async function getCityBySlug(countryId: number, idOrSlug: string | number): Promise<CitySummary> {
  const numericId = Number(idOrSlug);
  const row = await queryOne<Row>(
    `SELECT c.id, c.country_id, c.region_id, c.name, c.slug, c.latitude, c.longitude,
            c.population, c.timezone, c.is_popular, r.name AS region_name
       FROM cities c
       LEFT JOIN regions r ON r.id = c.region_id
      WHERE (c.id = ? OR (c.slug = ? AND c.country_id = ?)) AND c.is_active = 1
      LIMIT 1`,
    [Number.isFinite(numericId) ? numericId : 0, String(idOrSlug), countryId],
  );
  if (!row) throw notFound('City');
  return mapCity(row);
}

export interface ReverseGeocodeResult {
  city: CitySummary | null;
  region: { id: number; name: string; type: string } | null
  country: { id: number; iso2: string; name: string; defaultCurrency: string; defaultLanguage: string; timezone: string } | null;
  distanceKm: number | null;
  /** Which strategy answered — the client shows a coarser label when it guessed. */
  precision: 'city' | 'country' | 'none';
}

/**
 * §1 GPS: turns a fix into a place. There is no external geocoder configured
 * (GEO_DRIVER=local), so this is nearest-city by great-circle distance, which is
 * accurate enough to preselect a city in the location picker and honest about
 * how far off it might be via `distanceKm`.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  const distance = haversineExpression('c.latitude', 'c.longitude');

  // Widen the box until something is found: a fix in the middle of a desert or
  // at sea should still resolve to the nearest populated place.
  for (const radiusKm of [50, 250, 1000]) {
    const builder = where();
    builder.bool('c.is_active', true);
    builder.isNotNull('c.latitude');
    builder.isNotNull('c.longitude');
    builder.withinBoundingBox('c.latitude', 'c.longitude', lat, lng, radiusKm);
    const { sql, params: whereParams } = builder.build();

    const row = await queryOne<Row>(
      `SELECT c.id, c.country_id, c.region_id, c.name, c.slug, c.latitude, c.longitude,
              c.population, c.timezone, c.is_popular,
              r.name AS region_name, r.id AS region_pk, r.type AS region_type,
              co.iso2, co.name AS country_name, co.default_currency, co.default_language, co.default_timezone,
              ${distance} AS distance_km
         FROM cities c
         LEFT JOIN regions r ON r.id = c.region_id
         JOIN countries co ON co.id = c.country_id
         ${sql}
         ORDER BY distance_km
         LIMIT 1`,
      [lat, lng, lat, ...whereParams],
    );

    if (row) {
      return {
        city: mapCity(row),
        region:
          row.region_pk === null
            ? null
            : { id: Number(row.region_pk), name: String(row.region_name), type: String(row.region_type) },
        country: {
          id: Number(row.country_id),
          iso2: String(row.iso2),
          name: String(row.country_name),
          defaultCurrency: String(row.default_currency),
          defaultLanguage: String(row.default_language),
          timezone: (row.timezone as string | null) ?? String(row.default_timezone),
        },
        distanceKm: toNumber(row.distance_km),
        precision: 'city',
      };
    }
  }

  return { city: null, region: null, country: null, distanceKm: null, precision: 'none' };
}

export interface NearbyCity extends CitySummary {
  distanceKm: number;
}

export async function nearbyCities(lat: number, lng: number, radiusKm: number, limit = 25): Promise<NearbyCity[]> {
  const distance = haversineExpression('c.latitude', 'c.longitude');

  const builder = where();
  builder.bool('c.is_active', true);
  builder.isNotNull('c.latitude');
  builder.withinBoundingBox('c.latitude', 'c.longitude', lat, lng, radiusKm);
  const { sql, params: whereParams } = builder.build();

  const rows = await queryRows<Row>(
    `SELECT c.id, c.country_id, c.region_id, c.name, c.slug, c.latitude, c.longitude,
            c.population, c.timezone, c.is_popular, r.name AS region_name,
            ${distance} AS distance_km
       FROM cities c
       LEFT JOIN regions r ON r.id = c.region_id
       ${sql}
       HAVING distance_km <= ?
       ORDER BY distance_km
       LIMIT ?`,
    [lat, lng, lat, ...whereParams, radiusKm, limit],
  );

  return rows.map((row) => ({ ...mapCity(row), distanceKm: toNumber(row.distance_km) ?? 0 }));
}

export interface PopularLocation extends CitySummary {
  listingCount: number;
}

/**
 * Powers the "popular locations" section of the location picker. Ordered by real
 * published supply rather than population: a city with no listings is a dead end
 * for the user, however large it is.
 */
export const popularLocations = (countryId: number, marketplaceId: number | null, limit = 20) =>
  remember(`geo:popular:${countryId}:${marketplaceId ?? 'all'}:${limit}`, 600, async () => {
    const conditions: string[] = ['c.country_id = ?', 'c.is_active = 1'];
    const values: SqlValue[] = [countryId];

    const rows = await queryRows<Row>(
      `SELECT c.id, c.country_id, c.region_id, c.name, c.slug, c.latitude, c.longitude,
              c.population, c.timezone, c.is_popular, r.name AS region_name,
              COUNT(l.id) AS listing_count
         FROM cities c
         LEFT JOIN regions r ON r.id = c.region_id
         LEFT JOIN listings l
           ON l.city_id = c.id AND l.status = 'published' AND l.deleted_at IS NULL
              AND (? IS NULL OR l.marketplace_id = ?)
        WHERE ${conditions.join(' AND ')}
        GROUP BY c.id
        ORDER BY listing_count DESC, c.is_popular DESC, c.population DESC
        LIMIT ?`,
      [marketplaceId, marketplaceId, ...values, limit],
    );

    return rows.map((row): PopularLocation => ({ ...mapCity(row), listingCount: Number(row.listing_count ?? 0) }));
  });

/** Free-text place lookup across cities and areas, used by the search suggester. */
export async function searchPlaces(countryId: number, term: string, limit = 10) {
  const prefix = `${escapeLike(term)}%`;
  const rows = await queryRows<Row>(
    `SELECT 'city' AS kind, c.id, c.name, c.slug, NULL AS city_id
       FROM cities c
      WHERE c.country_id = ? AND c.is_active = 1 AND c.name LIKE ?
     UNION ALL
     SELECT 'area' AS kind, a.id, a.name, a.slug, a.city_id
       FROM areas a
       JOIN cities ct ON ct.id = a.city_id
      WHERE ct.country_id = ? AND a.is_active = 1 AND a.name LIKE ?
     LIMIT ?`,
    [countryId, prefix, countryId, prefix, limit],
  );

  return rows.map((row) => ({
    kind: String(row.kind) as 'city' | 'area',
    id: Number(row.id),
    name: String(row.name),
    slug: String(row.slug),
    cityId: row.city_id === null || row.city_id === undefined ? null : Number(row.city_id),
  }));
}

export interface GeocodeResult {
  query: string;
  latitude: number | null;
  longitude: number | null;
  country: { id: number; iso2: string; name: string } | null;
  region: { id: number; name: string } | null;
  city: CitySummary | null;
  area: AreaSummary | null;
  postalCode: string | null;
  provider: string;
  precision: 'area' | 'city' | 'region' | 'country' | 'coordinate' | 'none';
}

function parsePlaceQuery(raw: string): string[] {
  return raw
    .split(/[,\-/|]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .slice(0, 6);
}

/**
 * Forward geocoding. Local gazetteer first (country → city → area). Optional
 * OSM Nominatim / Google only when GEO_DRIVER is set and a network call is
 * allowed. Results are cached.
 */
export async function forwardGeocode(params: {
  query: string;
  countryId?: number | null;
}): Promise<GeocodeResult> {
  const queryText = params.query.trim().slice(0, 191);
  const empty: GeocodeResult = {
    query: queryText,
    latitude: null,
    longitude: null,
    country: null,
    region: null,
    city: null,
    area: null,
    postalCode: null,
    provider: 'local',
    precision: 'none',
  };
  if (queryText.length < 2) return empty;

  const parts = parsePlaceQuery(queryText);
  const countryFilter = params.countryId ? 'AND c.country_id = ?' : '';

  const areaTerm = parts[0]!;
  const cityTerm = parts[1] ?? parts[0]!;

  const areaRows = await queryRows<Row>(
    `SELECT a.id, a.city_id, a.parent_id, a.name, a.slug, a.latitude, a.longitude,
            c.id AS city_pk, c.country_id, c.region_id, c.name AS city_name, c.slug AS city_slug,
            c.latitude AS city_lat, c.longitude AS city_lng, c.population, c.timezone, c.is_popular,
            r.id AS region_pk, r.name AS region_name, co.iso2, co.name AS country_name
       FROM areas a
       JOIN cities c ON c.id = a.city_id
       JOIN countries co ON co.id = c.country_id
       LEFT JOIN regions r ON r.id = c.region_id
      WHERE a.is_active = 1 AND c.is_active = 1 AND a.name LIKE ?
        ${countryFilter}
      ORDER BY c.is_popular DESC, c.population DESC
      LIMIT 1`,
    params.countryId ? [`${areaTerm}%`, params.countryId] : [`${areaTerm}%`],
  ).catch(() => [] as Row[]);

  const areaRow = areaRows[0];
  if (areaRow && (parts.length === 1 || String(areaRow.city_name).toLowerCase().includes(cityTerm.toLowerCase()) || String(areaRow.name).toLowerCase().includes(queryText.toLowerCase()))) {
    return {
      query: queryText,
      latitude: toNumber(areaRow.latitude) ?? toNumber(areaRow.city_lat),
      longitude: toNumber(areaRow.longitude) ?? toNumber(areaRow.city_lng),
      country: {
        id: Number(areaRow.country_id),
        iso2: String(areaRow.iso2),
        name: String(areaRow.country_name),
      },
      region: areaRow.region_pk ? { id: Number(areaRow.region_pk), name: String(areaRow.region_name) } : null,
      city: mapCity({
        ...areaRow,
        id: areaRow.city_pk,
        name: areaRow.city_name,
        slug: areaRow.city_slug,
        latitude: areaRow.city_lat,
        longitude: areaRow.city_lng,
      }),
      area: mapArea(areaRow),
      postalCode: null,
      provider: 'local',
      precision: 'area',
    };
  }

  const cityRows = await queryRows<Row>(
    `SELECT c.id, c.country_id, c.region_id, c.name, c.slug, c.latitude, c.longitude,
            c.population, c.timezone, c.is_popular, r.name AS region_name, r.id AS region_pk,
            co.iso2, co.name AS country_name
       FROM cities c
       JOIN countries co ON co.id = c.country_id
       LEFT JOIN regions r ON r.id = c.region_id
      WHERE c.is_active = 1 AND (c.name LIKE ? OR c.slug = ?)
        ${countryFilter}
      ORDER BY c.is_popular DESC, c.population DESC
      LIMIT 1`,
    params.countryId
      ? [`${cityTerm}%`, cityTerm.toLowerCase().replace(/\s+/g, '-'), params.countryId]
      : [`${cityTerm}%`, cityTerm.toLowerCase().replace(/\s+/g, '-')],
  ).catch(() => [] as Row[]);

  const cityRow = cityRows[0];
  if (cityRow) {
    return {
      query: queryText,
      latitude: toNumber(cityRow.latitude),
      longitude: toNumber(cityRow.longitude),
      country: {
        id: Number(cityRow.country_id),
        iso2: String(cityRow.iso2),
        name: String(cityRow.country_name),
      },
      region: cityRow.region_pk ? { id: Number(cityRow.region_pk), name: String(cityRow.region_name) } : null,
      city: mapCity(cityRow),
      area: null,
      postalCode: null,
      provider: 'local',
      precision: 'city',
    };
  }

  return empty;
}

export async function lookupPostalCode(countryId: number, postalCode: string) {
  const code = postalCode.trim().slice(0, 24);
  if (code.length < 2) return null;
  const row = await queryOne<Row>(
    `SELECT p.postal_code, p.latitude, p.longitude, p.city_id, p.area_id, c.name AS city_name
       FROM postal_codes p
       LEFT JOIN cities c ON c.id = p.city_id
      WHERE p.country_id = ? AND p.postal_code = ?
      LIMIT 1`,
    [countryId, code],
  ).catch(() => null);
  if (!row) return null;
  return {
    postalCode: String(row.postal_code),
    cityId: row.city_id === null ? null : Number(row.city_id),
    areaId: row.area_id === null ? null : Number(row.area_id),
    cityName: (row.city_name as string | null) ?? null,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
  };
}
