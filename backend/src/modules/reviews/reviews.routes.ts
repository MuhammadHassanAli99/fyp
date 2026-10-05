import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { writeRateLimit } from '../../middleware/rate-limit';
import { denyGuest, requirePermission } from '../../middleware/authorize';
import {
  createReview,
  deleteOwnReview,
  getEligibility,
  getReview,
  getSummary,
  listModerationReviews,
  listReviewCriteria,
  listReviews,
  replyToReview,
  reportReview,
  staffDecideReview,
  updateReview,
  voteHelpful,
} from './reviews.service';
import { REVIEW_TYPES } from './reviews.types';

export const reviewsRouter = Router();

reviewsRouter.use(authenticate);

const uuidParam = z.object({ uuid: z.string().uuid() });

reviewsRouter.get(
  '/criteria',
  validate({
    query: z.object({
      marketplaceId: z.coerce.number().int().positive().optional(),
      appliesTo: z.string().max(32).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ marketplaceId?: number; appliesTo?: string }>(req);
    return ok(res, await listReviewCriteria(q.marketplaceId ?? req.marketplaceId ?? null, q.appliesTo ?? null));
  }),
);

reviewsRouter.get(
  '/eligibility',
  requireAuth,
  validate({
    query: z.object({
      listingId: z.coerce.number().int().positive().optional(),
      subjectKind: z.enum(['user', 'listing', 'business']).optional(),
      subjectId: z.coerce.number().int().positive().optional(),
      reviewType: z.enum(REVIEW_TYPES).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{
      listingId?: number;
      subjectKind?: 'user' | 'listing' | 'business';
      subjectId?: number;
      reviewType?: (typeof REVIEW_TYPES)[number];
    }>(req);
    return ok(
      res,
      await getEligibility({
        reviewerId: req.auth!.userId,
        listingId: q.listingId,
        subjectKind: q.subjectKind,
        subjectUserId: q.subjectKind === 'user' ? q.subjectId : undefined,
        subjectListingId: q.subjectKind === 'listing' ? q.subjectId : q.listingId,
        subjectBusinessId: q.subjectKind === 'business' ? q.subjectId : undefined,
        reviewType: q.reviewType,
      }),
    );
  }),
);

reviewsRouter.get(
  '/summary',
  validate({
    query: z.object({
      subjectKind: z.enum(['user', 'listing', 'business']),
      subjectId: z.coerce.number().int().positive(),
      marketplaceId: z.coerce.number().int().min(0).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ subjectKind: 'user' | 'listing' | 'business'; subjectId: number; marketplaceId?: number }>(req);
    return ok(res, await getSummary(q.subjectKind, q.subjectId, q.marketplaceId ?? 0));
  }),
);

reviewsRouter.get(
  '/moderation',
  requireAuth,
  requirePermission('review.moderate'),
  asyncHandler(async (_req, res) => ok(res, await listModerationReviews())),
);

reviewsRouter.get(
  '/',
  validate({
    query: z.object({
      subjectKind: z.enum(['user', 'listing', 'business']),
      subjectId: z.coerce.number().int().positive(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ subjectKind: 'user' | 'listing' | 'business'; subjectId: number; limit: number }>(req);
    return ok(res, await listReviews({ ...q, viewerId: req.auth?.userId ?? null }));
  }),
);

reviewsRouter.get(
  '/:uuid',
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => ok(res, await getReview(params<{ uuid: string }>(req).uuid, req.auth?.userId ?? null))),
);

reviewsRouter.post(
  '/',
  requireAuth,
  denyGuest('write a review'),
  writeRateLimit,
  validate({
    body: z.object({
      listingId: z.coerce.number().int().positive().optional(),
      subjectKind: z.enum(['user', 'listing', 'business']).optional(),
      subjectUserId: z.coerce.number().int().positive().optional(),
      subjectListingId: z.coerce.number().int().positive().optional(),
      subjectBusinessId: z.coerce.number().int().positive().optional(),
      marketplaceId: z.coerce.number().int().positive().optional(),
      rating: z.coerce.number().min(1).max(5),
      title: z.string().trim().max(191).optional(),
      body: z.string().trim().max(5000).optional(),
      reviewerRole: z.enum(['buyer', 'seller', 'renter', 'landlord', 'visitor']).optional(),
      reviewType: z.enum(REVIEW_TYPES).optional(),
      criteria: z.array(z.object({ code: z.string().min(1).max(64), rating: z.coerce.number().min(1).max(5) })).max(12).optional(),
      media: z
        .array(
          z.object({
            url: z.string().url().max(512),
            objectKey: z.string().max(512).optional(),
            kind: z.enum(['image', 'video']).optional(),
            mimeType: z.string().max(96).optional(),
          }),
        )
        .max(8)
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => created(res, await createReview(req.auth!.userId, body(req)))),
);

reviewsRouter.put(
  '/:uuid',
  requireAuth,
  denyGuest('edit a review'),
  writeRateLimit,
  validate({
    params: uuidParam,
    body: z.object({
      rating: z.coerce.number().min(1).max(5).optional(),
      title: z.string().trim().max(191).nullable().optional(),
      body: z.string().trim().max(5000).nullable().optional(),
      criteria: z.array(z.object({ code: z.string().min(1).max(64), rating: z.coerce.number().min(1).max(5) })).max(12).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await updateReview(req.auth!.userId, uuid, body(req)));
  }),
);

reviewsRouter.post(
  '/:uuid/replies',
  requireAuth,
  denyGuest('reply to a review'),
  writeRateLimit,
  validate({
    params: uuidParam,
    body: z.object({ body: z.string().trim().min(2).max(2000) }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return created(res, await replyToReview(req.auth!.userId, uuid, body<{ body: string }>(req).body));
  }),
);

reviewsRouter.post(
  '/:uuid/respond',
  requireAuth,
  denyGuest('respond to a review'),
  writeRateLimit,
  validate({
    params: uuidParam,
    body: z.object({ body: z.string().trim().min(2).max(2000) }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return created(res, await replyToReview(req.auth!.userId, uuid, body<{ body: string }>(req).body));
  }),
);

reviewsRouter.post(
  '/:uuid/report',
  requireAuth,
  denyGuest('report a review'),
  writeRateLimit,
  validate({
    params: uuidParam,
    body: z.object({
      reason: z.enum([
        'spam',
        'fake',
        'offensive',
        'irrelevant',
        'personal_info',
        'conflict_of_interest',
        'other',
        'abuse',
        'harassment',
        'wrong_transaction',
        'fraud',
        'off_topic',
      ]),
      description: z.string().trim().max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const input = body<{ reason: string; description?: string }>(req);
    return created(res, await reportReview(req.auth!.userId, uuid, input.reason, input.description));
  }),
);

reviewsRouter.post(
  '/:uuid/helpful',
  requireAuth,
  denyGuest('vote on a review'),
  writeRateLimit,
  validate({
    params: uuidParam,
    body: z.object({ helpful: z.boolean() }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await voteHelpful(req.auth!.userId, uuid, body<{ helpful: boolean }>(req).helpful));
  }),
);

reviewsRouter.post(
  '/:uuid/decision',
  requireAuth,
  requirePermission('review.moderate'),
  writeRateLimit,
  validate({
    params: uuidParam,
    body: z.object({
      decision: z.enum(['approve', 'reject', 'restore', 'hide']),
      note: z.string().trim().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const input = body<{ decision: 'approve' | 'reject' | 'restore' | 'hide'; note?: string }>(req);
    return ok(res, await staffDecideReview(req.auth!.userId, uuid, input.decision, input.note));
  }),
);

reviewsRouter.delete(
  '/:uuid',
  requireAuth,
  writeRateLimit,
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => ok(res, await deleteOwnReview(req.auth!.userId, params<{ uuid: string }>(req).uuid))),
);
