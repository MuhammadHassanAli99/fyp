import { queryOne, type Row } from '../../db/query';
import { sha256 } from '../../core/security/crypto';
import { convertAmount } from '../locale/fx.service';
import { env } from '../../config/env';
import type { ListingCard } from '../listings/listings.repository';
import { wrapUntrusted } from '../ai/ai.security';
import { throughGateway } from '../ai/ai.gateway';
import { orchestrate } from '../ai/ai.orchestrator';
import { persistSearchInterpretation } from '../ai/ai.capabilities';
import type { AiDriver, SearchInterpretation } from '../../providers/ai/types';
import {
  emptySearchQuery,
  getSearchQuerySchema,
  searchQueryHash,
  validateSearchQuery,
  type ExecuteSearchBody,
  type GetSearchQuery,
  type MarketplaceCode,
  type SearchQuery,
  type SearchType,
} from './search.dsl';
import { understandQuery, mergeAiInterpretation } from './search.understand';
import { extractCityHint, listKnownCityNames, resolveLocationName } from './search.location';
import { retrieveAndRank, type EngineResult } from './search.engine';
import { explainResults } from './search.explain';
import { zeroResultHelp } from './search.zero';
import { cacheKeyFor, getCachedSearch, setCachedSearch } from './search.cache';
import { recordSearchHistory } from './search.recent';
import { trackSearchEvent } from './search.analytics';
import { ingestVoiceSearch } from './search.voice';
import { ingestImageSearch } from './search.image';
import type { RankableHit } from './search.rank';
import { computeFacets } from '../filters/filters.facets';
import type { FacetGroup } from '../filters/filters.types';
import type { PartHit } from './search.parts';
import type { ServedAd } from '../ads/ads.service';
import { contextualAdsForSearch } from '../ads/ads.contextual';

export {
  listRecentSearches,
  deleteRecentSearch,
  clearRecentSearches,
} from './search.recent';
export {
  listSavedSearches,
  saveSearch,
  updateSavedSearch,
  deleteSavedSearch,
} from './search.saved';
export { listTrendingSearches } from './search.trending';
export { suggest } from './search.suggestions';
export { getSearchQuerySchema, executeSearchBodySchema } from './search.dsl';

/** Back-compat for the previous GET /search query schema name. */
export { getSearchQuerySchema as searchQuerySchema };

export interface SearchRequestContext {
  language: string;
  currency: string;
  countryCode: string;
  countryId: number | null;
  marketplaceId: number | null;
  marketplaceCode: string | null;
  viewerId: number | null;
  guestUuid: string | null;
}

export interface SearchHitPayload {
  listing: ListingCard;
  marketplace: string;
  score: number;
  organicScore: number;
  placement: 'organic' | 'sponsored';
  distanceKm: number | null;
  matchReasons: string[];
}

export interface SearchResponse {
  items: SearchHitPayload[];
  groups?: Record<string, SearchHitPayload[]>;
  parts: PartHit[];
  total: number;
  page: number;
  perPage: number;
  dsl: SearchQuery | SearchQuery[];
  clarification: SearchQuery['clarification'] | null;
  explanation: string | null;
  zeroResult: { message: string; suggestions: string[] } | null;
  disclaimer?: string;
  facets: FacetGroup[];
  /** Sibling of organic hits — never mixed into organicScore. */
  contextualAds: ServedAd[];
}

async function marketplaceId(code: string | null): Promise<number | null> {
  if (!code) return null;
  const row = await queryOne<Row>('SELECT id FROM marketplaces WHERE code = ?', [code]);
  return row ? Number(row.id) : null;
}

async function enrichLocation(query: SearchQuery, countryId: number | null): Promise<SearchQuery> {
  if (!query.location?.cityName || query.location.cityId) return query;
  const resolved = await resolveLocationName(query.location.cityName, query.location.countryId ?? countryId);
  if (!resolved) return query;
  return { ...query, location: { ...query.location, ...resolved } };
}

