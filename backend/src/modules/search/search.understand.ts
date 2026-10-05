/**
 * Query understanding. Produces a Search DSL draft. Never talks to SQL.
 * AI output, when used, is merged then validated by search.dsl.
 */

import type { SearchInterpretation } from '../../providers/ai/types';
import {
  emptySearchQuery,
  type FilterKey,
  type MarketplaceCode,
  type SearchQuery,
  type SearchQueryDraft,
  type SearchType,
} from './search.dsl';
import { parsePriceRange, parseWeightGrams } from './search.currency';
import {
  detectLanguageHint,
  detectMarketplaces,
  firstMatchingRule,
  GOLD_FORMS,
  looksLikePartsQuery,
  OPERATION_ALIASES,
  PREFERENCE_PATTERNS,
  PROPERTY_KINDS,
  SOFT_MODIFIERS,
  VEHICLE_MAKES,
  VEHICLE_MODELS,
  VEHICLE_TYPES,
} from './search.taxonomy';

export interface UnderstandContext {
  language: string;
  currency: string;
  countryCode: string;
  marketplaceCode: MarketplaceCode | null;
  searchType: SearchType;
}

export interface UnderstoodSearch {
  queries: SearchQuery[];
  language: string;
  confidence: number;
  usedAi: boolean;
}

const PROPERTY_NEEDS_OPERATION = /\b(house|home|flat|apartment|villa|plot|ghar|makan)\b/i;
const HAS_OPERATION = /\b(rent|rental|kiraya|sale|sell|buy|wanted|auction|for sale|for rent)\b/i;

