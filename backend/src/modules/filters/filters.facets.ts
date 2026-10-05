import { queryRows, type Row } from '../../db/query';
import { where, type SqlValue } from '../../db/sql';
import type { SearchQuery } from '../search/search.dsl';
import type { FacetGroup } from './filters.types';
import { definitionByKey } from './filters.definitions';

const FACET_KEYS: Record<string, string[]> = {
  gold: ['karat', 'form', 'certified', 'hallmarked'],
  property: ['propertyKind', 'bedrooms', 'furnishing', 'usageType'],
  vehicles: ['make', 'model', 'transmission', 'fuelType', 'bodyType', 'year'],
  parts: ['partCategory', 'partBrand', 'condition'],
};

const JSON_PATH: Record<string, string> = {
  karat: '$.karat',
  form: '$.form',
  certified: '$.certified',
  hallmarked: '$.hallmarked',
  propertyKind: '$.propertyKind',
  bedrooms: '$.bedrooms',
  furnishing: '$.furnishing',
  usageType: '$.usageType',
  make: '$.make',
  model: '$.model',
  transmission: '$.transmission',
  fuelType: '$.fuelType',
  bodyType: '$.bodyType',
  year: '$.year',
  partCategory: '$.partCategory',
  partBrand: '$.partBrand',
  condition: '$.condition',
};

function marketplaceId(code: string | null): number | null {
  if (code === 'gold') return 1;
  if (code === 'property') return 2;
  if (code === 'vehicles') return 3;
  return null;
}

function contextWhere(dsl: SearchQuery, excludeKey?: string): { sql: string; params: SqlValue[] } {
  const builder = where();
  builder.eq('i.marketplace_id', marketplaceId(dsl.marketplace));
  builder.raw(`(i.lifecycle_status = 'published' OR i.lifecycle_status IS NULL)`);
  if (dsl.operation) builder.eq('i.operation', dsl.operation);
  if (dsl.location?.countryId) builder.eq('i.country_id', dsl.location.countryId);
  if (dsl.location?.cityId) builder.eq('i.city_id', dsl.location.cityId);
  if (dsl.location?.areaId) builder.eq('i.area_id', dsl.location.areaId);
  if (dsl.price?.minBase !== undefined) builder.gte('i.price_base', dsl.price.minBase);
  if (dsl.price?.maxBase !== undefined) builder.lte('i.price_base', dsl.price.maxBase);
  if (dsl.availability) builder.eq('i.availability', dsl.availability);
  if (dsl.category) builder.eq('i.category_code', dsl.category);
  void excludeKey;
  return builder.build();
}

function labelFor(key: string, value: string): string {
  const definition = definitionByKey(key);
  const option = definition?.allowedValues.find((item) => item.value === value);
  return option?.label ?? value.replace(/_/g, ' ');
}

/**
 * Facet counts for the current Search DSL. Each group is counted against the
 * same geo/price/marketplace context. Unknown JSON paths are skipped.
 */
export async function computeFacets(dsl: SearchQuery): Promise<FacetGroup[]> {
  const marketplace = dsl.intent === 'parts' ? 'parts' : dsl.marketplace;
  if (!marketplace || marketplace === null) return [];
  const keys = FACET_KEYS[marketplace] ?? [];
  const groups: FacetGroup[] = [];

  for (const key of keys) {
    const path = JSON_PATH[key];
    if (!path) continue;
    const { sql, params } = contextWhere(dsl, key);
    try {
      const rows = await queryRows<Row>(
        `SELECT JSON_UNQUOTE(JSON_EXTRACT(i.attributes, ?)) AS facet_value, COUNT(*) AS facet_count
           FROM listing_search_index i
           ${sql}
            AND JSON_EXTRACT(i.attributes, ?) IS NOT NULL
            AND JSON_UNQUOTE(JSON_EXTRACT(i.attributes, ?)) <> ''
          GROUP BY facet_value
          ORDER BY facet_count DESC
          LIMIT 20`,
        [path, ...params, path, path],
      );
      const buckets = rows
        .map((row) => {
          const value = String(row.facet_value ?? '');
          if (!value || value === 'null') return null;
          return { value, label: labelFor(key, value), count: Number(row.facet_count ?? 0) };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
      if (buckets.length > 0) {
        groups.push({
          key,
          label: definitionByKey(key, marketplace)?.label ?? key,
          buckets,
        });
      }
    } catch {
      continue;
    }
  }
  return groups;
}
