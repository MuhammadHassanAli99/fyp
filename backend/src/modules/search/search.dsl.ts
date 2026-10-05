/**
 * Validated Search DSL. AI and clients may propose filters; only this module
 * decides what is executable. Unknown and internal fields are stripped.
 */

import { z } from 'zod';

export const MARKETPLACE_CODES = ['gold', 'property', 'vehicles'] as const;
export type MarketplaceCode = (typeof MARKETPLACE_CODES)[number];

export const SEARCH_INTENTS = [
  'search',
  'browse',
  'buy',
  'sell',
  'rent',
  'compare',
  'valuate',
  'parts',
] as const;
export type SearchIntent = (typeof SEARCH_INTENTS)[number];

export const SEARCH_OPERATIONS = ['buy', 'sell', 'rent', 'auction', 'exchange'] as const;
export type SearchOperation = (typeof SEARCH_OPERATIONS)[number];

export const SEARCH_TYPES = ['text', 'voice', 'image', 'ai', 'nearby', 'global'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const SEARCH_SORTS = [
  'relevance',
  'newest',
  'oldest',
  'price',
  'price_asc',
  'price_desc',
  'popular',
  'distance',
  'weight_desc',
  'weight_asc',
  'karat_desc',
  'area_desc',
  'mileage_asc',
  'year_desc',
] as const;

/** Hard filters the engine may apply. Preferences must not appear here. */
export const FILTER_ALLOWLIST = [
  'karat',
  'weightMin',
  'weightMax',
  'form',
  'jewelleryType',
  'metalType',
  'hallmarked',
  'certified',
  'investmentGrade',
  'antique',
  'scrap',
  'brandId',
  'certificateAuthority',
  'propertyKind',
  'usageType',
  'bedroomsMin',
  'bedroomsMax',
  'bathroomsMin',
  'bathroomsMax',
  'areaMin',
  'areaMax',
  'areaUnit',
  'furnishing',
  'constructionStatus',
  'parkingMin',
  'swimmingPool',
  'gym',
  'garden',
  'balcony',
  'elevator',
  'gatedCommunity',
  'vehicleType',
  'make',
  'makeId',
  'model',
  'modelId',
  'yearMin',
  'yearMax',
  'mileageMin',
  'mileageMax',
  'fuelType',
  'transmission',
  'bodyType',
  'colorFamily',
  'condition',
  'conditionGrade',
  'inspected',
  'financeAvailable',
  'partCategory',
  'partBrand',
  'oemPartNumber',
  'verifiedSeller',
  'premiumSeller',
  'sellerType',
  'minRating',
  'makingChargeMin',
  'makingChargeMax',
  'floorsMin',
  'floorsMax',
  'variantId',
  'engineMin',
  'engineMax',
  'registrationStatus',
  'assembly',
  'oem',
  'color',
] as const;

export type FilterKey = (typeof FILTER_ALLOWLIST)[number];

const FORBIDDEN_FILTER_KEYS = [
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
];

export const PREFERENCE_ALLOWLIST = [
  'lowMileage',
  'reliability',
  'fuelEconomy',
  'familyUse',
  'budgetSensitive',
  'newer',
  'spacious',
  'quietArea',
  'investment',
] as const;

export type PreferenceKey = (typeof PREFERENCE_ALLOWLIST)[number];

export interface SearchPrice {
  min?: number;
  max?: number;
  currency: string;
  originalAmount?: number;
  originalCurrency?: string;
  fxRate?: number | null;
  fxAt?: string | null;
  minBase?: number;
  maxBase?: number;
}

export interface SearchLocation {
  countryId?: number;
  regionId?: number;
  cityId?: number;
  areaId?: number;
  cityName?: string;
  regionName?: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
}

export interface SearchClarification {
  needed: boolean;
  questions: string[];
  missing: string[];
}

export interface SearchQuery {
  marketplace: MarketplaceCode | null;
  intent: SearchIntent;
  category: string | null;
  operation: SearchOperation | null;
  keywords: string;
  filters: Partial<Record<FilterKey, string | number | boolean | string[]>>;
  price: SearchPrice | null;
  location: SearchLocation | null;
  availability: string | null;
  semanticQuery: string | null;
  preferences: Partial<Record<PreferenceKey, boolean | string | number>>;
  sort: string;
  pagination: { page: number; perPage: number; cursor?: string };
  searchType: SearchType;
  language: string;
  originalQuery: string;
  clarification: SearchClarification;
}

export interface SearchQueryDraft extends Partial<Omit<SearchQuery, 'filters' | 'preferences' | 'pagination'>> {
  filters?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  pagination?: { page?: number; perPage?: number; cursor?: string };
}

const MAX_QUERY_CHARS = 500;
const MAX_PER_PAGE = 50;
const MAX_PAGE = 40;
const MAX_RADIUS_KM = 100;
const ALLOWED_RADIUS = [1, 5, 10, 25, 50, 100];

const marketplaceSchema = z.enum(MARKETPLACE_CODES).nullable();

export function emptySearchQuery(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return {
    marketplace: null,
    intent: 'search',
    category: null,
    operation: null,
    keywords: '',
    filters: {},
    price: null,
    location: null,
    availability: null,
    semanticQuery: null,
    preferences: {},
    sort: 'relevance',
    pagination: { page: 1, perPage: 24 },
    searchType: 'text',
    language: 'en',
    originalQuery: '',
    clarification: { needed: false, questions: [], missing: [] },
    ...overrides,
  };
}

export function normalizeQueryText(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, MAX_QUERY_CHARS);
}

