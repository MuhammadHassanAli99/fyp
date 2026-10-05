import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok, noContent, page } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { resolveMarketplace } from '../../middleware/request-context';
import { searchRateLimit, writeRateLimit, aiRateLimit } from '../../middleware/rate-limit';
import {
  clearRecentSearches,
  deleteRecentSearch,
  deleteSavedSearch,
  executeSearch,
  executeSearchBodySchema,
  getSearchQuerySchema,
  imageSearch,
  listRecentSearches,
  listSavedSearches,
  listTrendingSearches,
  saveSearch,
  suggest,
  updateSavedSearch,
  voiceSearch,
  type SearchRequestContext,
  type SearchHitPayload,
} from './search.service';
import { trackSearchEvent, markSearchClick } from './search.analytics';

export const searchRouter = Router();

searchRouter.use(authenticate);

function ctx(req: Request): SearchRequestContext {
  return {
    language: req.context.language,
    currency: req.context.currency,
    countryCode: req.context.countryCode,
    countryId: req.context.countryId,
    marketplaceId: req.marketplaceId ?? null,
    marketplaceCode: req.marketplaceCode ?? null,
    viewerId: req.auth?.userId ?? null,
    guestUuid: req.guestUuid ?? null,
  };
}

function flattenHit(hit: SearchHitPayload) {
  return {
    ...hit.listing,
    marketplace: hit.marketplace,
    placement: hit.placement,
    organicScore: hit.organicScore,
    score: hit.score,
    distanceKm: hit.distanceKm,
    matchReasons: hit.matchReasons,
  };
}

function present(result: Awaited<ReturnType<typeof executeSearch>>) {
  const items = result.items.map(flattenHit);
  const groups = result.groups
    ? Object.fromEntries(
        Object.entries(result.groups).map(([key, hits]) => [key, hits.map(flattenHit)]),
      )
    : undefined;
  return {
    items,
    total: result.total,
    page: result.page,
    perPage: result.perPage,
    groups,
    parts: result.parts,
    dsl: result.dsl,
    clarification: result.clarification,
    explanation: result.explanation,
    zeroResult: result.zeroResult,
    facets: result.facets,
  };
}

searchRouter.get(
  '/',
  resolveMarketplace,
  searchRateLimit,
  validate({ query: getSearchQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof getSearchQuerySchema>>(req);
    const result = await executeSearch(
      {
        q: q.q,
        marketplace: q.marketplace,
        searchType: q.searchType ?? (q.lat !== undefined ? 'nearby' : q.marketplace ? 'text' : 'global'),
        lat: q.lat,
        lng: q.lng,
        radiusKm: q.radiusKm,
        sort: q.sort,
        page: q.page,
        perPage: q.perPage,
        cityId: q.cityId,
        useAi: q.useAi,
      },
      ctx(req),
    );
    const presented = present(result);
    return page(res, presented, {
      dsl: presented.dsl,
      clarification: presented.clarification,
      explanation: presented.explanation,
      zeroResult: presented.zeroResult,
      groups: presented.groups,
      parts: presented.parts,
      facets: presented.facets,
    });
  }),
);

searchRouter.post(
  '/',
  resolveMarketplace,
  searchRateLimit,
  validate({ body: executeSearchBodySchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof executeSearchBodySchema>>(req);
    const result = await executeSearch(
      {
        q: input.q,
        marketplace: input.marketplace,
        searchType: input.searchType,
        useAi: input.useAi,
        lat: input.lat,
        lng: input.lng,
        radiusKm: input.radiusKm,
        sort: input.sort,
        page: input.page,
        perPage: input.perPage,
        dsl: input.dsl,
        cityId: input.cityId,
      },
      ctx(req),
    );
    return ok(res, present(result));
  }),
);

searchRouter.get(
  '/suggest',
  resolveMarketplace,
  searchRateLimit,
  validate({
    query: z.object({
      q: z.string().trim().min(1).max(64),
      limit: z.coerce.number().int().min(1).max(20).default(10),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ q: string; limit: number }>(req);
    return ok(
      res,
      await suggest({
        prefix: q.q,
        marketplaceId: req.marketplaceId ?? null,
        userId: req.auth?.userId ?? null,
        guestUuid: req.guestUuid ?? null,
        limit: q.limit,
      }),
    );
  }),
);

searchRouter.get(
  '/recent',
  asyncHandler(async (req, res) =>
    ok(res, await listRecentSearches(req.auth?.userId ?? null, req.guestUuid, 15)),
  ),
);

searchRouter.delete(
  '/recent',
  asyncHandler(async (req, res) => {
    await clearRecentSearches(req.auth?.userId ?? null, req.guestUuid);
    return noContent(res);
  }),
);

searchRouter.delete(
  '/recent/:id',
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    await deleteRecentSearch(req.auth?.userId ?? null, req.guestUuid, params<{ id: number }>(req).id);
    return noContent(res);
  }),
);

