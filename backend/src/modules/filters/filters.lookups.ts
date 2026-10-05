import { queryRows, type Row } from '../../db/query';
import { listRegions, listCities, listAreas } from '../geo/geo.service';
import { listMakes, listModels, listVariants } from '../../marketplaces/vehicles/vehicles.service';
import { listBrands } from '../catalog/catalog.service';
import type { FilterLookupItem } from './filters.types';

const MAX_LOOKUP = 80;

function named(rows: Array<{ id?: number; code?: string | null; name: string; slug?: string | null }>): FilterLookupItem[] {
  return rows.slice(0, MAX_LOOKUP).map((row) => ({
    value: String(row.id ?? row.code ?? row.slug ?? row.name),
    label: row.name,
  }));
}

export async function lookupFilterValues(params: {
  key: string;
  marketplace?: string | null;
  parentKey?: string | null;
  parentValue?: string | null;
  q?: string | null;
  countryId?: number | null;
}): Promise<FilterLookupItem[]> {
  const key = params.key;
  const parent = params.parentValue?.trim() || null;
  const q = params.q?.trim() || null;

  try {
    if (key === 'countryId') {
      const rows = await queryRows<Row>(
        `SELECT id, name FROM countries WHERE is_active = 1
          ${q ? 'AND name LIKE ?' : ''}
         ORDER BY name LIMIT ?`,
        q ? [`${q}%`, MAX_LOOKUP] : [MAX_LOOKUP],
      ).catch(() => [] as Row[]);
      return rows.map((row) => ({ value: String(row.id), label: String(row.name) }));
    }
    if (key === 'regionId' && params.countryId) {
      const rows = await listRegions(params.countryId);
      return named(rows).filter((item) => !q || item.label.toLowerCase().startsWith(q.toLowerCase()));
    }
    if (key === 'cityId' && params.countryId) {
      const regionId = params.parentKey === 'regionId' && parent ? Number(parent) : undefined;
      const rows = await listCities({
        countryId: params.countryId,
        regionId: Number.isFinite(regionId) ? regionId : null,
        search: q,
        limit: MAX_LOOKUP,
      });
      return named(rows);
    }
    if (key === 'areaId' && parent && (params.parentKey === 'cityId' || !params.parentKey)) {
      const cityId = Number(parent);
      if (!Number.isFinite(cityId)) return [];
      const rows = await listAreas(cityId, q);
      return named(rows);
    }
    if (key === 'makeId') {
      const vehicleType = params.parentKey === 'vehicleType' ? parent : null;
      const rows = await listMakes({ vehicleType, popularOnly: false });
      return named(rows).filter((item) => !q || item.label.toLowerCase().includes(q.toLowerCase()));
    }
    if (key === 'modelId' && parent) {
      const makeId = Number(parent);
      if (!Number.isFinite(makeId)) return [];
      const rows = await listModels(makeId);
      return named(rows).filter((item) => !q || item.label.toLowerCase().includes(q.toLowerCase()));
    }
    if (key === 'variantId' && parent) {
      const modelId = Number(parent);
      if (!Number.isFinite(modelId)) return [];
      const rows = await listVariants(modelId);
      return named(rows).filter((item) => !q || item.label.toLowerCase().includes(q.toLowerCase()));
    }
    if (key === 'brandId') {
      const marketplaceId = params.marketplace === 'gold' ? 1 : params.marketplace === 'property' ? 2 : 3;
      const rows = await listBrands(marketplaceId);
      return rows
        .map((row) => ({
          value: String((row as { id?: number }).id ?? (row as { code?: string }).code ?? ''),
          label: String((row as { name?: string }).name ?? (row as { code?: string }).code ?? ''),
        }))
        .filter((item) => item.value && (!q || item.label.toLowerCase().includes(q.toLowerCase())))
        .slice(0, MAX_LOOKUP);
    }
    if (key === 'partCategory') {
      const rows = await queryRows<Row>(
        `SELECT code, name FROM vehicle_part_categories WHERE is_active = 1 ORDER BY sort_order, name LIMIT ?`,
        [MAX_LOOKUP],
      ).catch(() => [] as Row[]);
      return rows
        .map((row) => ({ value: String(row.code), label: String(row.name ?? row.code) }))
        .filter((item) => !q || item.label.toLowerCase().includes(q.toLowerCase()));
    }
    if (key === 'partBrand') {
      const rows = await queryRows<Row>(
        `SELECT DISTINCT brand AS name FROM vehicle_parts
          WHERE deleted_at IS NULL AND brand IS NOT NULL AND brand <> ''
          ${q ? 'AND brand LIKE ?' : ''}
          ORDER BY brand LIMIT ?`,
        q ? [`${q}%`, MAX_LOOKUP] : [MAX_LOOKUP],
      ).catch(() => [] as Row[]);
      return rows.map((row) => ({ value: String(row.name), label: String(row.name) }));
    }
    if (key === 'category') {
      const code = params.marketplace === 'gold' || params.marketplace === 'property' || params.marketplace === 'vehicles'
        ? params.marketplace
        : null;
      if (!code) return [];
      const rows = await queryRows<Row>(
        `SELECT c.id, c.code, c.name FROM categories c
           JOIN marketplaces m ON m.id = c.marketplace_id
          WHERE m.code = ? AND c.is_active = 1 AND c.parent_id IS NULL
            ${q ? 'AND c.name LIKE ?' : ''}
          ORDER BY c.sort_order, c.name LIMIT ?`,
        q ? [code, `${q}%`, MAX_LOOKUP] : [code, MAX_LOOKUP],
      ).catch(() => [] as Row[]);
      return rows.map((row) => ({ value: String(row.code), label: String(row.name), extra: { id: Number(row.id) } }));
    }
    if (key === 'subcategory' && parent) {
      const rows = await queryRows<Row>(
        `SELECT child.id, child.code, child.name
           FROM categories child
           JOIN categories parent ON parent.id = child.parent_id
          WHERE parent.code = ? AND child.is_active = 1
            ${q ? 'AND child.name LIKE ?' : ''}
          ORDER BY child.sort_order, child.name LIMIT ?`,
        q ? [parent, `${q}%`, MAX_LOOKUP] : [parent, MAX_LOOKUP],
      ).catch(() => [] as Row[]);
      return rows.map((row) => ({ value: String(row.code), label: String(row.name), parentValue: parent }));
    }
  } catch {
    return [];
  }
  return [];
}