export function clampRadiusKm(value: number | undefined | null): number | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) return undefined;
  const clamped = Math.min(MAX_RADIUS_KM, Math.max(0.1, value));
  const preset = ALLOWED_RADIUS.find((option) => Math.abs(option - clamped) < 0.05);
  return preset ?? Number(clamped.toFixed(2));
}

function pickAllowed<T extends string>(
  input: Record<string, unknown> | undefined,
  allow: readonly T[],
): Partial<Record<T, string | number | boolean | string[]>> {
  if (!input) return {};
  const allowSet = new Set<string>(allow);
  const out: Partial<Record<T, string | number | boolean | string[]>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_FILTER_KEYS.includes(key)) continue;
    if (!allowSet.has(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key as T] = value;
    } else if (Array.isArray(value)) {
      const cleaned = value
        .map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item) : ''))
        .filter(Boolean)
        .slice(0, 20);
      if (cleaned.length > 0) out[key as T] = cleaned;
    }
  }
  return out;
}

function sanitizePrice(raw: unknown, fallbackCurrency: string): SearchPrice | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const currency = typeof value.currency === 'string' && value.currency.length === 3
    ? value.currency.toUpperCase()
    : fallbackCurrency;
  const num = (key: string): number | undefined => {
    const parsed = Number(value[key]);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const min = num('min');
  const max = num('max');
  if (min === undefined && max === undefined && num('originalAmount') === undefined) return null;
  return {
    min,
    max: max !== undefined && min !== undefined && max < min ? min : max,
    currency,
    originalAmount: num('originalAmount'),
    originalCurrency:
      typeof value.originalCurrency === 'string' && value.originalCurrency.length === 3
        ? value.originalCurrency.toUpperCase()
        : currency,
    fxRate: num('fxRate') ?? null,
    fxAt: typeof value.fxAt === 'string' ? value.fxAt : null,
    minBase: num('minBase'),
    maxBase: num('maxBase'),
  };
}

function sanitizeLocation(raw: unknown): SearchLocation | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const int = (key: string): number | undefined => {
    const parsed = Number(value[key]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  };
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  const location: SearchLocation = {
    countryId: int('countryId'),
    regionId: int('regionId'),
    cityId: int('cityId'),
    areaId: int('areaId'),
    cityName: typeof value.cityName === 'string' ? value.cityName.slice(0, 96) : undefined,
    regionName: typeof value.regionName === 'string' ? value.regionName.slice(0, 96) : undefined,
    countryCode:
      typeof value.countryCode === 'string' ? value.countryCode.toUpperCase().slice(0, 2) : undefined,
    lat: Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : undefined,
    lng: Number.isFinite(lng) && lng >= -180 && lng <= 180 ? lng : undefined,
    radiusKm: clampRadiusKm(Number(value.radiusKm)),
  };
  return Object.values(location).some((item) => item !== undefined) ? location : null;
}

/**
 * Server-side validation. Never trust AI-generated or client-provided DSL.
 * Forbidden fields are dropped, not rejected, so a hostile payload cannot
 * probe which internal keys exist.
 */
