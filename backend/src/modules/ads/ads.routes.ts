import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { writeRateLimit } from '../../middleware/rate-limit';
import { denyGuest, requirePermission } from '../../middleware/authorize';
import { requireFeature } from '../../middleware/entitlements';
import { resolveMarketplace } from '../../middleware/request-context';
import { AD_OBJECTIVES, PRICING_MODELS } from './ads.types';
import {
  addCreative,
  createCampaign,
  fundCampaign,
  getAdvertiser,
  getCampaign,
  getPlacements,
  listCampaigns,
  listModerationCampaigns,
  pauseCampaign,
  recordClick,
  recordConversion,
  recordImpression,
  resumeCampaign,
  servePlacement,
  setTargeting,
  staffDecideCampaign,
  submitCampaign,
  updateCampaign,
} from './ads.service';

export const adsRouter = Router();

adsRouter.use(authenticate);

const uuidParam = z.object({ uuid: z.string().uuid() });

adsRouter.get(
  '/placements',
  resolveMarketplace,
  validate({ query: z.object({ page: z.string().max(64).optional() }) }),
  asyncHandler(async (req, res) => {
    const { page } = query<{ page?: string }>(req);
    return ok(res, await getPlacements(req.marketplaceId, page ?? null));
  }),
);

adsRouter.get(
  '/serve/:placementCode',
  resolveMarketplace,
  validate({
    params: z.object({ placementCode: z.string().min(1).max(64) }),
    query: z.object({
      categoryId: z.coerce.number().int().positive().optional(),
      q: z.string().max(191).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { placementCode } = params<{ placementCode: string }>(req);
    const q = query<{ categoryId?: number; q?: string }>(req);
    return ok(
      res,
      await servePlacement(placementCode, {
        marketplaceId: req.marketplaceId,
        countryId: req.context.countryId,
        cityId: null,
        platform: req.context.platform,
        language: req.context.language,
        categoryId: q.categoryId ?? null,
        keywords: q.q ? q.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8) : [],
        userId: req.auth?.userId ?? null,
      }),
    );
  }),
);

adsRouter.post(
  '/impressions',
  writeRateLimit,
  validate({
    body: z.object({
      token: z.string().min(16).max(512),
      viewable: z.boolean().optional(),
      viewDurationMs: z.coerce.number().int().min(0).max(120_000).optional(),
      listingId: z.coerce.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ token: string; viewable?: boolean; viewDurationMs?: number; listingId?: number }>(req);
    return created(
      res,
      await recordImpression({
        token: input.token,
        userId: req.auth?.userId ?? null,
        viewable: input.viewable,
        viewDurationMs: input.viewDurationMs,
        listingId: input.listingId,
      }),
    );
  }),
);

adsRouter.post(
  '/clicks',
  writeRateLimit,
  validate({
    body: z.object({
      token: z.string().min(16).max(512),
      impressionUuid: z.string().uuid().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ token: string; impressionUuid?: string }>(req);
    return created(
      res,
      await recordClick({
        token: input.token,
        impressionUuid: input.impressionUuid,
        userId: req.auth?.userId ?? null,
      }),
    );
  }),
);

adsRouter.post(
  '/conversions',
  requireAuth,
  writeRateLimit,
  validate({
    body: z.object({
      clickId: z.coerce.number().int().positive().optional(),
      campaignUuid: z.string().uuid().optional(),
      kind: z.enum(['lead', 'signup', 'listing_view', 'contact', 'purchase', 'call']),
      value: z.coerce.number().min(0).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      clickId?: number;
      campaignUuid?: string;
      kind: 'lead' | 'signup' | 'listing_view' | 'contact' | 'purchase' | 'call';
      value?: number;
    }>(req);
    return created(
      res,
      await recordConversion({
        clickId: input.clickId,
        campaignUuid: input.campaignUuid,
        kind: input.kind,
        userId: req.auth!.userId,
        value: input.value,
      }),
    );
  }),
);

adsRouter.get(
  '/advertiser',
  requireAuth,
  requireFeature('ad_campaigns'),
  asyncHandler(async (req, res) => ok(res, await getAdvertiser(req.auth!.userId))),
);

adsRouter.get(
  '/moderation',
  requireAuth,
  requirePermission('ad_campaign.approve'),
  asyncHandler(async (_req, res) => ok(res, await listModerationCampaigns())),
);

adsRouter.get(
  '/campaigns',
  requireAuth,
  denyGuest('manage campaigns'),
  asyncHandler(async (req, res) => ok(res, await listCampaigns(req.auth!.userId))),
);

adsRouter.post(
  '/campaigns',
  requireAuth,
  denyGuest('create a campaign'),
  requireFeature('ad_campaigns'),
  writeRateLimit,
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(191),
      objective: z.enum(AD_OBJECTIVES).optional(),
      marketplaceId: z.coerce.number().int().positive().optional(),
      categoryId: z.coerce.number().int().positive().optional(),
      pricingModel: z.enum(PRICING_MODELS).optional(),
      bidAmount: z.coerce.number().min(0).optional(),
      totalBudget: z.coerce.number().min(0).optional(),
      dailyBudget: z.coerce.number().min(0).optional(),
      currency: z.string().length(3).toUpperCase().optional(),
      startsAt: z.string().datetime().optional(),
      endsAt: z.string().datetime().optional(),
      placementCodes: z.array(z.string().min(1).max(64)).max(8).optional(),
      listingId: z.coerce.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => created(res, await createCampaign(req.auth!.userId, body(req)))),
);

adsRouter.get(
  '/campaigns/:uuid',
  requireAuth,
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) =>
    ok(res, await getCampaign(req.auth!.userId, params<{ uuid: string }>(req).uuid, req.auth!.isStaff)),
  ),
);

adsRouter.put(
  '/campaigns/:uuid',
  requireAuth,
  denyGuest('edit a campaign'),
  writeRateLimit,
  validate({
    params: uuidParam,
    body: z.object({
      name: z.string().trim().min(2).max(191).optional(),
      bidAmount: z.coerce.number().min(0).nullable().optional(),
      totalBudget: z.coerce.number().min(0).nullable().optional(),
      dailyBudget: z.coerce.number().min(0).nullable().optional(),
      startsAt: z.string().datetime().nullable().optional(),
      endsAt: z.string().datetime().nullable().optional(),
      placementCodes: z.array(z.string().min(1).max(64)).max(8).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await updateCampaign(req.auth!.userId, uuid, body(req)));
  }),
);

adsRouter.put(
  '/campaigns/:uuid/targeting',
  requireAuth,
  denyGuest('edit targeting'),
  writeRateLimit,
  validate({
    params: uuidParam,
    body: z.object({
      rules: z
        .array(
          z.object({
            kind: z.string().min(1).max(32),
            operator: z.enum(['include', 'exclude']).optional(),
            values: z.array(z.union([z.string(), z.number()])).max(50).optional(),
          }),
        )
        .max(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await setTargeting(req.auth!.userId, uuid, body<{ rules: Array<{ kind: string; operator?: string; values?: unknown[] }> }>(req).rules));
  }),
);

adsRouter.post(
  '/campaigns/:uuid/creatives',
  requireAuth,
  denyGuest('add a creative'),
  writeRateLimit,
  validate({
    params: uuidParam,
    body: z.object({
      name: z.string().trim().max(128).optional(),
      format: z.enum(['banner', 'native', 'video', 'interstitial', 'carousel', 'story', 'featured', 'sponsored_listing']).optional(),
      headline: z.string().trim().max(191).optional(),
      body: z.string().trim().max(500).optional(),
      ctaLabel: z.string().trim().max(48).optional(),
      imageUrl: z.string().url().max(512).optional(),
      videoUrl: z.string().url().max(512).optional(),
      landingUrl: z.string().max(512).optional(),
      deepLink: z.string().max(512).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return created(res, await addCreative(req.auth!.userId, uuid, body(req)));
  }),
);

adsRouter.post(
  '/campaigns/:uuid/submit',
  requireAuth,
  writeRateLimit,
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => ok(res, await submitCampaign(req.auth!.userId, params<{ uuid: string }>(req).uuid))),
);

adsRouter.post(
  '/campaigns/:uuid/pause',
  requireAuth,
  writeRateLimit,
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => ok(res, await pauseCampaign(req.auth!.userId, params<{ uuid: string }>(req).uuid))),
);

adsRouter.post(
  '/campaigns/:uuid/resume',
  requireAuth,
  writeRateLimit,
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => ok(res, await resumeCampaign(req.auth!.userId, params<{ uuid: string }>(req).uuid))),
);

adsRouter.post(
  '/campaigns/:uuid/fund',
  requireAuth,
  denyGuest('fund a campaign'),
  writeRateLimit,
  validate({
    params: uuidParam,
    body: z.object({
      amount: z.coerce.number().positive(),
      gatewayCode: z.string().min(1).max(32),
      paymentMethod: z.string().min(1).max(32).optional(),
      returnUrl: z.string().url().max(512).optional(),
      currency: z.string().length(3).toUpperCase().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return created(res, await fundCampaign(req.auth!.userId, uuid, body(req)));
  }),
);

adsRouter.post(
  '/campaigns/:uuid/decision',
  requireAuth,
  requirePermission('ad_campaign.approve'),
  writeRateLimit,
  validate({
    params: uuidParam,
    body: z.object({
      decision: z.enum(['approve', 'reject']),
      reason: z.string().trim().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const input = body<{ decision: 'approve' | 'reject'; reason?: string }>(req);
    return ok(res, await staffDecideCampaign(req.auth!.userId, uuid, input.decision, input.reason));
  }),
);
