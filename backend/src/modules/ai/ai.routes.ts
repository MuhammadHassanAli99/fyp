import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { accepted, ok } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { requirePermission, requireStaff } from '../../middleware/authorize';
import { resolveMarketplace } from '../../middleware/request-context';
import { aiRateLimit } from '../../middleware/rate-limit';
import {
  acceptGeneratedContent,
  aiUsageReport,
  duplicateCheck,
  fraudCheck,
  generateDescription,
  getAiJob,
  interpretSearch,
  marketAnalysis,
  overrideAiDecision,
  queueImageEnhance,
  recommendPrice,
  recommendations,
  spamCheck,
  submitAiFeedback,
  supportTurn,
  translateText,
} from './ai.service';
import { publicToolCatalog } from './ai.tools';
import { runValuation as runPropertyValuation } from '../../marketplaces/property/property.ai';
import { runValuation as runVehicleValuation } from '../../marketplaces/vehicles/vehicles.ai';
import { generateForecasts } from '../../marketplaces/gold/gold.ai';
import { throughGateway } from './ai.gateway';

export const aiRouter = Router();

aiRouter.use(authenticate, requireAuth, resolveMarketplace, aiRateLimit);

aiRouter.post(
  '/description',
  validate({
    body: z.object({
      categoryName: z.string().trim().min(1).max(128),
      title: z.string().trim().min(3).max(191),
      price: z.coerce.number().min(0).optional().nullable(),
      city: z.string().max(128).optional().nullable(),
      attributes: z.record(z.string(), z.unknown()).default({}),
      details: z.record(z.string(), z.unknown()).default({}),
      tone: z.enum(['neutral', 'enthusiastic', 'professional', 'concise']).optional(),
      listingId: z.coerce.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      categoryName: string;
      title: string;
      price?: number | null;
      city?: string | null;
      attributes: Record<string, unknown>;
      details: Record<string, unknown>;
      tone?: 'neutral' | 'enthusiastic' | 'professional' | 'concise';
      listingId?: number;
    }>(req);
    return ok(
      res,
      await generateDescription(req, {
        marketplaceCode: req.marketplaceCode ?? 'all',
        categoryName: input.categoryName,
        title: input.title,
        language: req.context.language,
        currency: req.context.currency,
        price: input.price ?? null,
        city: input.city ?? null,
        attributes: input.attributes,
        details: input.details,
        tone: input.tone,
        listingId: input.listingId ?? null,
      }),
    );
  }),
);

aiRouter.post(
  '/price',
  validate({
    body: z.object({
      categoryId: z.coerce.number().int().positive(),
      categoryName: z.string().trim().min(1).max(128),
      attributes: z.record(z.string(), z.unknown()).default({}),
      listingId: z.coerce.number().int().positive().optional(),
      comparables: z
        .array(
          z.object({
            id: z.coerce.number().int().positive().optional(),
            price: z.coerce.number().nullable(),
            currency: z.string().length(3).nullable(),
            title: z.string(),
          }),
        )
        .default([]),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      categoryId: number;
      categoryName: string;
      attributes: Record<string, unknown>;
      listingId?: number;
      comparables: Array<{ id?: number; price: number | null; currency: string | null; title: string }>;
    }>(req);
    return ok(
      res,
      await recommendPrice(req, {
        marketplaceCode: req.marketplaceCode ?? 'all',
        categoryId: input.categoryId,
        categoryName: input.categoryName,
        currency: req.context.currency,
        attributes: input.attributes,
        comparables: input.comparables,
        listingId: input.listingId ?? null,
      }),
    );
  }),
);

aiRouter.post(
  '/translate',
  validate({
    body: z.object({
      text: z.string().trim().min(1).max(10_000),
      targetLanguage: z.string().trim().min(2).max(10),
      sourceLanguage: z.string().trim().min(2).max(10).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { text, targetLanguage, sourceLanguage } = body<{
      text: string;
      targetLanguage: string;
      sourceLanguage?: string;
    }>(req);
    return ok(res, await translateText(req, text, targetLanguage, sourceLanguage));
  }),
);

aiRouter.post(
  '/search',
  validate({ body: z.object({ query: z.string().trim().min(1).max(255) }) }),
  asyncHandler(async (req, res) => {
    const { query: q } = body<{ query: string }>(req);
    return ok(
      res,
      await interpretSearch(
        req,
        q,
        req.context.language,
        req.context.currency,
        req.context.countryCode,
        req.marketplaceId && req.marketplaceCode
          ? [{ id: req.marketplaceId, code: req.marketplaceCode, name: req.marketplaceCode }]
          : [],
      ),
    );
  }),
);

aiRouter.post(
  '/enhance',
  validate({ body: z.object({ mediaId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { mediaId } = body<{ mediaId: number }>(req);
    const result = await queueImageEnhance(req, mediaId);
    if ('accepted' in result) return accepted(res, result);
    return ok(res, result);
  }),
);

aiRouter.get(
  '/jobs/:uuid',
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await getAiJob(uuid, req.auth!.userId, Boolean(req.auth!.isStaff)));
  }),
);

aiRouter.post(
  '/content/accept',
  validate({
    body: z.object({
      entityType: z.string().trim().min(1).max(48),
      entityId: z.coerce.number().int().positive(),
      kind: z.string().trim().min(1).max(32),
      editedContent: z.string().max(20_000).optional().nullable(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ entityType: string; entityId: number; kind: string; editedContent?: string | null }>(req);
    return ok(res, await acceptGeneratedContent({ userId: req.auth!.userId, ...input }));
  }),
);

aiRouter.post(
  '/feedback',
  validate({
    body: z.object({
      jobUuid: z.string().uuid().optional(),
      entityType: z.string().max(48).optional(),
      entityId: z.coerce.number().int().positive().optional(),
      feedback: z.enum(['helpful', 'not_helpful', 'inaccurate', 'offensive', 'report']),
      comment: z.string().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      jobUuid?: string;
      entityType?: string;
      entityId?: number;
      feedback: 'helpful' | 'not_helpful' | 'inaccurate' | 'offensive' | 'report';
      comment?: string;
    }>(req);
    return ok(res, await submitAiFeedback({ userId: req.auth!.userId, ...input }));
  }),
);

aiRouter.get(
  '/market',
  validate({
    query: z.object({
      marketplaceId: z.coerce.number().int().positive().optional(),
      period: z.enum(['week', 'month']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ marketplaceId?: number; period?: 'week' | 'month' }>(req);
    return ok(
      res,
      await marketAnalysis(req, {
        marketplaceId: q.marketplaceId ?? req.marketplaceId ?? 1,
        countryId: req.context.countryId ?? 1,
        currency: req.context.currency,
        period: q.period,
      }),
    );
  }),
);

aiRouter.get(
  '/recommendations',
  asyncHandler(async (req, res) => ok(res, await recommendations(req, req.marketplaceId ?? null))),
);

aiRouter.post(
  '/duplicate',
  validate({ body: z.object({ listingId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { listingId } = body<{ listingId: number }>(req);
    return ok(res, await duplicateCheck(req, listingId));
  }),
);

aiRouter.post(
  '/spam',
  validate({ body: z.object({ text: z.string().trim().min(1).max(10_000) }) }),
  asyncHandler(async (req, res) => {
    const { text } = body<{ text: string }>(req);
    return ok(res, await spamCheck(req, text));
  }),
);

aiRouter.post(
  '/fraud',
  validate({ body: z.object({ listingId: z.coerce.number().int().positive().optional() }) }),
  asyncHandler(async (req, res) => {
    const { listingId } = body<{ listingId?: number }>(req);
    return ok(res, await fraudCheck(req, listingId));
  }),
);

aiRouter.post(
  '/property/valuate',
  validate({
    body: z.object({
      listingId: z.coerce.number().int().positive().optional(),
      propertyKind: z.string().trim().min(1).max(48),
      operation: z.enum(['sell', 'rent']).default('sell'),
      cityId: z.coerce.number().int().positive(),
      areaId: z.coerce.number().int().positive().optional(),
      areaValue: z.coerce.number().positive().max(100_000_000),
      areaUnit: z.string().trim().min(1).max(24),
      bedrooms: z.coerce.number().int().min(0).max(50).optional(),
      bathrooms: z.coerce.number().int().min(0).max(50).optional(),
      furnishing: z.enum(['unfurnished', 'semi_furnished', 'furnished', 'fully_furnished']).optional(),
      yearBuilt: z.coerce.number().int().min(1800).max(2100).optional(),
      amenityCount: z.coerce.number().int().min(0).max(80).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<Parameters<typeof runPropertyValuation>[0]>(req);
    const gated = await throughGateway(req, {
      task: 'property_valuation',
      input,
      run: async () => {
        const valuation = await runPropertyValuation({
          ...input,
          countryId: req.context.countryId ?? 1,
          currency: req.context.currency,
          requestedBy: req.auth!.userId,
        });
        return { ...valuation, model: 'property-valuation', confidence: valuation.confidence, latencyMs: 0 };
      },
    });
    if ('accepted' in gated) return accepted(res, gated);
    return ok(res, {
      ...gated.result,
      meta: gated.meta,
      disclaimer: 'Automated estimate from comparable asking prices. Not a surveyed professional valuation.',
    });
  }),
);

aiRouter.post(
  '/vehicles/valuate',
  validate({
    body: z.object({
      listingId: z.coerce.number().int().positive().optional(),
      makeId: z.coerce.number().int().positive(),
      modelId: z.coerce.number().int().positive().optional(),
      year: z.coerce.number().int().min(1950).max(2100),
      mileageKm: z.coerce.number().min(0).optional(),
      askingPrice: z.coerce.number().min(0).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      listingId?: number;
      makeId: number;
      modelId?: number;
      year: number;
      mileageKm?: number;
      askingPrice?: number;
    }>(req);
    const gated = await throughGateway(req, {
      task: 'vehicle_estimate',
      input,
      run: async () => {
        const valuation = await runVehicleValuation({
          listingId: input.listingId ?? null,
          requestedBy: req.auth!.userId,
          countryId: req.context.countryId,
          makeId: input.makeId,
          modelId: input.modelId ?? null,
          year: input.year,
          mileageKm: input.mileageKm ?? null,
          askingPrice: input.askingPrice ?? null,
          currency: req.context.currency,
        });
        return { ...valuation, model: 'vehicle-valuation', confidence: valuation.confidence, latencyMs: 0 };
      },
    });
    if ('accepted' in gated) return accepted(res, gated);
    return ok(res, {
      ...gated.result,
      meta: gated.meta,
      disclaimer: 'Estimate from comparable listings. Not a guaranteed trade-in or retail price.',
    });
  }),
);

aiRouter.get(
  '/gold/forecast',
  validate({ query: z.object({ karat: z.coerce.number().int().min(8).max(24).optional() }) }),
  asyncHandler(async (req, res) => {
    const q = query<{ karat?: number }>(req);
    const gated = await throughGateway(req, {
      task: 'gold_trend',
      input: { karat: q.karat ?? 24 },
      run: async () => {
        const written = await generateForecasts({
          countryId: req.context.countryId,
          currency: req.context.currency,
          karat: q.karat ?? 24,
        });
        return {
          rowsWritten: written,
          karat: q.karat ?? 24,
          source: 'gold_rate_history',
          model: 'gold-forecast-v1',
          confidence: written > 0 ? 65 : 20,
          latencyMs: 0,
          disclaimer: 'Forecast is a statistical range from stored rates, not a guaranteed future price.',
        };
      },
    });
    if ('accepted' in gated) return accepted(res, gated);
    return ok(res, { ...gated.result, meta: gated.meta });
  }),
);

aiRouter.get('/support/tools', asyncHandler(async (_req, res) => ok(res, { tools: publicToolCatalog() })));

aiRouter.post(
  '/support',
  validate({
    body: z.object({
      message: z.string().trim().min(1).max(4000),
      sessionUuid: z.string().uuid().optional(),
      confirmTool: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ message: string; sessionUuid?: string; confirmTool?: boolean }>(req);
    return ok(res, await supportTurn(req, input));
  }),
);

aiRouter.post(
  '/review/:uuid',
  requireStaff,
  requirePermission('moderation.view'),
  validate({
    params: z.object({ uuid: z.string().uuid() }),
    body: z.object({
      decision: z.enum(['allow', 'review', 'reject', 'override']),
      reason: z.string().trim().min(3).max(255),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const input = body<{ decision: string; reason: string }>(req);
    return ok(res, await overrideAiDecision({ reviewerId: req.auth!.userId, jobUuid: uuid, ...input }));
  }),
);

aiRouter.get(
  '/admin/usage',
  requireStaff,
  requirePermission('ai.view_any'),
  validate({ query: z.object({ period: z.enum(['today', 'month']).default('today') }) }),
  asyncHandler(async (req, res) => {
    const { period } = query<{ period: 'today' | 'month' }>(req);
    return ok(res, await aiUsageReport(period));
  }),
);