async function enrichFx(query: SearchQuery): Promise<SearchQuery> {
  if (!query.price) return query;
  const from = query.price.originalCurrency ?? query.price.currency;
  const convertedMax =
    query.price.max !== undefined ? await convertAmount(query.price.max, from, env.BASE_CURRENCY) : null;
  const convertedMin =
    query.price.min !== undefined ? await convertAmount(query.price.min, from, env.BASE_CURRENCY) : null;
  return {
    ...query,
    price: {
      ...query.price,
      fxRate: convertedMax?.rate ?? convertedMin?.rate ?? null,
      fxAt: convertedMax?.asOf ?? convertedMin?.asOf ?? null,
      maxBase: convertedMax?.amount ?? query.price.maxBase,
      minBase: convertedMin?.amount ?? query.price.minBase,
    },
  };
}

function toHits(result: EngineResult): SearchHitPayload[] {
  return result.hits
    .map((hit) => {
      const listing = hit.card as ListingCard | undefined;
      if (!listing) return null;
      return {
        listing,
        marketplace: hit.marketplaceCode,
        score: hit.finalScore,
        organicScore: hit.organicScore,
        placement: hit.placement,
        distanceKm: hit.distanceKm,
        matchReasons: hit.matchReasons,
      };
    })
    .filter((item): item is SearchHitPayload => item !== null);
}

async function runOne(query: SearchQuery, ctx: SearchRequestContext): Promise<EngineResult> {
  const located = await enrichLocation(query, ctx.countryId);
  const withFx = await enrichFx(located);
  return retrieveAndRank(withFx, {
    language: ctx.language,
    currency: ctx.currency,
    countryId: ctx.countryId,
    viewerId: ctx.viewerId,
  });
}