searchRouter.get(
  '/trending',
  resolveMarketplace,
  validate({
    query: z.object({
      marketplaceId: z.coerce.number().int().positive().optional(),
      period: z.enum(['hour', 'day', 'week', 'month']).optional(),
      limit: z.coerce.number().int().min(1).max(30).default(10),
      cityId: z.coerce.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{
      marketplaceId?: number;
      period?: 'hour' | 'day' | 'week' | 'month';
      limit: number;
      cityId?: number;
    }>(req);
    return ok(
      res,
      await listTrendingSearches({
        marketplaceId: q.marketplaceId ?? req.marketplaceId ?? null,
        countryId: req.context.countryId,
        cityId: q.cityId ?? null,
        period: q.period,
        limit: q.limit,
      }),
    );
  }),
);

searchRouter.get(
  '/saved',
  requireAuth,
  asyncHandler(async (req, res) => ok(res, await listSavedSearches(req.auth!.userId))),
);

searchRouter.post(
  '/saved',
  requireAuth,
  writeRateLimit,
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(128),
      marketplaceId: z.coerce.number().int().positive().optional(),
      query: z.record(z.string(), z.unknown()),
      originalQuery: z.string().max(500).optional(),
      sortKey: z.string().max(48).optional(),
      alertChannel: z.enum(['none', 'push', 'email', 'sms', 'all']).optional(),
      alertFrequency: z.enum(['instant', 'daily', 'weekly', 'never']).optional(),
      resultCount: z.coerce.number().int().min(0).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      name: string;
      marketplaceId?: number;
      query: Record<string, unknown>;
      originalQuery?: string;
      sortKey?: string;
      alertChannel?: 'none' | 'push' | 'email' | 'sms' | 'all';
      alertFrequency?: 'instant' | 'daily' | 'weekly' | 'never';
      resultCount?: number;
    }>(req);
    return created(res, await saveSearch(req.auth!.userId, { ...input, language: req.context.language }));
  }),
);

searchRouter.patch(
  '/saved/:id',
  requireAuth,
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({
      name: z.string().trim().min(1).max(128).optional(),
      query: z.record(z.string(), z.unknown()).optional(),
      originalQuery: z.string().max(500).optional(),
      alertChannel: z.enum(['none', 'push', 'email', 'sms', 'all']).optional(),
      alertFrequency: z.enum(['instant', 'daily', 'weekly', 'never']).optional(),
      isActive: z.coerce.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const updated = await updateSavedSearch(req.auth!.userId, params<{ id: number }>(req).id, body(req));
    return ok(res, updated);
  }),
);

searchRouter.delete(
  '/saved/:id',
  requireAuth,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    await deleteSavedSearch(req.auth!.userId, params<{ id: number }>(req).id);
    return noContent(res);
  }),
);

searchRouter.post(
  '/voice',
  resolveMarketplace,
  aiRateLimit,
  validate({
    body: z.object({
      audioUrl: z.string().url().max(512).optional(),
      transcript: z.string().trim().max(500).optional(),
      durationMs: z.coerce.number().int().positive().max(120_000).optional(),
      language: z.string().max(10).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ audioUrl?: string; transcript?: string; durationMs?: number; language?: string }>(req);
    const result = await voiceSearch(input, ctx(req));
    return ok(res, {
      voice: result.voice,
      error: result.error,
      results: result.results ? present(result.results) : null,
    });
  }),
);

searchRouter.post(
  '/image',
  resolveMarketplace,
  aiRateLimit,
  validate({
    body: z.object({
      imageUrl: z.string().url().max(512),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ imageUrl: string }>(req);
    const result = await imageSearch(input, ctx(req));
    return ok(res, {
      id: result.id,
      labels: result.labels,
      marketplaceCode: result.marketplaceCode,
      disclaimer: result.disclaimer,
      results: present(result.results),
    });
  }),
);

searchRouter.post(
  '/events',
  searchRateLimit,
  validate({
    body: z.object({
      eventType: z.enum([
        'impression', 'click', 'favorite', 'contact', 'call', 'message', 'share', 'conversion',
      ]),
      listingId: z.coerce.number().int().positive().optional(),
      position: z.coerce.number().int().min(0).max(100).optional(),
      query: z.string().max(255).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      eventType: 'impression' | 'click' | 'favorite' | 'contact' | 'call' | 'message' | 'share' | 'conversion';
      listingId?: number;
      position?: number;
      query?: string;
    }>(req);
    await trackSearchEvent({
      eventType: input.eventType,
      userId: req.auth?.userId ?? null,
      guestUuid: req.guestUuid ?? null,
      marketplaceId: req.marketplaceId ?? null,
      listingId: input.listingId ?? null,
      position: input.position ?? null,
      metadata: { query: input.query },
      countryId: req.context.countryId,
    });
    if (input.eventType === 'click' && input.listingId) {
      await markSearchClick({
        userId: req.auth?.userId ?? null,
        guestUuid: req.guestUuid ?? null,
        listingId: input.listingId,
        query: input.query,
      });
    }
    return noContent(res);
  }),
);
