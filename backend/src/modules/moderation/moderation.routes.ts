import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok } from '../../core/http/response';
import { validate, body, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { writeRateLimit } from '../../middleware/rate-limit';
import { listModerationQueue, submitReport } from './moderation.service';

export const moderationRouter = Router();

moderationRouter.use(authenticate);

moderationRouter.post(
  '/reports',
  requireAuth,
  writeRateLimit,
  validate({
    body: z.object({
      entityType: z.enum(['listing', 'user', 'review', 'message', 'business', 'conversation']),
      entityId: z.coerce.number().int().positive(),
      reasonCode: z.string().trim().min(1).max(64),
      description: z.string().trim().max(1000).optional(),
      marketplaceId: z.coerce.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      entityType: 'listing' | 'user' | 'review' | 'message' | 'business' | 'conversation';
      entityId: number;
      reasonCode: string;
      description?: string;
      marketplaceId?: number;
    }>(req);
    return created(
      res,
      await submitReport({
        reporterId: req.auth!.userId,
        ...input,
      }),
    );
  }),
);

moderationRouter.get(
  '/queue',
  requireAuth,
  requirePermission('moderation.view'),
  validate({
    query: z.object({
      status: z.enum(['pending', 'claimed', 'in_review', 'approved', 'rejected', 'escalated']).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ status?: string; limit: number }>(req);
    return ok(res, await listModerationQueue(q));
  }),
);