export async function executeSearch(
  input: {
    q?: string;
    searchType?: SearchType;
    useAi?: boolean;
    lat?: number;
    lng?: number;
    radiusKm?: number;
    sort?: string;
    page?: number;
    perPage?: number;
    marketplace?: MarketplaceCode | null;
    dsl?: Record<string, unknown>;
    cityId?: number;
  },
  ctx: SearchRequestContext,
): Promise<SearchResponse> {
  const marketplaceCode = (input.marketplace ?? ctx.marketplaceCode) as MarketplaceCode | null;
  const searchType: SearchType =
    input.searchType ?? (marketplaceCode ? 'text' : 'global');

  let understood = understandQuery(input.q ?? '', {
    language: ctx.language,
    currency: ctx.currency,
    countryCode: ctx.countryCode,
    marketplaceCode: searchType === 'global' ? null : marketplaceCode,
    searchType,
  });

  if ((!input.q || input.q.trim().length === 0) && input.dsl) {
    understood = {
      queries: [
        validateSearchQuery(
          { ...emptySearchQuery(), ...input.dsl, originalQuery: String(input.dsl.originalQuery ?? '') },
          { currency: ctx.currency, language: ctx.language, countryCode: ctx.countryCode },
        ),
      ],
      language: ctx.language,
      confidence: 80,
      usedAi: false,
    };
  }

  if (input.q && (input.useAi || searchType === 'ai' || (input.q.split(/\s+/).length >= 8 && understood.confidence < 55))) {
    const interpretation = await interpretSearchViaPlatform(input.q, ctx);
    if (interpretation) {
      understood = {
        ...understood,
        usedAi: true,
        queries: understood.queries.map((query) =>
          validateSearchQuery(mergeAiInterpretation(query, interpretation, ['gold', 'property', 'vehicles']), {
            currency: ctx.currency,
            language: ctx.language,
            countryCode: ctx.countryCode,
          }),
        ),
      };
    }
  }

  const cities = await listKnownCityNames(ctx.countryId).catch(() => [] as string[]);
  const queries = understood.queries.map((query) => {
    const next = validateSearchQuery(
      {
        ...query,
        sort: input.sort ?? query.sort,
        pagination: {
          page: input.page ?? query.pagination.page,
          perPage: input.perPage ?? query.pagination.perPage,
        },
        searchType,
        location: {
          ...(query.location ?? {}),
          lat: input.lat ?? query.location?.lat,
          lng: input.lng ?? query.location?.lng,
          radiusKm: input.radiusKm ?? query.location?.radiusKm,
          cityId: input.cityId ?? query.location?.cityId,
          cityName: query.location?.cityName ?? (input.q ? extractCityHint(input.q, cities) ?? undefined : undefined),
        },
      },
      { currency: ctx.currency, language: ctx.language, countryCode: ctx.countryCode },
    );
    return next;
  });

  const clarification = queries.find((query) => query.clarification.needed)?.clarification ?? null;
  if (clarification?.needed && queries.every((query) => query.clarification.needed)) {
    return {
      items: [],
      parts: [],
      total: 0,
      page: input.page ?? 1,
      perPage: input.perPage ?? 24,
      dsl: queries.length === 1 ? queries[0]! : queries,
      clarification,
      explanation: null,
      zeroResult: null,
      facets: [],
      contextualAds: [],
    };
  }

  const primary = queries[0]!;
  const personalized = ctx.viewerId !== null;
  const cacheKey = cacheKeyFor(primary, ctx.countryId);
  if (!personalized && queries.length === 1 && searchType !== 'nearby') {
    const cached = await getCachedSearch<SearchResponse>(cacheKey);
    if (cached) return cached;
  }

  const grouped: Record<string, SearchHitPayload[]> = { gold: [], property: [], vehicles: [] };
  let parts: PartHit[] = [];
  let items: SearchHitPayload[] = [];
  let total = 0;
  let explanationSource: RankableHit[] = [];

  if (searchType === 'global' || queries.length > 1) {
    for (const query of queries) {
      const result = await runOne({ ...query, pagination: { ...query.pagination, perPage: Math.min(query.pagination.perPage, 8) } }, ctx);
      const hits = toHits(result);
      const key = query.marketplace ?? 'gold';
      grouped[key] = hits;
      items.push(...hits);
      parts = parts.concat(result.parts);
      total += result.total;
      explanationSource = explanationSource.concat(result.hits);
    }
  } else {
    const result = await runOne(primary, ctx);
    items = toHits(result);
    parts = result.parts;
    total = result.total || parts.length;
    explanationSource = result.hits;
    if (primary.marketplace) grouped[primary.marketplace] = items;
  }

  const facets = await computeFacets(primary).catch(() => [] as FacetGroup[]);
  const zero = items.length === 0 && parts.length === 0 ? zeroResultHelp(primary) : null;
  const mpId = (await marketplaceId(primary.marketplace)) ?? ctx.marketplaceId;
  const contextualAds = await contextualAdsForSearch({
    marketplaceId: mpId,
    countryId: ctx.countryId,
    cityId: primary.location?.cityId ?? null,
    platform: null,
    language: ctx.language,
    categoryId: null,
    keywords: String(input.q ?? primary.originalQuery ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 8),
    userId: ctx.viewerId,
  }).catch(() => [] as ServedAd[]);

  const response: SearchResponse = {
    items,
    groups: searchType === 'global' || queries.length > 1 ? grouped : undefined,
    parts,
    total,
    page: primary.pagination.page,
    perPage: primary.pagination.perPage,
    dsl: queries.length === 1 ? primary : queries,
    clarification,
    explanation: explainResults(primary, explanationSource),
    zeroResult: zero,
    facets,
    contextualAds,
  };
  await trackSearchEvent({
    eventType: 'search',
    userId: ctx.viewerId,
    guestUuid: ctx.guestUuid,
    marketplaceId: mpId,
    queryHash: sha256(searchQueryHash(primary)),
    metadata: { query: input.q ?? primary.originalQuery, searchType },
    countryId: ctx.countryId,
    cityId: primary.location?.cityId ?? null,
  });
  await recordSearchHistory({
    userId: ctx.viewerId,
    guestUuid: ctx.guestUuid,
    marketplaceId: mpId,
    query: input.q ?? primary.originalQuery,
    searchType,
    filters: primary.filters,
    dsl: primary as unknown as Record<string, unknown>,
    resultCount: total,
    countryId: ctx.countryId,
    language: ctx.language,
  });
  await trackSearchEvent({
    eventType: total === 0 ? 'search_zero_result' : 'search_success',
    userId: ctx.viewerId,
    guestUuid: ctx.guestUuid,
    marketplaceId: mpId,
    queryHash: sha256(searchQueryHash(primary)),
    metadata: { query: input.q ?? primary.originalQuery, searchType, resultCount: total },
    countryId: ctx.countryId,
    cityId: primary.location?.cityId ?? null,
  });

  if (!personalized && queries.length === 1) {
    await setCachedSearch(cacheKey, response, mpId, ctx.countryId);
  }

  return response;
}

