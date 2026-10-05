import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { ok, page } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { writeRateLimit } from '../../middleware/rate-limit';
import { denyGuest } from '../../middleware/authorize';
import { unauthenticated } from '../../core/errors';
import { resolvePagination } from '../../core/http/pagination';
import { queryFeed } from '../listings/listings.repository';
import { listReviews } from '../reviews/reviews.service';
import { getOwnerTrust, getPublicTrust } from '../trust/trust.service';
import {
  getBusinessProfile,
  getProfile,
  getPublicProfile,
  getSavedLocation,
  getVerificationStatus,
  getPreferences,
  getPrivacy,
  mergeRemotePreferences,
  setLastMarketplace,
  updatePreferences,
  updatePrivacy,
  updateProfile,
  updateSavedLocation,
} from './users.service';
import { changeUsername, inspectUsernameAvailability } from './username.service';
import { confirmAvatar, deleteAvatar } from './profile-image.service';
import {
  changeUsernameSchema,
  confirmAvatarSchema,
  mergePreferencesSchema,
  publicUsernameParam,
  setLastMarketplaceSchema,
  updateLocationSchema,
  updatePreferencesSchema,
  updatePrivacySchema,
  updateProfileSchema,
  usernameLookupSchema,
  type MergePreferencesInput,
  type UpdateLocationInput,
  type UpdatePreferencesInput,
  type UpdatePrivacyInput,
  type UpdateProfileInput,
} from './users.schema';

export const usersRouter = Router();

usersRouter.use(authenticate);

usersRouter.get(
  '/username/available',
  validate({ query: usernameLookupSchema }),
  asyncHandler(async (req, res) => {
    const { username } = query<{ username: string }>(req);
    return ok(res, await inspectUsernameAvailability(username, req.auth?.userId ?? null));
  }),
);

usersRouter.get(
  '/u/:username',
  validate({ params: publicUsernameParam }),
  asyncHandler(async (req, res) => {
    const { username } = params<{ username: string }>(req);
    const profile = await getPublicProfile(username, req.auth?.userId ?? null);
    const trust = await getPublicTrust(profile.id);
    return ok(res, { ...profile, trust });
  }),
);

usersRouter.get(
  '/u/:username/listings',
  validate({
    params: publicUsernameParam,
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      perPage: z.coerce.number().int().min(1).max(50).default(12),
      marketplace: z.string().max(32).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { username } = params<{ username: string }>(req);
    const q = query<{ page: number; perPage: number; marketplace?: string }>(req);
    const profile = await getPublicProfile(username, req.auth?.userId ?? null);
    if (!profile.flags.showListings) return page(res, { items: [], total: 0, page: q.page, perPage: q.perPage });

    const pagination = resolvePagination(
      { page: q.page, perPage: q.perPage, sort: 'newest' },
      { newest: 'COALESCE(l.bump_at, l.published_at, l.created_at)' },
      [{ field: 'COALESCE(l.bump_at, l.published_at, l.created_at)', direction: 'DESC' }],
      { newest: 'DESC' },
    );
    const result = await queryFeed({
      query: {
        sellerId: profile.id,
        marketplace: q.marketplace,
        page: q.page,
        perPage: q.perPage,
        includeSubcategories: true,
      },
      language: req.context.language,
      marketplaceId: null,
      marketplaceCode: q.marketplace ?? null,
      countryId: req.context.countryId,
      currency: req.context.currency,
      viewerId: req.auth?.userId ?? null,
      sort: pagination.sort,
      offset: pagination.offset,
      limit: pagination.limit,
      cursor: pagination.cursor,
    });
    return page(res, {
      items: result.items,
      total: result.total,
      page: pagination.page,
      perPage: pagination.perPage,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  }),
);

usersRouter.get(
  '/u/:username/reviews',
  validate({
    params: publicUsernameParam,
    query: z.object({
      marketplaceId: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { username } = params<{ username: string }>(req);
    const q = query<{ marketplaceId?: number; limit: number }>(req);
    const profile = await getPublicProfile(username, req.auth?.userId ?? null);
    if (!profile.flags.showReviews) return ok(res, []);
    return ok(res, await listReviews({ subjectKind: 'user', subjectId: profile.id, limit: q.limit }));
  }),
);

usersRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const profile = await getProfile(req.auth.userId);
    return ok(res, {
      ...profile,
      displayName: profile.profile.displayName,
      avatarUrl: profile.profile.avatarUrl,
    });
  }),
);

usersRouter.use(requireAuth);

usersRouter.patch(
  '/me',
  writeRateLimit,
  denyGuest('update your profile'),
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req, res) => {
    const input = body<UpdateProfileInput>(req);
    return ok(res, await updateProfile(req.auth!.userId, input));
  }),
);

