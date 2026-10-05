import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { ok, page } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { writeRateLimit } from '../../middleware/rate-limit';
import {
  cancelScheduled,
  getNotification,
  getPreferences,
  hideNotification,
  listNotifications,
  listScheduled,
  markAllRead,
  markRead,
  markUnread,
  registerPushToken,
  unreadCount,
  updatePreference,
  updateQuietHours,
} from './notifications.service';

export const notificationsRouter = Router();

notificationsRouter.use(authenticate, requireAuth);

notificationsRouter.get(
  '/',
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      perPage: z.coerce.number().int().min(1).max(100).default(30),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      filter: z
        .enum(['all', 'unread', 'gold', 'property', 'vehicles', 'messages', 'security', 'payments', 'system'])
        .default('all'),
      unreadOnly: z.coerce.boolean().default(false),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{
      page: number;
      perPage: number;
      limit?: number;
      filter: 'all' | 'unread' | 'gold' | 'property' | 'vehicles' | 'messages' | 'security' | 'payments' | 'system';
      unreadOnly: boolean;
    }>(req);
    const result = await listNotifications(req.auth!.userId, {
      page: q.page,
      perPage: q.limit ?? q.perPage,
      filter: q.filter,
      unreadOnly: q.unreadOnly,
    });
    return page(res, result);
  }),
);

notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => ok(res, { count: await unreadCount(req.auth!.userId) })),
);

notificationsRouter.post(
  '/read-all',
  writeRateLimit,
  asyncHandler(async (req, res) => ok(res, await markAllRead(req.auth!.userId))),
);

notificationsRouter.get(
  '/preferences',
  asyncHandler(async (req, res) => ok(res, await getPreferences(req.auth!.userId))),
);

notificationsRouter.put(
  '/preferences/quiet-hours',
  writeRateLimit,
  validate({
    body: z.object({
      enabled: z.boolean().optional(),
      startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
      endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
      timezone: z.string().min(1).max(64).optional().nullable(),
      allowUrgent: z.boolean().optional(),
      daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional().nullable(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      enabled?: boolean;
      startTime?: string;
      endTime?: string;
      timezone?: string | null;
      allowUrgent?: boolean;
      daysOfWeek?: number[] | null;
    }>(req);
    return ok(res, await updateQuietHours(req.auth!.userId, input));
  }),
);

notificationsRouter.patch(
  '/preferences/:categoryCode',
  writeRateLimit,
  validate({
    params: z.object({ categoryCode: z.string().min(1).max(64) }),
    body: z.object({
      pushEnabled: z.coerce.boolean().optional(),
      emailEnabled: z.coerce.boolean().optional(),
      smsEnabled: z.coerce.boolean().optional(),
      inAppEnabled: z.coerce.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { categoryCode } = params<{ categoryCode: string }>(req);
    const input = body<{
      pushEnabled?: boolean;
      emailEnabled?: boolean;
      smsEnabled?: boolean;
      inAppEnabled?: boolean;
    }>(req);
    return ok(res, await updatePreference(req.auth!.userId, categoryCode, input));
  }),
);

notificationsRouter.get(
  '/scheduled',
  asyncHandler(async (req, res) => ok(res, await listScheduled(req.auth!.userId))),
);

notificationsRouter.post(
  '/scheduled/:uuid/cancel',
  writeRateLimit,
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await cancelScheduled(req.auth!.userId, uuid));
  }),
);

notificationsRouter.put(
  '/push-token',
  writeRateLimit,
  validate({
    body: z.object({
      token: z.string().min(8).max(512),
      provider: z.enum(['fcm', 'apns', 'webpush']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ token: string; provider?: 'fcm' | 'apns' | 'webpush' }>(req);
    return ok(res, await registerPushToken(req.auth!.userId, req.device?.id ?? null, input));
  }),
);

notificationsRouter.get(
  '/:uuid',
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await getNotification(req.auth!.userId, uuid));
  }),
);

notificationsRouter.post(
  '/:uuid/read',
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await markRead(req.auth!.userId, uuid));
  }),
);

notificationsRouter.post(
  '/:uuid/unread',
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await markUnread(req.auth!.userId, uuid));
  }),
);

notificationsRouter.delete(
  '/:uuid',
  writeRateLimit,
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await hideNotification(req.auth!.userId, uuid));
  }),
);