export function validateSearchQuery(
  draft: SearchQueryDraft,
  context: { currency: string; language: string; countryCode?: string },
): SearchQuery {
  const originalQuery = String(draft.originalQuery ?? draft.keywords ?? '').slice(0, MAX_QUERY_CHARS);
  const marketplaceParse = marketplaceSchema.safeParse(draft.marketplace ?? null);
  const intent = SEARCH_INTENTS.includes(draft.intent as SearchIntent) ? (draft.intent as SearchIntent) : 'search';
  const operation = SEARCH_OPERATIONS.includes(draft.operation as SearchOperation)
    ? (draft.operation as SearchOperation)
    : null;
  const searchType = SEARCH_TYPES.includes(draft.searchType as SearchType)
    ? (draft.searchType as SearchType)
    : 'text';
  const page = Math.min(MAX_PAGE, Math.max(1, Number(draft.pagination?.page) || 1));
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number(draft.pagination?.perPage) || 24));
  const sort = typeof draft.sort === 'string' && draft.sort.length > 0 && draft.sort.length <= 48
    ? draft.sort
    : 'relevance';

  const clarification = draft.clarification ?? { needed: false, questions: [], missing: [] };

  return {
    marketplace: marketplaceParse.success ? marketplaceParse.data : null,
    intent,
    category: typeof draft.category === 'string' ? draft.category.slice(0, 64) : null,
    operation,
    keywords: String(draft.keywords ?? '').slice(0, 191),
    filters: pickAllowed(draft.filters, FILTER_ALLOWLIST),
    price: sanitizePrice(draft.price, context.currency),
    location: sanitizeLocation(draft.location),
    availability: typeof draft.availability === 'string' ? draft.availability.slice(0, 24) : null,
    semanticQuery: typeof draft.semanticQuery === 'string' ? draft.semanticQuery.slice(0, 500) : null,
    preferences: pickAllowed(draft.preferences, PREFERENCE_ALLOWLIST) as SearchQuery['preferences'],
    sort,
    pagination: {
      page,
      perPage,
      cursor: typeof draft.pagination?.cursor === 'string' ? draft.pagination.cursor.slice(0, 512) : undefined,
    },
    searchType,
    language: (draft.language ?? context.language).slice(0, 10),
    originalQuery,
    clarification: {
      needed: Boolean(clarification.needed),
      questions: (clarification.questions ?? []).map((item) => String(item).slice(0, 200)).slice(0, 3),
      missing: (clarification.missing ?? []).map((item) => String(item).slice(0, 64)).slice(0, 6),
    },
  };
}

export function searchQueryHash(query: SearchQuery): string {
  const canonical = {
    marketplace: query.marketplace,
    intent: query.intent,
    category: query.category,
    operation: query.operation,
    keywords: normalizeQueryText(query.keywords),
    filters: query.filters,
    price: query.price
      ? {
          min: query.price.min ?? null,
          max: query.price.max ?? null,
          currency: query.price.currency,
        }
      : null,
    location: query.location
      ? {
          countryId: query.location.countryId ?? null,
          cityId: query.location.cityId ?? null,
          areaId: query.location.areaId ?? null,
          radiusKm: query.location.radiusKm ?? null,
          lat: query.location.lat ?? null,
          lng: query.location.lng ?? null,
        }
      : null,
    sort: query.sort,
  };
  return JSON.stringify(canonical);
}

export function isPersonalizedQuery(query: SearchQuery, viewerId: number | null): boolean {
  return viewerId !== null && Object.keys(query.preferences).length > 0;
}

export const executeSearchBodySchema = z.object({
  q: z.string().trim().min(1).max(MAX_QUERY_CHARS).optional(),
  marketplace: z.enum(MARKETPLACE_CODES).nullable().optional(),
  searchType: z.enum(SEARCH_TYPES).optional(),
  useAi: z.coerce.boolean().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(0.1).max(MAX_RADIUS_KM).optional(),
  sort: z.string().max(48).optional(),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).optional(),
  perPage: z.coerce.number().int().min(1).max(MAX_PER_PAGE).optional(),
  cursor: z.string().max(512).optional(),
  dsl: z.record(z.string(), z.unknown()).optional(),
  cityId: z.coerce.number().int().positive().optional(),
  regionId: z.coerce.number().int().positive().optional(),
  countryId: z.coerce.number().int().positive().optional(),
});

export const getSearchQuerySchema = z.object({
  q: z.string().trim().max(MAX_QUERY_CHARS).optional(),
  marketplace: z.enum(MARKETPLACE_CODES).optional(),
  marketplaceId: z.coerce.number().int().positive().optional(),
  searchType: z.enum(SEARCH_TYPES).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(0.1).max(MAX_RADIUS_KM).optional(),
  sort: z.string().max(48).optional(),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
  perPage: z.coerce.number().int().min(1).max(MAX_PER_PAGE).default(24),
  cursor: z.string().max(512).optional(),
  cityId: z.coerce.number().int().positive().optional(),
  useAi: z.coerce.boolean().optional(),
});

export type ExecuteSearchBody = z.infer<typeof executeSearchBodySchema>;
export type GetSearchQuery = z.infer<typeof getSearchQuerySchema>;
