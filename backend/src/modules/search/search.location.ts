import { queryRows, type Row } from '../../db/query';
import { remember } from '../../config/cache';
import type { SearchLocation } from './search.dsl';

const CITY_STOP = new Set([
  'the', 'a', 'an', 'for', 'and', 'or', 'to', 'of', 'in', 'near', 'with', 'under',
  'gold', 'house', 'car', 'rent', 'sale', 'automatic', 'manual',
]);

export async function resolveLocationName(
  name: string,
  countryId: number | null,
): Promise<SearchLocation | null> {
  const term = name.trim();
  if (term.length < 2 || term.length > 64) return null;

  const rows = await queryRows<Row>(
    `SELECT c.id, c.name, c.country_id, c.region_id, c.latitude, c.longitude, co.iso2, r.name AS region_name
       FROM cities c
       JOIN countries co ON co.id = c.country_id
       LEFT JOIN regions r ON r.id = c.region_id
      WHERE c.is_active = 1
        AND (c.name LIKE ? OR c.slug = ?)
        ${countryId ? 'AND c.country_id = ?' : ''}
      ORDER BY c.is_popular DESC, c.population DESC
      LIMIT 5`,
    countryId ? [`${term}%`, term.toLowerCase().replace(/\s+/g, '-'), countryId] : [`${term}%`, term.toLowerCase().replace(/\s+/g, '-')],
  );

  const row = rows[0];
  if (!row) {
    if (countryId) return resolveLocationName(term, null);
    return null;
  }

  return {
    cityId: Number(row.id),
    cityName: String(row.name),
    countryId: Number(row.country_id),
    regionId: row.region_id === null ? undefined : Number(row.region_id),
    regionName: (row.region_name as string | null) ?? undefined,
    countryCode: String(row.iso2),
    lat: row.latitude === null ? undefined : Number(row.latitude),
    lng: row.longitude === null ? undefined : Number(row.longitude),
  };
}

export async function listKnownCityNames(countryId: number | null): Promise<string[]> {
  return remember(`search:cities:${countryId ?? 'all'}`, 3600, async () => {
    const rows = await queryRows<Row>(
      countryId
        ? `SELECT name FROM cities WHERE is_active = 1 AND country_id = ? ORDER BY is_popular DESC, population DESC LIMIT 400`
        : `SELECT name FROM cities WHERE is_active = 1 ORDER BY is_popular DESC, population DESC LIMIT 400`,
      countryId ? [countryId] : [],
    );
    return rows.map((row) => String(row.name));
  });
}

export function extractCityHint(text: string, cities: string[]): string | null {
  const lower = text.toLowerCase();
  const scored = cities
    .filter((city) => city.length > 2 && !CITY_STOP.has(city.toLowerCase()))
    .filter((city) => lower.includes(city.toLowerCase()))
    .sort((a, b) => b.length - a.length);
  return scored[0] ?? null;
}

export async function resolveVehicleMakeId(name: string): Promise<number | null> {
  const rows = await queryRows<Row>(
    `SELECT id FROM vehicle_makes WHERE name = ? OR slug = ? LIMIT 1`,
    [name, name.toLowerCase().replace(/\s+/g, '-')],
  ).catch(() => [] as Row[]);
  return rows[0] ? Number(rows[0].id) : null;
}

export async function resolveVehicleModelId(makeId: number | null, name: string): Promise<number | null> {
  const rows = await queryRows<Row>(
    makeId
      ? `SELECT id FROM vehicle_models WHERE make_id = ? AND (name = ? OR slug = ?) LIMIT 1`
      : `SELECT id FROM vehicle_models WHERE name = ? OR slug = ? LIMIT 1`,
    makeId ? [makeId, name, name.toLowerCase().replace(/\s+/g, '-')] : [name, name.toLowerCase().replace(/\s+/g, '-')],
  ).catch(() => [] as Row[]);
  return rows[0] ? Number(rows[0].id) : null;
}

export async function resolveCategory(marketplaceId: number, hint: string): Promise<{ id: number; code: string } | null> {
  const rows = await queryRows<Row>(
    `SELECT id, code FROM categories
      WHERE marketplace_id = ? AND is_active = 1 AND (code = ? OR slug = ? OR name LIKE ?)
      LIMIT 1`,
    [marketplaceId, hint, hint, `%${hint}%`],
  ).catch(() => [] as Row[]);
  return rows[0] ? { id: Number(rows[0].id), code: String(rows[0].code) } : null;
}
