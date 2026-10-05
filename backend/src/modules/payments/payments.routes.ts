import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok } from '../../core/http/response';
import { validate, body, params } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { requirePermission, requireStaff } from '../../middleware/authorize';
import { writeRateLimit, paymentRateLimit } from '../../middleware/rate-limit';
import { riskGuard } from '../../middleware/risk-guard';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { env } from '../../config/env';
import {
  confirmBankTransfer,
  createOrder,
  getOrder,
  handleWebhook,
  listGateways,
  listMethods,
  listOrders,
  requestRefund,
  reviewBankProof,
  simulatePayment,
  submitBankProof,
} from './payments.service';
import { ensureInvoicePdf } from './payments.invoices';
import { queryOne, type Row } from '../../db/query';
import { storage } from '../../providers/storage';

export const paymentsRouter = Router();

function webhookRawBody(req: Request): Buffer {
  const tagged = req as Request & { rawBody?: Buffer };
  if (tagged.rawBody && tagged.rawBody.length > 0) return tagged.rawBody;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (env.isProduction) throw badRequest('Missing signed webhook body');
  return Buffer.from(JSON.stringify(req.body ?? {}));
}

paymentsRouter.post(
  '/webhooks/:gatewayCode',
  validate({ params: z.object({ gatewayCode: z.string().min(1).max(32) }) }),
  (req: Request, _res: Response, next: NextFunction) => {
    req.valid = { ...(req.valid ?? {}), body: undefined };
    next();
  },
  asyncHandler(async (req, res) => {
    const { gatewayCode } = params<{ gatewayCode: string }>(req);
    const signature =
      (req.headers['stripe-signature'] as string | undefined) ??
      (req.headers['paypal-transmission-sig'] as string | undefined) ??
      (req.headers['x-signature'] as string | undefined);
    return ok(res, await handleWebhook(gatewayCode, webhookRawBody(req), signature));
  }),
);

paymentsRouter.get(
  '/gateways',
  authenticate,
  asyncHandler(async (req, res) => ok(res, await listGateways(req.context.countryCode, req.context.currency))),
);

paymentsRouter.get(
  '/methods',
  authenticate,
  asyncHandler(async (req, res) =>
    ok(res, await listMethods(req.context.countryCode, req.context.currency, req.context.countryId)),
  ),
);

paymentsRouter.use(authenticate, requireAuth);

paymentsRouter.get(
  '/orders',
  asyncHandler(async (req, res) => ok(res, await listOrders(req.auth!.userId))),
);

paymentsRouter.get(
  '/orders/:uuid',
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await getOrder(uuid, req.auth!.userId, req.auth!.isStaff));
  }),
);

const pricedOnServer = new Set([
  'subscription',
  'promotion',
  'advertisement',
  'verification',
  'listing_purchase',
  'escrow',
  'rental_deposit',
  'rental_payment',
  'booking_payment',
  'parts_purchase',
]);

