import { queryRows, type Row } from '../../db/query';
import { remember } from '../../config/cache';
import { toBoolean } from '../../db/sql';
import { AREA_TO_SQM } from './property.area';

export async function getPropertyCatalog(params: { countryId: number | null; language: string }) {
  const [types, durations, attributes, areaUnits, categories] = await Promise.all([
    listTypeRules(),
    listRentalDurations(),
    listPropertyAttributes(),
    listCatalogAreaUnits(params.countryId),
    listPropertyCategories(params.language),
  ]);

  return {
    groups: categories.groups,
    categories: categories.leaves,
    types,
    rentalDurations: durations,
    attributes,
    areaUnits,
    furnishing: [
      { code: 'unfurnished', label: 'Unfurnished' },
      { code: 'semi_furnished', label: 'Semi furnished' },
      { code: 'fully_furnished', label: 'Fully furnished' },
    ],
    parkingKinds: [
      { code: 'covered', label: 'Covered' },
      { code: 'open', label: 'Open' },
      { code: 'basement', label: 'Basement' },
    ],
    documentTypes: [
      { code: 'ownership', label: 'Ownership papers' },
      { code: 'title_registry', label: 'Title / registry' },
      { code: 'map', label: 'Maps' },
      { code: 'approval', label: 'Approval documents' },
      { code: 'noc', label: 'NOC' },
      { code: 'tax', label: 'Tax documents' },
      { code: 'building_approval', label: 'Building approval' },
      { code: 'completion_certificate', label: 'Completion certificate' },
      { code: 'other', label: 'Other' },
    ],
    disclaimer:
      'Property categories and allowed buy/sell/rent operations are configured on the server. Flutter must not hardcode them.',
  };
}

async function listTypeRules() {
  return remember('property:type-rules', 600, async () => {
    const rows = await queryRows<Row>(
      `SELECT property_kind, usage_group, category_code, allowed_operations,
              requires_bedrooms, requires_covered_area, is_land, is_hospitality, sort_order
         FROM property_type_rules
        WHERE is_active = 1
        ORDER BY sort_order, property_kind`,
    ).catch(() => [] as Row[]);
    return rows.map((row) => ({
      code: String(row.property_kind),
      usageGroup: String(row.usage_group),
      categoryCode: (row.category_code as string | null) ?? String(row.property_kind),
      allowedOperations: parseJsonArray(row.allowed_operations),
      requiresBedrooms: toBoolean(row.requires_bedrooms),
      requiresCoveredArea: toBoolean(row.requires_covered_area),
      isLand: toBoolean(row.is_land),
      isHospitality: toBoolean(row.is_hospitality),
    }));
  });
}

export async function getTypeRule(propertyKind: string) {
  const types = await listTypeRules();
  return types.find((type) => type.code === propertyKind) ?? null;
}

async function listRentalDurations() {
  return remember('property:rental-durations', 3600, async () => {
    const rows = await queryRows<Row>(
      `SELECT code, name, stay_kind, duration_days FROM property_rental_durations WHERE is_active = 1 ORDER BY sort_order`,
    ).catch(() => [] as Row[]);
    return rows.map((row) => ({
      code: String(row.code),
      name: String(row.name),
      stayKind: String(row.stay_kind),
      durationDays: row.duration_days === null ? null : Number(row.duration_days),
    }));
  });
}

async function listPropertyAttributes() {
  return remember('property:attributes', 3600, async () => {
    const rows = await queryRows<Row>(
      `SELECT code, name, data_type, unit_code, applies_to, is_filterable, is_required
         FROM property_attributes WHERE is_active = 1 ORDER BY sort_order`,
    ).catch(() => [] as Row[]);
    return rows.map((row) => ({
      code: String(row.code),
      name: String(row.name),
      dataType: String(row.data_type),
      unitCode: (row.unit_code as string | null) ?? null,
      appliesTo: row.applies_to ?? null,
      isFilterable: toBoolean(row.is_filterable),
      isRequired: toBoolean(row.is_required),
    }));
  });
}

async function listCatalogAreaUnits(countryId: number | null) {
  const rows = await queryRows<Row>(
    `SELECT code, name, symbol, to_sqm, is_default
       FROM property_area_units
      WHERE is_active = 1 AND (country_id = ? OR country_id IS NULL OR ? IS NULL)
      ORDER BY (country_id IS NULL), sort_order`,
    [countryId, countryId],
  ).catch(() => [] as Row[]);

  if (rows.length > 0) {
    const seen = new Set<string>();
    const units = [];
    for (const row of rows) {
      const code = String(row.code);
      if (seen.has(code)) continue;
      seen.add(code);
      units.push({
        code,
        name: String(row.name),
        symbol: String(row.symbol),
        toSqm: String(row.to_sqm),
        isDefault: toBoolean(row.is_default),
      });
    }
    return units;
  }

  return Object.entries(AREA_TO_SQM).map(([code, factor]) => ({
    code,
    name: code,
    symbol: code,
    toSqm: factor,
    isDefault: code === 'sqm',
  }));
}

async function listPropertyCategories(language: string) {
  const rows = await queryRows<Row>(
    `SELECT c.id, c.parent_id, c.code, c.name, c.slug, c.is_leaf, c.group_code, c.sort_order, c.operations,
            COALESCE(ct.name, c.name) AS localized_name,
            p.code AS parent_code, COALESCE(pt.name, p.name) AS parent_name
       FROM categories c
       LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
       LEFT JOIN categories p ON p.id = c.parent_id
       LEFT JOIN category_translations pt ON pt.category_id = p.id AND pt.language = ?
      WHERE c.marketplace_id = 2 AND c.is_active = 1
      ORDER BY COALESCE(p.sort_order, c.sort_order), c.sort_order, c.id`,
    [language, language],
  );

  const groupsMap = new Map<
    string,
    { code: string; name: string; categories: Array<{ id: number; code: string; name: string; isLeaf: boolean; operations: unknown }> }
  >();
  const leaves: Array<{
    id: number;
    code: string;
    name: string;
    parentCode: string | null;
    parentName: string | null;
    isLeaf: boolean;
    operations: unknown;
  }> = [];

  for (const row of rows) {
    const item = {
      id: Number(row.id),
      code: String(row.code),
      name: String(row.localized_name),
      isLeaf: toBoolean(row.is_leaf),
      operations: row.operations ?? null,
    };
    const groupCode = (row.group_code as string | null) || (row.parent_code as string | null) || String(row.code);
    const groupName = (row.parent_name as string | null) || (row.group_code as string | null) || item.name;
    if (!groupsMap.has(groupCode)) {
      groupsMap.set(groupCode, { code: groupCode, name: String(groupName), categories: [] });
    }
    if (item.isLeaf) {
      groupsMap.get(groupCode)!.categories.push(item);
      leaves.push({
        ...item,
        parentCode: (row.parent_code as string | null) ?? null,
        parentName: (row.parent_name as string | null) ?? null,
      });
    }
  }

  return { groups: [...groupsMap.values()], leaves };
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}
