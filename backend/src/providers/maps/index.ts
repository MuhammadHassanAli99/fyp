import { queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { remember } from '../../config/cache';
import { env } from '../../config/env';
import { haversineMeters } from '../../modules/geo/distance';

export interface MapBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface MapMarker {
  listingId: number;
  latitude: number;
  longitude: number;
  title: string;
  approximate: boolean;
  marketplace?: string;
  price?: number | null;
  currency?: string | null;
}

export interface MapCapabilities {
  map: boolean;
  satellite: boolean;
  hybrid: boolean;
  streetView: boolean;
  directions: boolean;
  places: boolean;
  geocoding: boolean;
  reverseGeocoding: boolean;
  distance: boolean;
  radiusSearch: boolean;
}

export const ALL_PLATFORMS = ['android', 'ios', 'web', 'windows', 'macos', 'linux'] as const;
export type ClientPlatform = (typeof ALL_PLATFORMS)[number];

export interface MapProvider {
  readonly code: string;
  readonly name: string;
  readonly tileUrl: string | null;
  readonly satelliteTileUrl: string | null;
  readonly hybridTileUrl: string | null;
  readonly attribution: string;
  readonly platforms: readonly string[];
  readonly capabilities: MapCapabilities;
  approximate(lat: number, lng: number, listingId: number): { latitude: number; longitude: number };
  distanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number;
  directionsUrl(destination: { lat: number; lng: number }, origin?: { lat: number; lng: number }): string | null;
  streetViewUrl(point: { lat: number; lng: number }): string | null;
}

const OSM_CAPABILITIES: MapCapabilities = {
  map: true,
  satellite: true,
  hybrid: true,
  streetView: false,
  directions: true,
  places: true,
  geocoding: true,
  reverseGeocoding: true,
  distance: true,
  radiusSearch: true,
};

function jitter(lat: number, lng: number, salt: number): { latitude: number; longitude: number } {
  const offsetLat = (((salt % 17) - 8) || 3) * 0.0018;
  const offsetLng = (((salt % 13) - 6) || -4) * 0.0018;
  return { latitude: Number((lat + offsetLat).toFixed(5)), longitude: Number((lng + offsetLng).toFixed(5)) };
}

class OpenStreetMapProvider implements MapProvider {
  readonly code = 'openstreetmap';
  readonly name = 'OpenStreetMap';
  readonly tileUrl = env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  readonly satelliteTileUrl =
    env.MAP_SATELLITE_TILE_URL ||
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  readonly hybridTileUrl =
    env.MAP_SATELLITE_TILE_URL ||
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  readonly attribution = '© OpenStreetMap contributors. Satellite © Esri.';
  readonly platforms = ALL_PLATFORMS;
  readonly capabilities = OSM_CAPABILITIES;
  approximate(lat: number, lng: number, listingId: number) {
    return jitter(lat, lng, listingId);
  }
  distanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
    return haversineMeters(from, to) / 1000;
  }
  directionsUrl(destination: { lat: number; lng: number }, origin?: { lat: number; lng: number }) {
    const from = origin ? `${origin.lat}/${origin.lng}` : '';
    return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${from};${destination.lat}%2C${destination.lng}`;
  }
  streetViewUrl() {
    return null;
  }
}

class GoogleMapsProvider implements MapProvider {
  readonly code = 'google';
  readonly name = 'Google Maps';
  readonly tileUrl = null;
  readonly satelliteTileUrl = null;
  readonly hybridTileUrl = null;
  readonly attribution = '© Google';
  readonly platforms = ['android', 'ios', 'web'] as const;
  readonly capabilities: MapCapabilities = {
    ...OSM_CAPABILITIES,
    streetView: true,
    map: true,
  };
  approximate(lat: number, lng: number, listingId: number) {
    return jitter(lat, lng, listingId);
  }
  distanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
    return haversineMeters(from, to) / 1000;
  }
  directionsUrl(destination: { lat: number; lng: number }, origin?: { lat: number; lng: number }) {
    const dest = `${destination.lat},${destination.lng}`;
    const originQs = origin ? `&origin=${origin.lat},${origin.lng}` : '';
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}${originQs}`;
  }
  streetViewUrl(point: { lat: number; lng: number }) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${point.lat},${point.lng}`;
  }
}

class AppleMapsProvider implements MapProvider {
  readonly code = 'apple';
  readonly name = 'Apple Maps';
  readonly tileUrl = null;
  readonly satelliteTileUrl = null;
  readonly hybridTileUrl = null;
  readonly attribution = '© Apple';
  readonly platforms = ['ios', 'macos'] as const;
  readonly capabilities: MapCapabilities = {
    ...OSM_CAPABILITIES,
    streetView: false,
  };
  approximate(lat: number, lng: number, listingId: number) {
    return jitter(lat, lng, listingId);
  }
  distanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
    return haversineMeters(from, to) / 1000;
  }
  directionsUrl(destination: { lat: number; lng: number }, origin?: { lat: number; lng: number }) {
    const daddr = `${destination.lat},${destination.lng}`;
    const saddr = origin ? `&saddr=${origin.lat},${origin.lng}` : '';
    return `https://maps.apple.com/?daddr=${encodeURIComponent(daddr)}${saddr}`;
  }
  streetViewUrl() {
    return null;
  }
}

const PROVIDERS: Record<string, MapProvider> = {
  openstreetmap: new OpenStreetMapProvider(),
  google: new GoogleMapsProvider(),
  apple: new AppleMapsProvider(),
};

