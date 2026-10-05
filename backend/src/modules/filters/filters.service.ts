import { remember } from '../../config/cache';
import { queryRows, type Row } from '../../db/query';
import { definitionsFor, builtInFilterDefinitions } from './filters.definitions';
import { validateFilterState, visibleDefinitions } from './filters.validate';
import { filterStateToSearchDsl, publicQueryParams } from './filters.state';
import { lookupFilterValues } from './filters.lookups';
import { computeFacets } from './filters.facets';
import type { FilterDefinition } from './filters.types';

export async function listFilterDefinitions(params: {
  marketplace?: string | null;
  category?: string | null;
  subcategory?: string | null;
}): Promise<FilterDefinition[]> {
  const builtIn = definitionsFor(params);
  const overrides = await remember(
    `filters:db:${params.marketplace ?? 'all'}:${params.category ?? ''}:${params.subcategory ?? ''}`,
    300,
    async () => {
      const rows = await queryRows<Row>(
        `SELECT filter_key, marketplace_code, category_code, subcategory_code, label, filter_type,
                data_source, allowed_values, min_value, max_value, step_value, unit, currency,
                depends_on, visibility, sort_order
           FROM filter_definitions
          WHERE is_active = 1
            AND (marketplace_code = '' OR marketplace_code = ?)
            AND (category_code = '' OR category_code = ?)
            AND (subcategory_code = '' OR subcategory_code = ?)`,
        [params.marketplace ?? '', params.category ?? '', params.subcategory ?? ''],
      ).catch(() => [] as Row[]);
      return rows;
    },
  );

  if (overrides.length === 0) return builtIn;

  const byKey = new Map(builtIn.map((item) => [item.key, item]));
  for (const row of overrides) {
    const key = String(row.filter_key);
    const current = byKey.get(key) ?? builtInFilterDefinitions().find((item) => item.key === key);
    const allowed = Array.isArray(row.allowed_values)
      ? (row.allowed_values as Array<{ value?: string; label?: string }>).map((item) => ({
          value: String(item.value ?? ''),
          label: String(item.label ?? item.value ?? ''),
        }))
      : current?.allowedValues ?? [];
    byKey.set(key, {
      key,
      label: String(row.label ?? current?.label ?? key),
      type: (String(row.filter_type ?? current?.type ?? 'text') as FilterDefinition['type']),
      marketplace: (String(row.marketplace_code || current?.marketplace || '') || null) as FilterDefinition['marketplace'],
      category: String(row.category_code || current?.category || '') || null,
      subcategory: String(row.subcategory_code || current?.subcategory || '') || null,
      dataSource: (row.data_source as string | null) ?? current?.dataSource ?? null,
      allowedValues: allowed.filter((item) => item.value),
      min: row.min_value === null ? current?.min ?? null : Number(row.min_value),
      max: row.max_value === null ? current?.max ?? null : Number(row.max_value),
      step: row.step_value === null ? current?.step ?? null : Number(row.step_value),
      unit: (row.unit as string | null) ?? current?.unit ?? null,
      currency: (row.currency as string | null) ?? current?.currency ?? null,
      dependsOn: (row.depends_on as string | null) ?? current?.dependsOn ?? null,
      visibility: (String(row.visibility ?? current?.visibility ?? 'always') as FilterDefinition['visibility']),
      sortOrder: Number(row.sort_order ?? current?.sortOrder ?? 100),
    });
  }
  return [...byKey.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function resolveFilters(input: {
  marketplace?: string | null;
  category?: string | null;
  subcategory?: string | null;
  values?: Record<string, unknown>;
  currency: string;
  language: string;
  countryCode?: string;
}) {
  const validated = validateFilterState(
    { marketplace: input.marketplace, category: input.category, subcategory: input.subcategory, ...(input.values ?? {}) },
    { marketplace: input.marketplace, currency: input.currency },
  );
  const dsl = filterStateToSearchDsl(validated.state, {
    currency: input.currency,
    language: input.language,
    countryCode: input.countryCode,
  });
  return {
    state: validated.state,
    dropped: validated.dropped,
    definitions: visibleDefinitions(validated.state),
    dsl,
    query: publicQueryParams(validated.state),
  };
}

export { lookupFilterValues, computeFacets, validateFilterState, filterStateToSearchDsl };
