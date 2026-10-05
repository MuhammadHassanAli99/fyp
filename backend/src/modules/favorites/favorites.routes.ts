import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, noContent, ok, page } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { writeRateLimit } from '../../middleware/rate-limit';
import { denyGuest } from '../../middleware/authorize';
import { FAVORITE_ENTITY_TYPES, FAVORITE_SORTS } from './favorites.rules';
import {
  addFavorite,
  createCollection,
  deleteCollection,
  favoriteStatus,
  getCollection,
  getFavorite,
  listCollections,
  listFavorites,
  moveFavorite,
  removeFavorite,
  removeFavoriteByEntity,
  reorderCollections,
  shareFavoriteResource,
  unshareCollection,
  updateCollection,
  updateFavorite,
} from './favorites.service';

export const favoritesRouter = Router();

favoritesRouter.use(authenticate, requireAuth, denyGuest('save favorites'));

favoritesRouter.get(
  '/',
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      perPage: z.coerce.number().int().min(1).max(100).default(24),
      collectionId: z.coerce.number().int().positive().optional(),
      marketplace: z.enum(['gold', 'property', 'vehicles']).optional(),
      entityType: z.enum(FAVORITE_ENTITY_TYPES).optional(),
      categoryId: z.coerce.number().int().positive().optional(),
      q: z.string().trim().max(120).optional(),
      sort: z.enum(FAVORITE_SORTS).default('newest'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{
      page: number;
      perPage: number;
      collectionId?: number;
      marketplace?: 'gold' | 'property' | 'vehicles';
      entityType?: 'listing' | 'vehicle_part';
      categoryId?: number;
      q?: string;
      sort: 'newest' | 'oldest' | 'price_asc' | 'price_desc';
    }>(req);
    return page(
      res,
      await listFavorites(req.auth!.userId, {
        page: q.page,
        perPage: q.perPage,
        collectionId: q.collectionId ?? null,
        marketplace: q.marketplace ?? null,
        entityType: q.entityType ?? null,
        categoryId: q.categoryId ?? null,
        q: q.q ?? null,
        sort: q.sort,
      }),
    );
  }),
);

favoritesRouter.get(
  '/status',
  validate({
    query: z.object({
      listingId: z.coerce.number().int().positive().optional(),
      entityType: z.enum(FAVORITE_ENTITY_TYPES).optional(),
      entityId: z.coerce.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ listingId?: number; entityType?: 'listing' | 'vehicle_part'; entityId?: number }>(req);
    return ok(res, await favoriteStatus(req.auth!.userId, q));
  }),
);

favoritesRouter.post(
  '/',
  writeRateLimit,
  validate({
    body: z.object({
      listingId: z.coerce.number().int().positive().optional(),
      entityType: z.enum(FAVORITE_ENTITY_TYPES).optional(),
      entityId: z.coerce.number().int().positive().optional(),
      marketplaceId: z.coerce.number().int().positive().optional(),
      collectionId: z.coerce.number().int().positive().optional(),
      note: z.string().trim().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      listingId?: number;
      entityType?: 'listing' | 'vehicle_part';
      entityId?: number;
      marketplaceId?: number;
      collectionId?: number;
      note?: string;
    }>(req);
    const result = await addFavorite(req.auth!.userId, input);
    return result.created ? created(res, result) : ok(res, result);
  }),
);

favoritesRouter.get('/collections', asyncHandler(async (req, res) => ok(res, await listCollections(req.auth!.userId))));

favoritesRouter.post(
  '/collections',
  writeRateLimit,
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(128),
      description: z.string().trim().max(500).optional(),
      parentId: z.coerce.number().int().positive().optional(),
      marketplaceId: z.coerce.number().int().positive().optional(),
      icon: z.string().max(64).optional(),
      color: z.string().max(16).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    return created(res, await createCollection(req.auth!.userId, body(req)));
  }),
);