let active: MapProvider = PROVIDERS[env.MAP_PROVIDER] ?? PROVIDERS.openstreetmap!;

export function getMapProvider(): MapProvider {
  return active;
}

export function setMapProvider(provider: MapProvider | string): void {
  if (typeof provider === 'string') {
    active = PROVIDERS[provider] ?? PROVIDERS.openstreetmap!;
    return;
  }
  active = provider;
}

export function getMapProviderByCode(code: string | undefined | null): MapProvider {
  if (code && PROVIDERS[code]) return PROVIDERS[code]!;
  return active;
}

export function capabilitiesFor(provider: MapProvider, platform: string | null): MapCapabilities {
  const supported = !platform || provider.platforms.includes(platform);
  if (supported) return provider.capabilities;
  return {
    map: false,
    satellite: false,
    hybrid: false,
    streetView: false,
    directions: false,
    places: false,
    geocoding: false,
    reverseGeocoding: false,
    distance: false,
    radiusSearch: false,
  };
}

export async function listMapProviders(platform?: string | null) {
  return remember(`maps:providers:${platform ?? 'all'}`, 3600, async () => {
    const rows = await queryRows<Row>(
      `SELECT code, name, is_default, is_active, capabilities, tile_url, satellite_tile_url, hybrid_tile_url,
              attribution, platforms, config
         FROM map_providers WHERE is_active = 1 ORDER BY is_default DESC, name`,
    ).catch(() => [] as Row[]);

    const fallback = Object.values(PROVIDERS).map((provider) => ({
      code: provider.code,
      name: provider.name,
      tileUrl: provider.tileUrl,
      satelliteTileUrl: provider.satelliteTileUrl,
      hybridTileUrl: provider.hybridTileUrl,
      attribution: provider.attribution,
      platforms: [...provider.platforms],
      capabilities: capabilitiesFor(provider, platform ?? null),
      isDefault: provider.code === active.code,
    }));

    if (rows.length === 0) {
      return fallback.filter((item) => !platform || item.platforms.includes(platform) || item.code === 'openstreetmap');
    }

    return rows
      .map((row) => {
        const impl = PROVIDERS[String(row.code)] ?? PROVIDERS.openstreetmap!;
        const platforms = Array.isArray(row.platforms) ? (row.platforms as string[]) : [...impl.platforms];
        const storedCaps = (row.capabilities ?? {}) as Partial<MapCapabilities>;
        const capabilities = capabilitiesFor(
          {
            code: impl.code,
            name: impl.name,
            tileUrl: impl.tileUrl,
            satelliteTileUrl: impl.satelliteTileUrl,
            hybridTileUrl: impl.hybridTileUrl,
            attribution: impl.attribution,
            platforms,
            capabilities: { ...impl.capabilities, ...storedCaps },
            approximate: impl.approximate.bind(impl),
            distanceKm: impl.distanceKm.bind(impl),
            directionsUrl: impl.directionsUrl.bind(impl),
            streetViewUrl: impl.streetViewUrl.bind(impl),
          },
          platform ?? null,
        );
        return {
          code: String(row.code),
          name: String(row.name),
          tileUrl: (row.tile_url as string | null) ?? impl.tileUrl,
          satelliteTileUrl: (row.satellite_tile_url as string | null) ?? impl.satelliteTileUrl,
          hybridTileUrl: (row.hybrid_tile_url as string | null) ?? impl.hybridTileUrl,
          attribution: (row.attribution as string | null) ?? impl.attribution,
          platforms,
          capabilities,
          isDefault: Number(row.is_default) === 1 || String(row.code) === active.code,
        };
      })
      .filter((item) => !platform || item.platforms.includes(platform) || item.code === 'openstreetmap');
  });
}

export async function markersInBounds(bounds: MapBounds, limit = 200): Promise<MapMarker[]> {
  const rows = await queryRows<Row>(
    `SELECT l.id, l.title, l.latitude, l.longitude, l.hide_exact_location, l.price, l.currency, m.code AS marketplace_code,
            pd.public_latitude, pd.public_longitude, pd.location_privacy
       FROM listings l
       JOIN marketplaces m ON m.id = l.marketplace_id
       LEFT JOIN property_listing_details pd ON pd.listing_id = l.id
      WHERE l.marketplace_id = 2
        AND l.status = 'published'
        AND l.deleted_at IS NULL
        AND l.latitude BETWEEN ? AND ?
        AND l.longitude BETWEEN ? AND ?
      LIMIT ?`,
    [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng, limit],
  );

  const provider = getMapProvider();
  const markers: Array<MapMarker | null> = rows.map((row) => {
      const hide = Number(row.hide_exact_location) === 1 || String(row.location_privacy ?? '') === 'private';
      const exactLat = toNumber(row.latitude);
      const exactLng = toNumber(row.longitude);
      if (exactLat === null || exactLng === null) return null;
      const publicLat = toNumber(row.public_latitude);
      const publicLng = toNumber(row.public_longitude);
      const approx =
        hide && publicLat !== null && publicLng !== null
          ? { latitude: publicLat, longitude: publicLng }
          : hide
            ? provider.approximate(exactLat, exactLng, Number(row.id))
            : { latitude: exactLat, longitude: exactLng };
      return {
        listingId: Number(row.id),
        latitude: approx.latitude,
        longitude: approx.longitude,
        title: String(row.title),
        approximate: hide,
        marketplace: String(row.marketplace_code),
        price: toNumber(row.price),
        currency: (row.currency as string | null) ?? null,
      };
    });
  return markers.filter((marker): marker is MapMarker => marker !== null);
}
