import { queryRows, type Row } from '../../db/query';
import { remember } from '../../config/cache';
import { toBoolean } from '../../db/sql';

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

function named(rows: Row[], codeKey = 'code', nameKey = 'name') {
  return rows.map((row) => ({
    code: String(row[codeKey]),
    name: String(row[nameKey] ?? row.label ?? row[codeKey]),
    extra: row,
  }));
}

export async function getVehicleCatalog(params: { countryId: number | null; language: string }) {
  const [types, fuels, transmissions, drives, conditions, mileageUnits, durations, documents, shipping, partCategories, features, checklists] =
    await Promise.all([
      listTypeRules(),
      listTable('vehicle_fuel_types'),
      listTable('vehicle_transmission_types'),
      listTable('vehicle_drive_types'),
      listTable('vehicle_condition_codes'),
      listMileageUnits(),
      listTable('vehicle_rental_durations'),
      listTable('vehicle_document_types'),
      listTable('vehicle_shipping_modes'),
      listTable('vehicle_part_categories'),
      listCatalogFeatures(),
      listChecklists(),
    ]);

  return {
    types,
    fuels,
    transmissions,
    drives,
    conditions,
    mileageUnits,
    rentalDurations: durations,
    documentTypes: documents,
    shippingModes: shipping,
    partCategories,
    features,
    inspectionChecklists: checklists,
    operations: ['buy', 'sell', 'rent', 'auction'],
    mediaKinds: ['exterior', 'interior', 'engine', 'tire', 'damage', 'vin', 'document', 'video', 'tour_360'],
    countryId: params.countryId,
    language: params.language,
    disclaimer:
      'Vehicle categories, fuels, transmissions, conditions and rental durations are configured on the server. Flutter must not hardcode them.',
  };
}

async function listTypeRules() {
  return remember('vehicles:type-rules', 600, async () => {
    const rows = await queryRows<Row>(
      `SELECT vehicle_type, category_code, group_code, allowed_operations,
              requires_make_model, requires_mileage, uses_engine_hours, is_marine, is_machinery, sort_order
         FROM vehicle_category_rules
        WHERE is_active = 1
        ORDER BY sort_order, vehicle_type`,
    ).catch(() => [] as Row[]);
    return rows.map((row) => ({
      code: String(row.vehicle_type),
      categoryCode: (row.category_code as string | null) ?? String(row.vehicle_type),
      groupCode: String(row.group_code),
      allowedOperations: parseJsonArray(row.allowed_operations),
      requiresMakeModel: toBoolean(row.requires_make_model),
      requiresMileage: toBoolean(row.requires_mileage),
      usesEngineHours: toBoolean(row.uses_engine_hours),
      isMarine: toBoolean(row.is_marine),
      isMachinery: toBoolean(row.is_machinery),
    }));
  });
}

export async function getTypeRule(vehicleType: string) {
  const types = await listTypeRules();
  return types.find((type) => type.code === vehicleType) ?? null;
}

const CATALOG_TABLES = new Set([
  'vehicle_fuel_types',
  'vehicle_transmission_types',
  'vehicle_drive_types',
  'vehicle_condition_codes',
  'vehicle_rental_durations',
  'vehicle_document_types',
  'vehicle_shipping_modes',
  'vehicle_part_categories',
]);

async function listTable(table: string) {
  if (!CATALOG_TABLES.has(table)) return [];
  return remember(`vehicles:cfg:${table}`, 3600, async () => {
    const rows = await queryRows<Row>(
      `SELECT code, name FROM ${table} WHERE is_active = 1 ORDER BY sort_order, name`,
    ).catch(() => [] as Row[]);
    return named(rows);
  });
}

async function listMileageUnits() {
  return remember('vehicles:mileage-units', 3600, async () => {
    const rows = await queryRows<Row>(
      `SELECT code, name, to_km FROM vehicle_mileage_units WHERE is_active = 1 ORDER BY sort_order`,
    ).catch(() => [] as Row[]);
    return rows.map((row) => ({
      code: String(row.code),
      name: String(row.name),
      toKm: Number(row.to_km),
    }));
  });
}

async function listCatalogFeatures() {
  return remember('vehicles:features:catalog', 3600, async () => {
    const rows = await queryRows<Row>(
      `SELECT id, code, name, icon, group_code
         FROM vehicle_features
        WHERE is_active = 1
        ORDER BY group_code, sort_order, name`,
    ).catch(() => [] as Row[]);
    return rows.map((row) => ({
      id: Number(row.id),
      code: String(row.code),
      name: String(row.name),
      groupCode: String(row.group_code),
      icon: row.icon,
    }));
  });
}

async function listChecklists() {
  return remember('vehicles:checklists', 3600, async () => {
    const lists = await queryRows<Row>(
      `SELECT code, name, applies_to FROM vehicle_inspection_checklists WHERE is_active = 1 ORDER BY sort_order`,
    ).catch(() => [] as Row[]);
    const items = await queryRows<Row>(
      `SELECT checklist_code, item_code, name, group_code
         FROM vehicle_inspection_checklist_items WHERE is_active = 1 ORDER BY sort_order`,
    ).catch(() => [] as Row[]);
    return lists.map((list) => ({
      code: String(list.code),
      name: String(list.name),
      appliesTo: parseJsonArray(list.applies_to),
      items: items
        .filter((item) => String(item.checklist_code) === String(list.code))
        .map((item) => ({
          code: String(item.item_code),
          name: String(item.name),
          groupCode: String(item.group_code),
        })),
    }));
  });
}