export async function textSearch(params: {
  query: string;
  marketplaceId: number | null;
  marketplaceCode: string | null;
  countryId: number | null;
  language: string;
  currency: string;
  viewerId: number | null;
  guestUuid: string | null;
  page: number;
  perPage: number;
  filters?: Record<string, unknown>;
  countryCode?: string;
  searchType?: SearchType;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  sort?: string;
  useAi?: boolean;
}) {
  return executeSearch(
    {
      q: params.query,
      marketplace: params.marketplaceCode as MarketplaceCode | null,
      page: params.page,
      perPage: params.perPage,
      searchType: params.searchType,
      lat: params.lat,
      lng: params.lng,
      radiusKm: params.radiusKm,
      sort: params.sort,
      useAi: params.useAi,
      dsl: params.filters,
    },
    {
      language: params.language,
      currency: params.currency,
      countryCode: params.countryCode ?? 'PK',
      countryId: params.countryId,
      marketplaceId: params.marketplaceId,
      marketplaceCode: params.marketplaceCode,
      viewerId: params.viewerId,
      guestUuid: params.guestUuid,
    },
  );
}

export async function voiceSearch(
  input: { audioUrl?: string; transcript?: string; durationMs?: number; language?: string },
  ctx: SearchRequestContext,
) {
  const voice = await ingestVoiceSearch({
    userId: ctx.viewerId,
    audioUrl: input.audioUrl,
    transcript: input.transcript,
    durationMs: input.durationMs,
    language: input.language,
  });
  if (!voice.transcript) {
    return {
      voice,
      results: null as SearchResponse | null,
      error: 'Speech could not be transcribed. Type the search instead.',
    };
  }
  const results = await executeSearch({ q: voice.transcript, searchType: 'voice', useAi: true }, { ...ctx, language: voice.language });
  return { voice, results, error: null };
}

export async function imageSearch(input: { imageUrl: string }, ctx: SearchRequestContext) {
  const image = await ingestImageSearch({ userId: ctx.viewerId, imageUrl: input.imageUrl });
  const results = await executeSearch(
    { q: image.dsl.originalQuery || image.labels.join(' '), searchType: 'image', dsl: image.dsl as unknown as Record<string, unknown> },
    ctx,
  );
  return { ...image, results, disclaimer: image.disclaimer };
}

export function parseGetSearch(query: GetSearchQuery) {
  return query;
}

const MARKETPLACES = [
  { id: 1, code: 'gold', name: 'Gold' },
  { id: 2, code: 'property', name: 'Property' },
  { id: 3, code: 'vehicles', name: 'Vehicles' },
];

async function interpretSearchViaPlatform(
  query: string,
  ctx: SearchRequestContext,
): Promise<SearchInterpretation | null> {
  const run = (driver: AiDriver) =>
    driver.interpretSearch({
      query: wrapUntrusted('search_query', query),
      language: ctx.language,
      currency: ctx.currency,
      countryCode: ctx.countryCode,
      marketplaces: MARKETPLACES,
    });
  try {
    const gated = ctx.viewerId
      ? await throughGateway({ userId: ctx.viewerId }, { task: 'smart_search', input: { query }, run })
      : await orchestrate({ task: 'smart_search', input: { query }, skipEntitlement: true, skipQuota: true }, run);
    if ('accepted' in gated) return null;
    await persistSearchInterpretation({
      query,
      language: ctx.language,
      interpretation: gated.result as unknown as Record<string, unknown>,
      userId: ctx.viewerId,
    });
    return gated.result;
  } catch {
    return null;
  }
}

export type { ExecuteSearchBody, GetSearchQuery };