paymentsRouter.post(
  '/orders',
  paymentRateLimit,
  riskGuard('enforce'),
  validate({
    body: z.object({
      kind: z.enum([
        'subscription',
        'promotion',
        'advertisement',
        'verification',
        'wallet_topup',
        'listing_purchase',
        'escrow',
        'auction_deposit',
        'rental_deposit',
        'rental_payment',
        'booking_payment',
        'parts_purchase',
      ]),
      amount: z.coerce.number().positive().optional(),
      currency: z.string().length(3).toUpperCase().optional(),
      countryId: z.coerce.number().int().positive().optional(),
      gatewayCode: z.string().min(1).max(32),
      paymentMethod: z.string().min(1).max(32).optional(),
      description: z.string().max(255).optional(),
      referenceType: z.string().max(48).optional(),
      referenceId: z.coerce.number().int().positive().optional(),
      returnUrl: z.string().url().max(512).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      kind:
        | 'subscription'
        | 'promotion'
        | 'advertisement'
        | 'verification'
        | 'wallet_topup'
        | 'listing_purchase'
        | 'escrow'
        | 'auction_deposit'
        | 'rental_deposit'
        | 'rental_payment'
        | 'booking_payment'
        | 'parts_purchase';
      amount?: number;
      currency?: string;
      countryId?: number;
      gatewayCode: string;
      paymentMethod?: string;
      description?: string;
      referenceType?: string;
      referenceId?: number;
      returnUrl?: string;
    }>(req);
    if (pricedOnServer.has(input.kind)) {
      throw badRequest('This order type is priced on the server. Use the marketplace or subscription checkout API.');
    }
    if (!input.amount || input.amount > 10_000) throw badRequest('Amount is required and must be at most 10000');
    return created(
      res,
      await createOrder(req.auth!.userId, {
        ...input,
        amount: input.amount,
        currency: (input.currency ?? req.context.currency).toUpperCase(),
        countryId: input.countryId ?? req.context.countryId ?? 1,
        requestScore: req.context.riskScore,
      }),
    );
  }),
);

paymentsRouter.post(
  '/orders/:uuid/simulate',
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await simulatePayment(uuid, req.auth!.userId));
  }),
);

paymentsRouter.post(
  '/orders/:uuid/proof',
  writeRateLimit,
  validate({
    params: z.object({ uuid: z.string().uuid() }),
    body: z.object({
      storagePath: z.string().min(8).max(512),
      mimeType: z.string().min(3).max(128).default('application/pdf'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const input = body<{ storagePath: string; mimeType: string }>(req);
    return created(res, await submitBankProof(uuid, req.auth!.userId, input.storagePath, input.mimeType));
  }),
);

paymentsRouter.post(
  '/refunds',
  writeRateLimit,
  riskGuard('enforce'),
  validate({
    body: z.object({
      paymentUuid: z.string().uuid(),
      amount: z.coerce.number().positive().optional(),
      reason: z.string().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ paymentUuid: string; amount?: number; reason?: string }>(req);
    return created(
      res,
      await requestRefund({
        userId: req.auth!.userId,
        isStaff: req.auth!.isStaff,
        paymentUuid: input.paymentUuid,
        amount: input.amount,
        reason: input.reason,
      }),
    );
  }),
);

paymentsRouter.get(
  '/invoices/:uuid/pdf',
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const invoice = await queryOne<Row>('SELECT id, user_id, pdf_url FROM invoices WHERE uuid = ?', [uuid]);
    if (!invoice) throw notFound('Invoice');
    if (Number(invoice.user_id) !== req.auth!.userId && !req.auth!.isStaff) throw forbidden('Invoice does not belong to you');
    await ensureInvoicePdf(Number(invoice.id));
    const refreshed = await queryOne<Row>('SELECT pdf_url FROM invoices WHERE id = ?', [invoice.id]);
    const url = refreshed?.pdf_url ? String(refreshed.pdf_url) : null;
    if (url?.includes('/uploads/')) {
      const relative = url.split('/uploads/')[1];
      if (relative) {
        try {
          const bytes = await storage.read(relative);
          res.setHeader('Content-Type', 'application/pdf');
          return res.send(bytes);
        } catch {
          /* fall through to metadata */
        }
      }
    }
    return ok(res, { pdfUrl: url });
  }),
);

paymentsRouter.post(
  '/proofs/:uuid/review',
  requireStaff,
  requirePermission('payment.update'),
  validate({
    params: z.object({ uuid: z.string().uuid() }),
    body: z.object({ approved: z.boolean(), notes: z.string().max(500).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const input = body<{ approved: boolean; notes?: string }>(req);
    return ok(res, await reviewBankProof(uuid, req.auth!.userId, input.approved, input.notes));
  }),
);

paymentsRouter.post(
  '/orders/:uuid/confirm-transfer',
  requireStaff,
  requirePermission('payment.update'),
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await confirmBankTransfer(uuid, req.auth!.userId));
  }),
);