function rewriteKeywords(text: string): string {
  return text
    .replace(/\b(under|below|above|over|between|from|to|less than|more than|se kam|mein|chahiye)\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:k|m|lakh|lac|crore|cr|million|thousand|g|gram|grams|tola)?\b/gi, ' ')
    .replace(/\b(bed|bedroom|bedrooms|bath|bathroom|karat|carat|k|automatic|manual|for sale|for rent|buy|sell|rent)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyPreferences(text: string, query: SearchQuery): void {
  for (const rule of PREFERENCE_PATTERNS) {
    if (rule.pattern.test(text)) query.preferences[rule.key] = true;
  }
}

function extractOperation(text: string): SearchQuery['operation'] {
  for (const rule of OPERATION_ALIASES) {
    if (rule.aliases.some((alias) => text.toLowerCase().includes(alias))) return rule.value;
  }
  return null;
}

function understandSegment(raw: string, ctx: UnderstandContext, forcedMarketplace: MarketplaceCode | null): SearchQuery {
  const text = raw.trim();
  const query = emptySearchQuery({
    originalQuery: text,
    language: detectLanguageHint(text) ?? ctx.language,
    searchType: ctx.searchType,
    marketplace: forcedMarketplace ?? ctx.marketplaceCode,
    intent: ctx.searchType === 'global' ? 'search' : 'search',
  });

  const detected = detectMarketplaces(text);
  if (!query.marketplace) {
    query.marketplace = detected[0] ?? null;
  }

  if (looksLikePartsQuery(text)) {
    query.intent = 'parts';
    query.marketplace = 'vehicles';
    query.filters.partCategory = 'parts';
  }

  query.operation = extractOperation(text);
  if (query.operation === 'rent') query.intent = 'rent';
  if (query.operation === 'buy' || query.operation === 'sell') query.intent = query.operation;

  const price = parsePriceRange(text, ctx.currency, ctx.countryCode);
  if (price) {
    query.price = {
      min: price.min,
      max: price.max,
      currency: price.currency,
      originalAmount: price.originalAmount,
      originalCurrency: price.originalCurrency,
    };
  }

  applyPreferences(text, query);

  const mp = query.marketplace;
  if (mp === 'gold' || (!mp && detected.includes('gold'))) {
    query.marketplace = 'gold';
    const karat = text.match(/(\d{1,2})\s*(?:k|karat|carat)\b/i);
    if (karat?.[1]) query.filters.karat = karat[1];
    const grams = parseWeightGrams(text);
    if (grams !== null) {
      query.filters.weightMin = grams;
      query.filters.weightMax = grams;
    }
    const form = firstMatchingRule(text, GOLD_FORMS);
    if (form === 'ring' || form === 'bangle' || form === 'necklace' || form === 'earring') {
      query.filters.jewelleryType = form;
      query.filters.form = 'jewellery';
    } else if (form) {
      query.filters.form = form;
    }
    if (/\bhallmark/i.test(text)) query.filters.hallmarked = true;
    if (/\bcertif/i.test(text)) query.filters.certified = true;
    if (/\bscrap\b/i.test(text)) query.filters.scrap = true;
    if (/\bantique\b/i.test(text)) query.filters.antique = true;
    if (/\binvestment\b/i.test(text)) query.filters.investmentGrade = true;
  }

  if (mp === 'property' || (!mp && detected.includes('property'))) {
    query.marketplace = query.marketplace ?? 'property';
    const kind = firstMatchingRule(text, PROPERTY_KINDS);
    if (kind) query.filters.propertyKind = kind;
    const beds = text.match(/(\d+)\s*(?:bed|beds|bedroom|bedrooms|br|bhk)\b/i);
    if (beds) query.filters.bedroomsMin = Number(beds[1]);
    const baths = text.match(/(\d+)\s*(?:bath|baths|bathroom|bathrooms)\b/i);
    if (baths) query.filters.bathroomsMin = Number(baths[1]);
    if (/\bfurnished\b/i.test(text)) query.filters.furnishing = 'furnished';
    if (/\bparking\b/i.test(text)) query.filters.parkingMin = 1;
    if (/\b(pool|swimming)\b/i.test(text)) query.filters.swimmingPool = true;
    if (/\bgym\b/i.test(text)) query.filters.gym = true;
    if (/\bgarden\b/i.test(text)) query.filters.garden = true;
    if (/\bbalcony\b/i.test(text)) query.filters.balcony = true;
  }

  if (mp === 'vehicles' || (!mp && detected.includes('vehicles'))) {
    query.marketplace = query.marketplace ?? 'vehicles';
    const type = firstMatchingRule(text, VEHICLE_TYPES);
    if (type) query.filters.vehicleType = type;
    const make = firstMatchingRule(text, VEHICLE_MAKES);
    if (make) query.filters.make = make;
    const model = firstMatchingRule(text, VEHICLE_MODELS);
    if (model) query.filters.model = model;
    if (/\bautomatic\b/i.test(text)) query.filters.transmission = 'automatic';
    else if (/\bmanual\b/i.test(text)) query.filters.transmission = 'manual';
    else if (/\bcvt\b/i.test(text)) query.filters.transmission = 'cvt';
    for (const fuel of ['petrol', 'diesel', 'hybrid', 'electric', 'cng', 'lpg']) {
      if (new RegExp(`\\b${fuel}\\b`, 'i').test(text)) query.filters.fuelType = fuel;
    }
    const year = text.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
    if (year) {
      query.filters.yearMin = Number(year[1]);
      query.filters.yearMax = Number(year[1]) + 1;
    }
    const km = text.match(/(\d+)\s*(?:k\s*)?km/i);
    if (km && !SOFT_MODIFIERS.test(text)) {
      query.filters.mileageMax = Number(km[1]) * (/k\s*km/i.test(text) ? 1000 : 1);
    }
  }

  const inCity = text.match(/\b(?:in|near|mein|me|mai|فی)\s+([A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF\s]{1,40})$/i);
  if (inCity?.[1]) {
    query.location = { cityName: inCity[1].trim() };
  } else {
    const known = text.match(
      /\b(Islamabad|Lahore|Karachi|Rawalpindi|Peshawar|Quetta|Multan|Faisalabad|Dubai|Riyadh|Jeddah|London|Toronto|Sydney)\b/i,
    );
    if (known?.[1]) query.location = { cityName: known[1] };
  }

  if (ctx.searchType === 'nearby') {
    query.location = { ...(query.location ?? {}), radiusKm: query.location?.radiusKm ?? 10 };
  }

  query.keywords = rewriteKeywords(text);
  query.semanticQuery = text;

  if (
    (query.marketplace === 'property' || PROPERTY_NEEDS_OPERATION.test(text)) &&
    !query.operation &&
    !HAS_OPERATION.test(text) &&
    !ctx.marketplaceCode
  ) {
    query.clarification = {
      needed: true,
      questions: ['Would you like to buy or rent?'],
      missing: ['operation'],
    };
  }

  if (ctx.marketplaceCode === 'property' && !query.operation && PROPERTY_NEEDS_OPERATION.test(text) && !HAS_OPERATION.test(text)) {
    query.clarification = {
      needed: true,
      questions: ['Would you like to buy or rent?'],
      missing: ['operation'],
    };
  }

  return query;
}

function splitGlobalSegments(raw: string): string[] {
  const parts = raw
    .split(/\s*(?:,|\/|&|\band\b|\baur\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 1);
  return parts.length > 1 ? parts : [raw.trim()];
}

export function understandQuery(raw: string, ctx: UnderstandContext): UnderstoodSearch {
  const text = raw.trim().slice(0, 500);
  const language = detectLanguageHint(text) ?? ctx.language;
  const isGlobal = ctx.searchType === 'global' || !ctx.marketplaceCode;
  const segments = isGlobal ? splitGlobalSegments(text) : [text];

  const queries: SearchQuery[] = [];
  if (isGlobal && segments.length > 1) {
    for (const segment of segments) {
      const detected = detectMarketplaces(segment);
      queries.push(understandSegment(segment, { ...ctx, searchType: 'global' }, detected[0] ?? null));
    }
    const distinct = new Set(queries.map((query) => query.marketplace).filter(Boolean));
    if (distinct.size < 2) {
      queries.splice(0, queries.length, understandSegment(text, ctx, ctx.marketplaceCode));
    }
  } else {
    queries.push(understandSegment(text, ctx, ctx.marketplaceCode));
  }

  const confidence = Math.min(
    92,
    20 +
      queries.reduce((sum, query) => {
        return sum + Object.keys(query.filters).length * 8 + (query.marketplace ? 12 : 0) + (query.price ? 10 : 0);
      }, 0),
  );

  return { queries, language, confidence, usedAi: false };
}

export function mergeAiInterpretation(base: SearchQuery, ai: SearchInterpretation, allowedMarketplaces: string[]): SearchQuery {
  const next: SearchQuery = { ...base, filters: { ...base.filters }, preferences: { ...base.preferences } };
  if (ai.marketplaceCode && allowedMarketplaces.includes(ai.marketplaceCode) && !next.marketplace) {
    next.marketplace = ai.marketplaceCode as MarketplaceCode;
  }
  if (ai.categoryHint && !next.category) next.category = ai.categoryHint;
  if (ai.intent === 'rent' && !next.operation) {
    next.operation = 'rent';
    next.intent = 'rent';
  }
  if ((ai.intent === 'buy' || ai.intent === 'sell') && !next.operation) {
    next.operation = ai.intent;
    next.intent = ai.intent;
  }
  if (ai.priceRange && !next.price) {
    const currency = base.price?.currency ?? 'USD';
    next.price = {
      min: ai.priceRange.min,
      max: ai.priceRange.max,
      currency,
      originalAmount: ai.priceRange.max ?? ai.priceRange.min,
      originalCurrency: currency,
    };
  }
  if (ai.location && !next.location) {
    next.location = {
      cityName: ai.location.city,
      countryCode: ai.location.country,
      radiusKm: ai.location.radiusKm,
    };
  }
  if (ai.filters) {
    for (const [key, value] of Object.entries(ai.filters)) {
      if (next.filters[key as FilterKey] === undefined && value !== undefined && value !== null) {
        (next.filters as Record<string, unknown>)[key] = value;
      }
    }
  }
  if (ai.rewrittenQuery && !next.keywords) next.keywords = ai.rewrittenQuery;
  return next;
}

export function draftFromQuery(query: SearchQuery): SearchQueryDraft {
  return query;
}
