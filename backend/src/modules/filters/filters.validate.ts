import { FILTER_TYPES, PRIVATE_FILTER_KEYS, type FilterDefinition, type FilterState, type FilterValue } from './filters.types';
import { definitionByKey, definitionsFor } from './filters.definitions';

const FORBIDDEN = new Set<string>(PRIVATE_FILTER_KEYS);

export interface FilterValidationResult {
  state: FilterState;
  dropped: string[];
  errors: string[];
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return undefined;
}

function asString(value: unknown, max = 128): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim().slice(0, max);
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asStringList(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const cleaned = raw
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 20);
  return cleaned.length > 0 ? [...new Set(cleaned)] : undefined;
}

function inAllowed(definition: FilterDefinition, value: string): boolean {
  if (definition.allowedValues.length === 0) return true;
  return definition.allowedValues.some((option) => option.value.toLowerCase() === value.toLowerCase());
}

function clampRange(definition: FilterDefinition, min?: number, max?: number): { min?: number; max?: number } {
  const lo = definition.min;
  const hi = definition.max;
  let nextMin = min;
  let nextMax = max;
  if (nextMin !== undefined && lo !== null) nextMin = Math.max(lo, nextMin);
  if (nextMax !== undefined && hi !== null) nextMax = Math.min(hi, nextMax);
  if (nextMin !== undefined && nextMax !== undefined && nextMax < nextMin) nextMax = nextMin;
  return { min: nextMin, max: nextMax };
}

export function sanitizeFilterValue(definition: FilterDefinition, raw: unknown): FilterValue {
  switch (definition.type) {
    case 'boolean': {
      const flag = asBoolean(raw);
      return flag === true ? true : null;
    }
    case 'number':
    case 'rating': {
      let num = asNumber(raw);
      if (num === undefined) return null;
      if (definition.min !== null) num = Math.max(definition.min, num);
      if (definition.max !== null) num = Math.min(definition.max, num);
      return num;
    }
    case 'text': {
      return asString(raw, 191) ?? null;
    }
    case 'enum':
    case 'single_select': {
      const value = asString(raw);
      if (!value || !inAllowed(definition, value)) return null;
      return value;
    }
    case 'multi_select': {
      const list = asStringList(raw)?.filter((item) => inAllowed(definition, item));
      return list && list.length > 0 ? list : null;
    }
    case 'searchable_select': {
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const record = raw as Record<string, unknown>;
        const value = asString(record.value ?? record.id ?? record.key);
        return value ?? null;
      }
      return asString(raw) ?? null;
    }
    case 'range':
    case 'currency_range':
    case 'year_range':
    case 'date_range': {
      const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : { min: raw };
      const ranged = clampRange(definition, asNumber(record.min), asNumber(record.max));
      if (ranged.min === undefined && ranged.max === undefined) return null;
      return {
        min: ranged.min,
        max: ranged.max,
        currency: asString(record.currency, 3)?.toUpperCase(),
        unit: asString(record.unit, 16),
      };
    }
    case 'date': {
      return asString(raw, 32) ?? null;
    }
    case 'location': {
      if (!raw || typeof raw !== 'object') return null;
      const record = raw as Record<string, unknown>;
      const lat = asNumber(record.lat);
      const lng = asNumber(record.lng);
      const location = {
        countryId: asNumber(record.countryId),
        regionId: asNumber(record.regionId),
        cityId: asNumber(record.cityId),
        areaId: asNumber(record.areaId),
        postalCode: asString(record.postalCode, 24),
        lat: lat !== undefined && lat >= -90 && lat <= 90 ? lat : undefined,
        lng: lng !== undefined && lng >= -180 && lng <= 180 ? lng : undefined,
        radiusKm: asNumber(record.radiusKm),
        label: asString(record.label, 96),
      };
      return Object.values(location).some((item) => item !== undefined) ? location : null;
    }
    case 'radius':
    case 'distance': {
      return asNumber(raw) ?? null;
    }
    default:
      return null;
  }
}

export function emptyFilterState(overrides: Partial<FilterState> = {}): FilterState {
  return {
    marketplace: null,
    category: null,
    subcategory: null,
    operation: null,
    location: null,
    radiusKm: null,
    price: null,
    currency: null,
    rating: null,
    condition: null,
    brand: null,
    year: null,
    color: null,
    area: null,
    bedrooms: null,
    bathrooms: null,
    availability: null,
    sellerType: null,
    values: {},
    ...overrides,
  };
}

