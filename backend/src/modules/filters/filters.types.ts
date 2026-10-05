/**
 * Filter platform domain types. Definitions are metadata; values live in
 * FilterState. Never put private user fields on either.
 */

export const FILTER_TYPES = [
  'text',
  'number',
  'range',
  'currency_range',
  'boolean',
  'single_select',
  'multi_select',
  'date',
  'date_range',
  'location',
  'radius',
  'distance',
  'rating',
  'year_range',
  'enum',
  'searchable_select',
] as const;

export type FilterType = (typeof FILTER_TYPES)[number];

export const FILTER_MARKETPLACES = ['gold', 'property', 'vehicles', 'parts'] as const;
export type FilterMarketplace = (typeof FILTER_MARKETPLACES)[number];

export const RADIUS_PRESETS_KM = [1, 5, 10, 25, 50, 100] as const;
export const MAX_RADIUS_KM = 100;
export const MIN_RADIUS_KM = 0.1;

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterDefinition {
  key: string;
  label: string;
  type: FilterType;
  marketplace: FilterMarketplace | null;
  category: string | null;
  subcategory: string | null;
  dataSource: string | null;
  allowedValues: FilterOption[];
  min: number | null;
  max: number | null;
  step: number | null;
  unit: string | null;
  currency: string | null;
  dependsOn: string | null;
  visibility: 'always' | 'when_parent' | 'hidden';
  sortOrder: number;
}

export type FilterValue =
  | string
  | number
  | boolean
  | string[]
  | { min?: number; max?: number; currency?: string; unit?: string }
  | { countryId?: number; regionId?: number; cityId?: number; areaId?: number; postalCode?: string; lat?: number; lng?: number; radiusKm?: number; label?: string }
  | null;

export interface FilterState {
  marketplace: FilterMarketplace | 'gold' | 'property' | 'vehicles' | null;
  category: string | null;
  subcategory: string | null;
  operation: string | null;
  location: {
    countryId?: number;
    regionId?: number;
    cityId?: number;
    areaId?: number;
    postalCode?: string;
    lat?: number;
    lng?: number;
    radiusKm?: number;
    label?: string;
  } | null;
  radiusKm: number | null;
  price: { min?: number; max?: number; currency: string } | null;
  currency: string | null;
  rating: number | null;
  condition: string | null;
  brand: string | number | null;
  year: { min?: number; max?: number } | null;
  color: string | null;
  area: { min?: number; max?: number; unit?: string } | null;
  bedrooms: { min?: number; max?: number } | null;
  bathrooms: { min?: number; max?: number } | null;
  availability: string | null;
  sellerType: string | null;
  values: Record<string, FilterValue>;
}

export interface FilterLookupItem {
  value: string;
  label: string;
  parentValue?: string | null;
  extra?: Record<string, unknown>;
}

export interface FacetBucket {
  value: string;
  label: string;
  count: number;
}

export interface FacetGroup {
  key: string;
  label: string;
  buckets: FacetBucket[];
}

export const PRIVATE_FILTER_KEYS = [
  'ownerId',
  'userId',
  'sellerId',
  'fraudStatus',
  'fraudScore',
  'moderationStatus',
  'moderationNotes',
  'lifecycleStatus',
  'internalStatus',
  'authenticityScore',
  'minAuthenticityScore',
  'vin',
  'exactLatitude',
  'exactLongitude',
  'privateDocuments',
  'guestUuid',
  'email',
  'phone',
] as const;
