import { emptySearchQuery, validateSearchQuery, type SearchQuery } from '../search/search.dsl';
import type { FilterState, FilterValue } from './filters.types';
import { emptyFilterState, validateFilterState } from './filters.validate';

const RANGE_KEYS: Record<string, { min: string; max: string; extra?: string }> = {
  price: { min: 'priceMin', max: 'priceMax', extra: 'currency' },
  yearMin: { min: 'yearMin', max: 'yearMax' },
  areaMin: { min: 'areaMin', max: 'areaMax' },
  weightMin: { min: 'weightMin', max: 'weightMax' },
  engineMin: { min: 'engineMin', max: 'engineMax' },
  floorsMin: { min: 'floorsMin', max: 'floorsMax' },
  bedroomsMin: { min: 'bedroomsMin', max: 'bedroomsMax' },
  bathroomsMin: { min: 'bathroomsMin', max: 'bathroomsMax' },
  mileageMax: { min: 'mileageMin', max: 'mileageMax' },
};

function flattenValue(key: string, value: FilterValue, filters: Record<string, unknown>): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    filters[key] = value;
    return;
  }
  if (Array.isArray(value)) {
    filters[key] = value;
    return;
  }
  if (key === 'location') return;
  if (key === 'price') {
    return;
  }
  if ('min' in value || 'max' in value) {
    const mapping = RANGE_KEYS[key];
    if (mapping) {
      if (value.min !== undefined) filters[mapping.min] = value.min;
      if (value.max !== undefined) filters[mapping.max] = value.max;
      if (mapping.extra && value.currency) filters[mapping.extra] = value.currency;
      if (value.unit && key === 'areaMin') filters.areaUnit = value.unit;
    } else {
      if (value.min !== undefined) filters[key.replace(/Max$/, 'Min').replace(/Min$/, 'Min')] = value.min;
      if (value.max !== undefined) {
        const maxKey = key.endsWith('Min') ? key.replace(/Min$/, 'Max') : key;
        filters[maxKey] = value.max;
      }
    }
    return;
  }
}

/**
 * Convert a validated FilterState into the existing Search DSL. List view and
 * map view must call this — never a second query grammar.
 */
export function filterStateToSearchDsl(
  state: FilterState,
  context: { currency: string; language: string; countryCode?: string },
): SearchQuery {
  const filters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state.values)) {
    flattenValue(key, value, filters);
  }

  if (state.condition) filters.condition = state.condition;
  if (state.brand !== null && state.brand !== undefined) filters.brandId = state.brand;
  if (state.color) filters.colorFamily = state.color;
  if (state.sellerType) filters.sellerType = state.sellerType;
  if (state.rating) filters.minRating = state.rating;
  if (state.year?.min !== undefined) filters.yearMin = state.year.min;
  if (state.year?.max !== undefined) filters.yearMax = state.year.max;
  if (state.area?.min !== undefined) filters.areaMin = state.area.min;
  if (state.area?.max !== undefined) filters.areaMax = state.area.max;
  if (state.area?.unit) filters.areaUnit = state.area.unit;
  if (state.bedrooms?.min !== undefined) filters.bedroomsMin = state.bedrooms.min;
  if (state.bedrooms?.max !== undefined) filters.bedroomsMax = state.bedrooms.max;
  if (state.bathrooms?.min !== undefined) filters.bathroomsMin = state.bathrooms.min;
  if (state.bathrooms?.max !== undefined) filters.bathroomsMax = state.bathrooms.max;

  const marketplace =
    state.marketplace === 'parts' ? 'vehicles' : state.marketplace === 'gold' || state.marketplace === 'property' || state.marketplace === 'vehicles'
      ? state.marketplace
      : null;

  return validateSearchQuery(
    {
      ...emptySearchQuery(),
      marketplace,
      category: state.category,
      operation: state.operation as SearchQuery['operation'],
      availability: state.availability,
      intent: state.marketplace === 'parts' ? 'parts' : 'search',
      filters,
      price: state.price
        ? {
            min: state.price.min,
            max: state.price.max,
            currency: state.price.currency || context.currency,
          }
        : null,
      location: state.location
        ? {
            countryId: state.location.countryId,
            regionId: state.location.regionId,
            cityId: state.location.cityId,
            areaId: state.location.areaId,
            lat: state.location.lat,
            lng: state.location.lng,
            radiusKm: state.location.radiusKm ?? state.radiusKm ?? undefined,
            cityName: state.location.label,
          }
        : state.radiusKm
          ? { radiusKm: state.radiusKm }
          : null,
    },
    context,
  );
}

export function searchDslToFilterState(dsl: SearchQuery): FilterState {
  const raw: Record<string, unknown> = {
    marketplace: dsl.marketplace,
    category: dsl.category,
    operation: dsl.operation,
    availability: dsl.availability,
    ...dsl.filters,
  };
  if (dsl.price) raw.price = dsl.price;
  if (dsl.location) raw.location = dsl.location;
  if (dsl.intent === 'parts') raw.marketplace = 'parts';
  return validateFilterState(raw, { marketplace: dsl.marketplace, currency: dsl.price?.currency }).state;
}

export function publicQueryParams(state: FilterState): Record<string, string> {
  const params: Record<string, string> = {};
  if (state.marketplace) params.marketplace = state.marketplace;
  if (state.category) params.category = state.category;
  if (state.subcategory) params.subcategory = state.subcategory;
  if (state.operation) params.operation = state.operation;
  if (state.availability) params.availability = state.availability;
  if (state.location?.countryId) params.countryId = String(state.location.countryId);
  if (state.location?.regionId) params.regionId = String(state.location.regionId);
  if (state.location?.cityId) params.cityId = String(state.location.cityId);
  if (state.location?.areaId) params.areaId = String(state.location.areaId);
  if (state.location?.radiusKm ?? state.radiusKm) {
    params.radiusKm = String(state.location?.radiusKm ?? state.radiusKm);
  }
  if (state.price?.min !== undefined) params.minPrice = String(state.price.min);
  if (state.price?.max !== undefined) params.maxPrice = String(state.price.max);
  if (state.price?.currency) params.currency = state.price.currency;
  const skip = new Set(['location', 'price', 'radiusKm']);
  for (const [key, value] of Object.entries(state.values)) {
    if (skip.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params[key] = String(value);
    } else if (Array.isArray(value)) {
      params[key] = value.join(',');
    } else if (value && typeof value === 'object') {
      const ranged = value as { min?: number; max?: number };
      if (ranged.min !== undefined) params[`${key}Min`] = String(ranged.min);
      if (ranged.max !== undefined) params[`${key}Max`] = String(ranged.max);
    }
  }
  return params;
}

export function filterStateFromQueryParams(
  params: Record<string, unknown>,
  context: { marketplace?: string | null; currency?: string },
): FilterState {
  const raw: Record<string, unknown> = { ...params };
  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    raw.price = {
      min: params.minPrice,
      max: params.maxPrice,
      currency: params.currency ?? context.currency,
    };
  }
  if (
    params.countryId !== undefined ||
    params.cityId !== undefined ||
    params.lat !== undefined ||
    params.radiusKm !== undefined
  ) {
    raw.location = {
      countryId: params.countryId,
      regionId: params.regionId,
      cityId: params.cityId,
      areaId: params.areaId,
      lat: params.lat,
      lng: params.lng,
      radiusKm: params.radiusKm,
    };
  }
  return validateFilterState(raw, context).state;
}

export { emptyFilterState };