function assignKnown(state: FilterState, key: string, value: FilterValue): void {
  if (value === null || value === undefined) return;
  switch (key) {
    case 'operation':
      state.operation = String(value);
      break;
    case 'category':
      state.category = String(value);
      break;
    case 'subcategory':
      state.subcategory = String(value);
      break;
    case 'minRating':
      state.rating = typeof value === 'number' ? value : Number(value);
      break;
    case 'condition':
    case 'conditionGrade':
      state.condition = String(value);
      break;
    case 'brandId':
    case 'brand':
      state.brand = Array.isArray(value) ? value[0] ?? null : (value as string | number);
      break;
    case 'colorFamily':
    case 'color':
      state.color = String(value);
      break;
    case 'availability':
      state.availability = String(value);
      break;
    case 'sellerType':
      state.sellerType = String(value);
      break;
    case 'price':
      if (typeof value === 'object' && !Array.isArray(value) && value) {
        const ranged = value as { min?: number; max?: number; currency?: string };
        state.price = {
          min: ranged.min,
          max: ranged.max,
          currency: ranged.currency ?? state.currency ?? 'USD',
        };
      }
      break;
    case 'radiusKm':
      state.radiusKm = typeof value === 'number' ? value : Number(value);
      break;
    case 'countryId':
    case 'regionId':
    case 'cityId':
    case 'areaId': {
      const current = state.location ?? {};
      const numeric = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(numeric) && numeric > 0) {
        if (key === 'countryId') current.countryId = numeric;
        if (key === 'regionId') current.regionId = numeric;
        if (key === 'cityId') current.cityId = numeric;
        if (key === 'areaId') current.areaId = numeric;
        state.location = current;
      }
      break;
    }
    case 'location':
      if (typeof value === 'object' && value && !Array.isArray(value)) {
        state.location = value as FilterState['location'];
      }
      break;
    case 'yearMin':
    case 'yearMax': {
      const current = state.year ?? {};
      if (key === 'yearMin' && typeof value === 'number') current.min = value;
      if (key === 'yearMax' && typeof value === 'number') current.max = value;
      if (typeof value === 'object' && value && !Array.isArray(value)) {
        state.year = value as FilterState['year'];
      } else {
        state.year = current;
      }
      break;
    }
    case 'areaMin':
    case 'areaMax':
    case 'areaUnit': {
      const current = state.area ?? {};
      if (key === 'areaMin' && typeof value === 'number') current.min = value;
      if (key === 'areaMax' && typeof value === 'number') current.max = value;
      if (key === 'areaUnit') current.unit = String(value);
      state.area = current;
      break;
    }
    case 'bedroomsMin':
    case 'bedroomsMax': {
      const current = state.bedrooms ?? {};
      if (key === 'bedroomsMin' && typeof value === 'number') current.min = value;
      if (key === 'bedroomsMax' && typeof value === 'number') current.max = value;
      state.bedrooms = current;
      break;
    }
    case 'bathroomsMin':
    case 'bathroomsMax': {
      const current = state.bathrooms ?? {};
      if (key === 'bathroomsMin' && typeof value === 'number') current.min = value;
      if (key === 'bathroomsMax' && typeof value === 'number') current.max = value;
      state.bathrooms = current;
      break;
    }
    default:
      break;
  }
}

/**
 * Normalize a client/AI payload into FilterState. Unknown and private keys are
 * dropped, not rejected, so hostile probes cannot enumerate internals.
 */
export function validateFilterState(
  raw: Record<string, unknown>,
  context: { marketplace?: string | null; currency?: string },
): FilterValidationResult {
  const dropped: string[] = [];
  const errors: string[] = [];
  const marketplace = typeof raw.marketplace === 'string' ? raw.marketplace : context.marketplace ?? null;
  const state = emptyFilterState({
    marketplace: marketplace === 'gold' || marketplace === 'property' || marketplace === 'vehicles' || marketplace === 'parts'
      ? marketplace
      : null,
    currency: context.currency ?? null,
  });

  const valuesInput =
    raw.values && typeof raw.values === 'object' && !Array.isArray(raw.values)
      ? (raw.values as Record<string, unknown>)
      : raw;

  for (const [key, value] of Object.entries(valuesInput)) {
    if (key === 'marketplace' || key === 'values' || key === 'customAttributes') continue;
    if (FORBIDDEN.has(key) || key.startsWith('_')) {
      dropped.push(key);
      continue;
    }
    const definition = definitionByKey(key, state.marketplace);
    if (!definition || !FILTER_TYPES.includes(definition.type)) {
      dropped.push(key);
      continue;
    }
    const sanitized = sanitizeFilterValue(definition, value);
    if (sanitized === null) continue;
    state.values[key] = sanitized;
    assignKnown(state, key, sanitized);
  }

  if (raw.price && typeof raw.price === 'object') {
    const price = sanitizeFilterValue(
      definitionByKey('price', state.marketplace)!,
      raw.price,
    );
    if (price && typeof price === 'object' && !Array.isArray(price)) {
      state.price = {
        min: (price as { min?: number }).min,
        max: (price as { max?: number }).max,
        currency: (price as { currency?: string }).currency ?? context.currency ?? 'USD',
      };
    }
  }

  if (raw.location && typeof raw.location === 'object') {
    const location = sanitizeFilterValue(definitionByKey('location', state.marketplace)!, raw.location);
    if (location && typeof location === 'object' && !Array.isArray(location)) {
      state.location = location as FilterState['location'];
    }
  }

  const visible = definitionsFor({
    marketplace: state.marketplace,
    category: state.category,
    subcategory: state.subcategory,
  });
  const visibleKeys = new Set(visible.map((item) => item.key));
  for (const key of Object.keys(state.values)) {
    const definition = definitionByKey(key, state.marketplace);
    if (definition?.visibility === 'when_parent' && definition.dependsOn) {
      const parent = state.values[definition.dependsOn];
      if (parent === undefined || parent === null || parent === false || parent === '') {
        delete state.values[key];
      }
    }
    if (!visibleKeys.has(key) && key !== 'location' && key !== 'price') {
      delete state.values[key];
    }
  }

  return { state, dropped, errors };
}

export function visibleDefinitions(state: FilterState): FilterDefinition[] {
  return definitionsFor({
    marketplace: state.marketplace,
    category: state.category,
    subcategory: state.subcategory,
  }).filter((item) => {
    if (item.visibility === 'hidden') return false;
    if (item.visibility === 'when_parent' && item.dependsOn) {
      const parent = state.values[item.dependsOn];
      return parent !== undefined && parent !== null && parent !== false && parent !== '';
    }
    return true;
  });
}
