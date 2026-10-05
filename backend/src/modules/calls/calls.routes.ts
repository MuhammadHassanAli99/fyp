import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { writeRateLimit, customRateLimit } from '../../middleware/rate-limit';
import { denyGuest } from '../../middleware/authorize';
import {
  getCall,
  iceServersForUser,
  initiateCall,
  listCallHistory,
  signalCall,
  transitionCall,
} from './calls.service';
import { allocateMaskedSession, revokeMaskedSession } from './calls.masked';
import { CALL_STATES, normalizeCallState } from './calls.state';

export const callsRouter = Router();

callsRouter.use(authenticate, requireAuth, denyGuest('make calls'));

callsRouter.get(
  '/',
  validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }) }),
  asyncHandler(async (req, res) => {
    const { limit } = query<{ limit: number }>(req);
    return ok(res, await listCallHistory(req.auth!.userId, limit));
  }),
);

callsRouter.get(
  '/ice',
  asyncHandler(async (req, res) => ok(res, { iceServers: iceServersForUser(req.auth!.userId) })),
);

callsRouter.get(
  '/:uuid',
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await getCall(uuid, req.auth!.userId));
  }),
);

callsRouter.post(
  '/',
  writeRateLimit,
  validate({
    body: z.object({
      calleeId: z.coerce.number().int().positive().optional(),
      conversationId: z.coerce.number().int().positive().optional(),
      conversationUuid: z.string().uuid().optional(),
      listingId: z.union([z.coerce.number().int().positive(), z.string().min(1)]).optional(),
      kind: z.enum(['voice', 'video']).default('voice'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      calleeId?: number;
      conversationId?: number;
      conversationUuid?: string;
      listingId?: number | string;
      kind: 'voice' | 'video';
    }>(req);
    const call = await initiateCall({
      callerId: req.auth!.userId,
      calleeId: input.calleeId ?? null,
      conversationId: input.conversationId ?? null,
      conversationUuid: input.conversationUuid ?? null,
      listingId: input.listingId ?? null,
      kind: input.kind,
    });
    return created(res, call);
  }),
);

callsRouter.patch(
  '/:uuid/status',
  validate({
    params: z.object({ uuid: z.string().uuid() }),
    body: z.object({
      status: z.enum([...CALL_STATES, 'answered', 'declined']),
      endReason: z.string().max(64).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const input = body<{ status: string; endReason?: string }>(req);
    return ok(
      res,
      await transitionCall({
        callUuid: uuid,
        userId: req.auth!.userId,
        next: normalizeCallState(input.status),
        endReason: input.endReason ?? null,
      }),
    );
  }),
);

callsRouter.post(
  '/:uuid/signal',
  validate({
    params: z.object({ uuid: z.string().uuid() }),
    body: z.object({
      type: z.enum(['offer', 'answer', 'ice', 'hangup', 'ice-restart']),
      payload: z.unknown().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const input = body<{ type: 'offer' | 'answer' | 'ice' | 'hangup' | 'ice-restart'; payload?: unknown }>(req);
    return ok(
      res,
      await signalCall({
        callUuid: uuid,
        userId: req.auth!.userId,
        type: input.type,
        payload: input.payload,
      }),
    );
  }),
);

callsRouter.post(
  '/masked',
  customRateLimit(60 * 60_000, 20),
  validate({
    body: z.object({
      listingId: z.union([z.coerce.number().int().positive(), z.string().min(1)]),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { listingId } = body<{ listingId: number | string }>(req);
    return created(res, await allocateMaskedSession({ callerId: req.auth!.userId, listingIdOrUuid: listingId }));
  }),
);

callsRouter.delete(
  '/masked/:uuid',
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await revokeMaskedSession(uuid, req.auth!.userId));
  }),
);
