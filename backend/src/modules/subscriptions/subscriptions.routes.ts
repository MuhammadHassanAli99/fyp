import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok } from '../../core/http/response';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { requirePermission, requireStaff } from '../../middleware/authorize';
import { writeRateLimit } from '../../middleware/rate-limit';
import { body, params, validate } from '../../middleware/validate';
import { listUsage, loadEntitlements } from '../../middleware/entitlements';
import {
  applyEntitlementOverride,
  cancelSubscription,
  changePlan,
  checkout,
  getCurrentSubscription,
  listInvoices,
  listPlans,
  resumeSubscription,
  verifyStorePurchase,
} from './subscriptions.service';

export const subscriptionsRouter = Router();

subscriptionsRouter.use(authenticate);

subscriptionsRouter.get(
  '/plans',
  asyncHandler(async (req, res) => ok(res, await listPlans(req.context.countryId, req.context.currency))),
);

subscriptionsRouter.get(
  '/current',
  requireAuth,
  asyncHandler(async (req, res) => ok(res, await getCurrentSubscription(req.auth!.userId))),
);

subscriptionsRouter.get(
  '/entitlements',
  requireAuth,
  asyncHandler(async (req, res) => ok(res, await loadEntitlements(req.auth!.userId))),
);

subscriptionsRouter.get(
  '/usage',
  requireAuth,
  asyncHandler(async (req, res) => ok(res, await listUsage(req.auth!.userId))),
);

subscriptionsRouter.get(
  '/invoices',
  requireAuth,
  asyncHandler(async (req, res) => ok(res, await listInvoices(req.auth!.userId))),
);

const checkoutSchema = z.object({
  planCode: z.string().min(1).max(48),
  billingInterval: z.enum(['monthly', 'quarterly', 'semi_annual', 'yearly', 'lifetime']).default('monthly'),
  currency: z.string().length(3).toUpperCase().optional(),
  gatewayCode: z.string().min(1).max(32).default('manual'),
  returnUrl: z.string().url().max(512).optional(),
});

subscriptionsRouter.post(
  '/checkout',
  requireAuth,
  writeRateLimit,
  validate({ body: checkoutSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof checkoutSchema>>(req);
    return created(
      res,
      await checkout(req.auth!.userId, {
        planCode: input.planCode,
        billingInterval: input.billingInterval,
        currency: (input.currency ?? req.context.currency).toUpperCase(),
        countryId: req.context.countryId ?? 1,
        gatewayCode: input.gatewayCode,
        returnUrl: input.returnUrl ?? null,
      }),
    );
  }),
);

subscriptionsRouter.post(
  '/change',
  requireAuth,
  writeRateLimit,
  validate({ body: checkoutSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof checkoutSchema>>(req);
    return ok(
      res,
      await changePlan(req.auth!.userId, {
        planCode: input.planCode,
        billingInterval: input.billingInterval,
        currency: (input.currency ?? req.context.currency).toUpperCase(),
        countryId: req.context.countryId ?? 1,
        gatewayCode: input.gatewayCode,
      }),
    );
  }),
);

subscriptionsRouter.post(
  '/cancel',
  requireAuth,
  writeRateLimit,
  validate({
    body: z.object({
      when: z.enum(['immediate', 'period_end']).default('period_end'),
      reason: z.string().max(255).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ when: 'immediate' | 'period_end'; reason?: string }>(req);
    return ok(res, await cancelSubscription(req.auth!.userId, input.when, input.reason));
  }),
);

subscriptionsRouter.post(
  '/resume',
  requireAuth,
  writeRateLimit,
  asyncHandler(async (req, res) => ok(res, await resumeSubscription(req.auth!.userId))),
);

subscriptionsRouter.post(
  '/store-purchase',
  requireAuth,
  writeRateLimit,
  validate({
    body: z.object({
      provider: z.enum(['apple_pay', 'google_play']),
      productId: z.string().min(1).max(128),
      receipt: z.string().min(8).max(20_000),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ provider: 'apple_pay' | 'google_play'; productId: string; receipt: string }>(req);
    return ok(
      res,
      await verifyStorePurchase(req.auth!.userId, {
        ...input,
        countryId: req.context.countryId ?? 1,
        currency: req.context.currency,
      }),
    );
  }),
);

subscriptionsRouter.post(
  '/:id/overrides',
  requireAuth,
  requireStaff,
  requirePermission('subscription.manage'),
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({
      featureCode: z.string().min(1).max(64),
      limit: z.coerce.number().int().min(0).nullable().optional(),
      unlimited: z.boolean().optional(),
      enabled: z.boolean().optional(),
      reason: z.string().max(255).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<{
      featureCode: string;
      limit?: number | null;
      unlimited?: boolean;
      enabled?: boolean;
      reason?: string;
    }>(req);
    await applyEntitlementOverride(req.auth!.userId, id, input.featureCode, input);
    return ok(res, { saved: true });
  }),
);
