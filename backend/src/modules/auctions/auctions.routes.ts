import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { ok } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { writeRateLimit } from '../../middleware/rate-limit';
import { riskGuard } from '../../middleware/risk-guard';
import { getAuction, listBids, placeBid } from './auctions.service';

export const auctionsRouter = Router();

auctionsRouter.get(
  '/:id',
  authenticate,
  validate({ params: z.object({ id: z.string().min(1).max(64) }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    return ok(res, await getAuction(id));
  }),
);

auctionsRouter.get(
  '/:id/bids',
  authenticate,
  validate({
    params: z.object({ id: z.string().min(1).max(64) }),
    query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const { limit } = query<{ limit: number }>(req);
    const auction = await getAuction(id);
    return ok(res, { auctionId: auction.id, bids: await listBids(auction.id, limit), serverNow: auction.serverNow });
  }),
);

auctionsRouter.post(
  '/:id/bids',
  authenticate,
  requireAuth,
  writeRateLimit,
  riskGuard('enforce'),
  validate({
    params: z.object({ id: z.string().min(1).max(64) }),
    body: z.object({
      amount: z.coerce.number().positive().max(1_000_000_000_000),
      idempotencyKey: z.string().min(8).max(64).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const input = body<{ amount: number; idempotencyKey?: string }>(req);
    const auction = await getAuction(id);
    const result = await placeBid({
      auctionId: auction.id,
      bidderId: req.auth!.userId,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey ?? null,
      req,
    });
    return ok(res, result);
  }),
);