usersRouter.patch(
  '/me/username',
  writeRateLimit,
  denyGuest('change your username'),
  validate({ body: changeUsernameSchema }),
  asyncHandler(async (req, res) => {
    const { username } = body<{ username: string }>(req);
    const result = await changeUsername(req.auth!.userId, username);
    const profile = await getProfile(req.auth!.userId);
    return ok(res, { ...profile, username: result.username });
  }),
);

usersRouter.post(
  '/me/avatar',
  writeRateLimit,
  denyGuest('upload a profile photo'),
  validate({ body: confirmAvatarSchema }),
  asyncHandler(async (req, res) => {
    const { storagePath } = body<{ storagePath: string }>(req);
    return ok(res, await confirmAvatar(req.auth!.userId, storagePath));
  }),
);

usersRouter.delete(
  '/me/avatar',
  writeRateLimit,
  denyGuest('remove your profile photo'),
  asyncHandler(async (req, res) => ok(res, await deleteAvatar(req.auth!.userId))),
);

usersRouter.get(
  '/me/privacy',
  asyncHandler(async (req, res) => ok(res, await getPrivacy(req.auth!.userId))),
);

usersRouter.patch(
  '/me/privacy',
  writeRateLimit,
  validate({ body: updatePrivacySchema }),
  asyncHandler(async (req, res) => {
    const input = body<UpdatePrivacyInput>(req);
    return ok(res, await updatePrivacy(req.auth!.userId, input));
  }),
);

usersRouter.get(
  '/me/business',
  asyncHandler(async (req, res) => ok(res, await getBusinessProfile(req.auth!.userId))),
);

usersRouter.get(
  '/me/verification',
  asyncHandler(async (req, res) => ok(res, await getVerificationStatus(req.auth!.userId))),
);

usersRouter.get(
  '/me/trust',
  asyncHandler(async (req, res) => ok(res, await getOwnerTrust(req.auth!.userId))),
);

usersRouter.patch(
  '/me/preferences',
  writeRateLimit,
  validate({ body: updatePreferencesSchema }),
  asyncHandler(async (req, res) => {
    const input = body<UpdatePreferencesInput>(req);
    return ok(res, await updatePreferences(req.auth!.userId, input));
  }),
);

usersRouter.get(
  '/me/preferences',
  asyncHandler(async (req, res) => ok(res, await getPreferences(req.auth!.userId))),
);

usersRouter.post(
  '/me/preferences/merge',
  writeRateLimit,
  validate({ body: mergePreferencesSchema }),
  asyncHandler(async (req, res) => {
    const input = body<MergePreferencesInput>(req);
    return ok(res, await mergeRemotePreferences(req.auth!.userId, input));
  }),
);

usersRouter.get(
  '/me/location',
  asyncHandler(async (req, res) => ok(res, await getSavedLocation(req.auth!.userId))),
);

usersRouter.put(
  '/me/location',
  writeRateLimit,
  validate({ body: updateLocationSchema }),
  asyncHandler(async (req, res) => {
    const input = body<UpdateLocationInput>(req);
    return ok(res, await updateSavedLocation(req.auth!.userId, input));
  }),
);

usersRouter.put(
  '/me/last-marketplace',
  writeRateLimit,
  validate({ body: setLastMarketplaceSchema }),
  asyncHandler(async (req, res) => {
    const { marketplaceId } = body<{ marketplaceId: number }>(req);
    return ok(res, await setLastMarketplace(req.auth!.userId, marketplaceId));
  }),
);
