import { queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { remember } from '../../config/cache';
import { env } from '../../config/env';
import type { SearchQuery } from '../search/search.dsl';
import { validateSearchQuery, emptySearchQuery } from '../search/search.dsl';
import { filterStateToSearchDsl, filterStateFromQueryParams } from '../filters/filters.state';
import { computeFacets } from '../filters/filters.facets';
import {
  capabilitiesFor,
  getMapProvider,
  getMapProviderByCode,
  listMapProviders,
  type ClientPlatform,
  type MapBounds,
} from '../../providers/maps';
import { decodeGeohashCenter, geohashPrecisionForZoom } from '../geo/geohash';
import { formatDistance, haversineMeters, preferredDistanceUnit, type DistanceUnit } from '../geo/distance';
import { sha256 } from '../../core/security/crypto';

const MARKER_LIMIT = 200;
const CLUSTER_THRESHOLD = 40;

export interface MapSearchInput {
  marketplace?: string | null;
  dsl?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  bounds?: MapBounds;
  zoom?: number;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  provider?: string;
  platform?: string;
  style?: 'standard' | 'satellite' | 'hybrid';
}

export interface ClusterMarker {
  kind: 'cluster';
  id: string;
  latitude: number;
  longitude: number;
  count: number;
  geohash: string;
}

export interface ListingMapMarker {
  kind: 'listing';
  listingId: number;
  latitude: number;
  longitude: number;
  title: string;
  approximate: boolean;
  marketplace: string;
  price: number | null;
  currency: string | null;
  categoryCode: string | null;
  attributes: Record<string, unknown>;
}

function marketplaceId(code: string | null | undefined): number | null {
  if (code === 'gold') return 1;
  if (code === 'property') return 2;
  if (code === 'vehicles') return 3;
  return null;
}

function boundsFromRadius(lat: number, lng: number, radiusKm: number): MapBounds {
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

function publicPoint(
  listingId: number,
  lat: number,
  lng: number,
  hide: boolean,
): { latitude: number; longitude: number; approximate: boolean } {
  if (!hide) return { latitude: lat, longitude: lng, approximate: false };
  const approx = getMapProvider().approximate(lat, lng, listingId);
  return { ...approx, approximate: true };
}

export async function describeMap(params: { provider?: string; platform?: string | null }) {
  const provider = getMapProviderByCode(params.provider);
  const platform = (params.platform as ClientPlatform | null) ?? null;
  const capabilities = capabilitiesFor(provider, platform);
  const providers = await listMapProviders(platform);
  const styleOptions: Array<'standard' | 'satellite' | 'hybrid'> = ['standard'];
  if (capabilities.satellite) styleOptions.push('satellite');
  if (capabilities.hybrid) styleOptions.push('hybrid');
  return {
    provider: {
      code: provider.code,
      name: provider.name,
      tileUrl: capabilities.map ? provider.tileUrl : null,
      satelliteTileUrl: capabilities.satellite ? provider.satelliteTileUrl : null,
      hybridTileUrl: capabilities.hybrid ? provider.hybridTileUrl : null,
      attribution: provider.attribution,
      platforms: provider.platforms,
    },
    capabilities,
    styleOptions,
    providers,
    streetViewDisclaimer:
      'Street View is historical street imagery. It does not prove a property\'s current condition.',
  };
}

export async function searchMap(
  input: MapSearchInput,
  context: { currency: string; language: string; countryCode?: string; countryId: number | null },
) {
  const marketplace =
    input.marketplace === 'gold' || input.marketplace === 'property' || input.marketplace === 'vehicles'
      ? input.marketplace
      : null;
  const fromFilters = input.filters
    ? filterStateToSearchDsl(filterStateFromQueryParams(input.filters, { marketplace, currency: context.currency }), context)
    : null;
  const dsl = validateSearchQuery(
    {
      ...emptySearchQuery(),
      ...(fromFilters ?? {}),
      ...(input.dsl ?? {}),
      marketplace: marketplace ?? fromFilters?.marketplace ?? null,
      location: {
        ...(fromFilters?.location ?? {}),
        lat: input.lat ?? (input.dsl?.location as { lat?: number } | undefined)?.lat,
        lng: input.lng ?? (input.dsl?.location as { lng?: number } | undefined)?.lng,
        radiusKm: input.radiusKm,
      },
    },
    context,
  );

  const bounds =
    input.bounds ??
    (input.lat !== undefined && input.lng !== undefined
      ? boundsFromRadius(input.lat, input.lng, input.radiusKm ?? dsl.location?.radiusKm ?? 25)
      : null);
  const zoom = Math.min(18, Math.max(1, input.zoom ?? 11));
  const precision = geohashPrecisionForZoom(zoom);
  const mpId = marketplaceId(dsl.marketplace);

  if (!bounds) {
    return { dsl, items: [] as Array<ClusterMarker | ListingMapMarker>, total: 0, clustered: false, facets: [] };
  }

  const params: Array<string | number> = [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng];
  const where = [
    'i.latitude IS NOT NULL',
    'i.longitude IS NOT NULL',
    'i.latitude BETWEEN ? AND ?',
    'i.longitude BETWEEN ? AND ?',
    `(i.lifecycle_status = 'published' OR i.lifecycle_status IS NULL)`,
  ];
  if (mpId) {
    where.push('i.marketplace_id = ?');
    params.push(mpId);
  }
  if (dsl.operation) {
    where.push('i.operation = ?');
    params.push(dsl.operation);
  }
  if (dsl.category) {
    where.push('i.category_code = ?');
    params.push(dsl.category);
  }
  if (dsl.price?.minBase !== undefined) {
    where.push('i.price_base >= ?');
    params.push(dsl.price.minBase);
  }
  if (dsl.price?.maxBase !== undefined) {
    where.push('i.price_base <= ?');
    params.push(dsl.price.maxBase);
  }

  const countRow = await queryRows<Row>(
    `SELECT COUNT(*) AS total FROM listing_search_index i WHERE ${where.join(' AND ')}`,
    params,
  ).catch(() => [{ total: 0 } as Row]);
  const total = Number(countRow[0]?.total ?? 0);
  const clustered = zoom < 14 && total > CLUSTER_THRESHOLD;

  if (clustered) {
    const clusters = await queryRows<Row>(
      `SELECT LEFT(i.geohash, ?) AS cell, COUNT(*) AS cnt, AVG(i.latitude) AS lat, AVG(i.longitude) AS lng
         FROM listing_search_index i
        WHERE ${where.join(' AND ')} AND i.geohash IS NOT NULL
        GROUP BY cell
        ORDER BY cnt DESC
        LIMIT ?`,
      [precision, ...params, MARKER_LIMIT],
    ).catch(() => [] as Row[]);
    const items: ClusterMarker[] = clusters.map((row) => {
      const geohash = String(row.cell ?? '');
      const center = geohash ? decodeGeohashCenter(geohash) : { lat: Number(row.lat), lng: Number(row.lng) };
      return {
        kind: 'cluster',
        id: geohash || sha256(`${row.lat}:${row.lng}`).slice(0, 12),
        latitude: toNumber(row.lat) ?? center.lat,
        longitude: toNumber(row.lng) ?? center.lng,
        count: Number(row.cnt ?? 0),
        geohash,
      };
    });
    const facets = await computeFacets(dsl).catch(() => []);
    return { dsl, items, total, clustered: true, facets };
  }

  const rows = await queryRows<Row>(
    `SELECT i.listing_id, i.title, i.latitude, i.longitude, i.hide_exact_location, i.price, i.currency,
            i.marketplace_code, i.category_code, i.attributes
       FROM listing_search_index i
      WHERE ${where.join(' AND ')}
      ORDER BY i.search_rank DESC, i.listing_id DESC
      LIMIT ?`,
    [...params, MARKER_LIMIT],
  ).catch(() => [] as Row[]);

  const items: ListingMapMarker[] = rows
    .map((row) => {
      const lat = toNumber(row.latitude);
      const lng = toNumber(row.longitude);
      if (lat === null || lng === null) return null;
      const hide = Number(row.hide_exact_location) === 1;
      const point = publicPoint(Number(row.listing_id), lat, lng, hide);
      let attributes: Record<string, unknown> = {};
      if (row.attributes && typeof row.attributes === 'object') {
        attributes = row.attributes as Record<string, unknown>;
      } else if (typeof row.attributes === 'string') {
        try {
          attributes = JSON.parse(row.attributes) as Record<string, unknown>;
        } catch {
          attributes = {};
        }
      }
      return {
        kind: 'listing' as const,
        listingId: Number(row.listing_id),
        latitude: point.latitude,
        longitude: point.longitude,
        title: String(row.title),
        approximate: point.approximate,
        marketplace: String(row.marketplace_code),
        price: toNumber(row.price),
        currency: (row.currency as string | null) ?? null,
        categoryCode: (row.category_code as string | null) ?? null,
        attributes,
      };
    })
    .filter((item): item is ListingMapMarker => item !== null);

  const facets = await computeFacets(dsl).catch(() => []);
  return { dsl, items, total, clustered: false, facets };
}

export function directionsFor(input: {
  destination: { lat: number; lng: number };
  origin?: { lat: number; lng: number };
  provider?: string;
  platform?: string | null;
}) {
  const provider = getMapProviderByCode(input.provider);
  const capabilities = capabilitiesFor(provider, input.platform ?? null);
  if (!capabilities.directions) {
    return { supported: false, url: null, provider: provider.code };
  }
  return {
    supported: true,
    url: provider.directionsUrl(input.destination, input.origin),
    provider: provider.code,
  };
}

export function streetViewFor(input: { lat: number; lng: number; provider?: string; platform?: string | null }) {
  const provider = getMapProviderByCode(input.provider);
  const capabilities = capabilitiesFor(provider, input.platform ?? null);
  if (!capabilities.streetView) {
    return {
      supported: false,
      url: null,
      provider: provider.code,
      disclaimer: 'Street View is not available for this provider or platform.',
    };
  }
  return {
    supported: true,
    url: provider.streetViewUrl({ lat: input.lat, lng: input.lng }),
    provider: provider.code,
    disclaimer: 'Street View is historical street imagery. It does not prove current property condition.',
  };
}

export function distanceBetween(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  unit?: DistanceUnit,
) {
  const meters = haversineMeters(from, to);
  return formatDistance(meters, unit ?? 'km');
}

const POI_TYPES = [
  'school',
  'hospital',
  'shopping',
  'transport',
  'restaurant',
  'bank',
  'mosque',
  'park',
] as const;

export async function nearbyPlaces(params: {
  lat: number;
  lng: number;
  radiusM?: number;
  types?: string[];
  listingId?: number;
  countryId?: number | null;
}) {
  const radiusM = Math.min(10_000, Math.max(200, params.radiusM ?? 1500));
  const types = (params.types?.length ? params.types : [...POI_TYPES]).slice(0, 12);
  const cacheKey = `places:${params.lat.toFixed(3)}:${params.lng.toFixed(3)}:${radiusM}:${types.join(',')}`;
  return remember(cacheKey, 600, async () => {
    const fromListing = params.listingId
      ? await queryRows<Row>(
          `SELECT place_type, name, distance_m FROM property_nearby_places WHERE listing_id = ?`,
          [params.listingId],
        ).catch(() => [] as Row[])
      : [];

    const radiusKm = radiusM / 1000;
    const stored = await queryRows<Row>(
      `SELECT id, place_type, name, latitude, longitude, city_id
         FROM places
        WHERE is_active = 1
          AND latitude BETWEEN ? AND ?
          AND longitude BETWEEN ? AND ?
          AND place_type IN (${types.map(() => '?').join(',')})
        LIMIT 80`,
      [
        params.lat - radiusKm / 111.32,
        params.lat + radiusKm / 111.32,
        params.lng - radiusKm / (111.32 * Math.max(Math.cos((params.lat * Math.PI) / 180), 0.01)),
        params.lng + radiusKm / (111.32 * Math.max(Math.cos((params.lat * Math.PI) / 180), 0.01)),
        ...types,
      ],
    ).catch(() => [] as Row[]);

    const items = [
      ...fromListing.map((row) => ({
        id: `listing:${params.listingId}:${row.place_type}:${row.name}`,
        type: String(row.place_type),
        name: (row.name as string | null) ?? String(row.place_type),
        latitude: params.lat,
        longitude: params.lng,
        distance: formatDistance(Number(row.distance_m ?? 0), 'm'),
        source: 'listing' as const,
      })),
      ...stored.map((row) => {
        const lat = Number(row.latitude);
        const lng = Number(row.longitude);
        const meters = haversineMeters({ lat: params.lat, lng: params.lng }, { lat, lng });
        return {
          id: String(row.id),
          type: String(row.place_type),
          name: String(row.name),
          latitude: lat,
          longitude: lng,
          distance: formatDistance(meters, preferredDistanceUnit({})),
          source: 'places' as const,
        };
      }),
    ]
      .filter((item) => item.distance.meters <= radiusM)
      .sort((a, b) => a.distance.meters - b.distance.meters)
      .slice(0, 40);

    return { items, types, radiusM, provider: env.GEO_DRIVER };
  });
}

export { listMapProviders };