favoritesRouter.post(
  '/collections/reorder',
  writeRateLimit,
  validate({
    body: z.object({
      items: z
        .array(
          z.object({
            id: z.coerce.number().int().positive(),
            sortOrder: z.coerce.number().int().min(0).max(10_000),
            parentId: z.coerce.number().int().positive().nullable().optional(),
          }),
        )
        .min(1)
        .max(100),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { items } = body<{ items: Array<{ id: number; sortOrder: number; parentId?: number | null }> }>(req);
    return ok(res, await reorderCollections(req.auth!.userId, items));
  }),
);

favoritesRouter.get(
  '/collections/:id',
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    return ok(res, await getCollection(req.auth!.userId, params<{ id: number }>(req).id));
  }),
);

favoritesRouter.patch(
  '/collections/:id',
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({
      name: z.string().trim().min(1).max(128).optional(),
      description: z.string().trim().max(500).nullable().optional(),
      parentId: z.coerce.number().int().positive().nullable().optional(),
      marketplaceId: z.coerce.number().int().positive().nullable().optional(),
      icon: z.string().max(64).nullable().optional(),
      color: z.string().max(16).nullable().optional(),
      sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    return ok(res, await updateCollection(req.auth!.userId, params<{ id: number }>(req).id, body(req)));
  }),
);

favoritesRouter.delete(
  '/collections/:id',
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    await deleteCollection(req.auth!.userId, params<{ id: number }>(req).id);
    return noContent(res);
  }),
);

favoritesRouter.post(
  '/collections/:id/share',
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({
      accessPolicy: z.enum(['public', 'restricted']).default('restricted'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const { accessPolicy } = body<{ accessPolicy: 'public' | 'restricted' }>(req);
    return ok(res, await shareFavoriteResource(req.auth!.userId, { targetType: 'collection', targetId: id, accessPolicy }));
  }),
);

favoritesRouter.delete(
  '/collections/:id/share',
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    await unshareCollection(req.auth!.userId, params<{ id: number }>(req).id);
    return noContent(res);
  }),
);

favoritesRouter.post(
  '/share',
  writeRateLimit,
  validate({
    body: z.object({
      targetType: z.enum(['listing', 'favorite', 'collection', 'comparison']),
      targetId: z.coerce.number().int().positive(),
      accessPolicy: z.enum(['public', 'restricted']).default('public'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      targetType: 'listing' | 'favorite' | 'collection' | 'comparison';
      targetId: number;
      accessPolicy: 'public' | 'restricted';
    }>(req);
    return ok(res, await shareFavoriteResource(req.auth!.userId, input));
  }),
);

favoritesRouter.post(
  '/:id/move',
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({ collectionId: z.coerce.number().int().positive().nullable() }),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const { collectionId } = body<{ collectionId: number | null }>(req);
    return ok(res, await moveFavorite(req.auth!.userId, id, collectionId));
  }),
);

favoritesRouter.patch(
  '/:id',
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({
      note: z.string().trim().max(500).nullable().optional(),
      notifyPriceDrop: z.boolean().optional(),
      notifyStatusChange: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    return ok(res, await updateFavorite(req.auth!.userId, params<{ id: number }>(req).id, body(req)));
  }),
);

favoritesRouter.delete(
  '/entity/:entityType/:entityId',
  validate({
    params: z.object({
      entityType: z.enum(FAVORITE_ENTITY_TYPES),
      entityId: z.coerce.number().int().positive(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { entityType, entityId } = params<{ entityType: 'listing' | 'vehicle_part'; entityId: number }>(req);
    await removeFavoriteByEntity(req.auth!.userId, { entityType, entityId });
    return noContent(res);
  }),
);

favoritesRouter.get(
  '/:id',
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => ok(res, await getFavorite(req.auth!.userId, params<{ id: number }>(req).id))),
);

favoritesRouter.delete(
  '/:id',
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    await removeFavorite(req.auth!.userId, params<{ id: number }>(req).id);
    return noContent(res);
  }),
);
