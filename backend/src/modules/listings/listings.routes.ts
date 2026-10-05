import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok, page, noContent } from '../../core/http/response';
import { validate, body, query, params } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { resolveMarketplace } from '../../middleware/request-context';
import { searchRateLimit, writeRateLimit, uploadRateLimit } from '../../middleware/rate-limit';
import { riskGuard } from '../../middleware/risk-guard';
import { denyGuest } from '../../middleware/authorize';
import { recordAudit } from '../../middleware/audit';
import { resolvePagination } from '../../core/http/pagination';
import { marketplaceRegistry } from '../../marketplaces/module';
import { queryFeed } from './listings.repository';
import { resolveSellerScope, listingScopeSql } from '../seller/seller.scope';
import { MARKETPLACE_CODES } from '../seller/seller.schema';
import { addFavorite, removeFavoriteByEntity } from '../favorites/favorites.service';
import {
  addMedia,
  addOwnedAvailabilityBlock,
  appealOwnedListing,
  archiveOwnedListing,
  changeStatus,
  createListing,
  deleteDraft,
  deleteMedia,
  getListing,
  getListingAvailabilityWindow,
  getOwnedAnalytics,
  getOwnedEvents,
  getOwnedPromotions,
  getOwnedRejections,
  getOwnedVersions,
  getSimilarListings,
  listDrafts,
  listPromotionPackages,
  promoteListing,
  publishOwnedListing,
  recordView,
  rejectOwnedListing,
  renewListing,
  reorderMedia,
  restoreOwnedListing,
  saveDraft,
  setOwnedTransaction,
  shareListingPublic,
  softDeleteListing,
  submitForReview,
  updateListing,
} from './listings.service';
import {
  appealListingSchema,
  availabilityBlockSchema,
  availabilityQuerySchema,
  createListingSchema,
  listingQuerySchema,
  listingStatusSchema,
  mediaUploadSchema,
  promoteListingSchema,
  rejectListingSchema,
  shareListingSchema,
  transactionStatusSchema,
  updateListingSchema,
  type CreateListingInput,
  type ListingQueryInput,
  type ListingStatus,
  type UpdateListingInput,
} from './listings.schema';

export const listingsRouter = Router();

/** Core sort keys. Module-specific keys are merged in per request. */
const CORE_SORT: Record<string, string> = {
  relevance: 'l.search_rank',
  newest: 'COALESCE(l.bump_at, l.published_at, l.created_at)',
  oldest: 'COALESCE(l.published_at, l.created_at)',
  price: 'l.price_base',
  popular: 'l.view_count',
  favorites: 'l.favorite_count',
  distance: 'distance_km',
  featured: 'l.is_featured',
};

/** Default direction when the client omits `+`/`-` (e.g. `sort=newest`). */
const CORE_SORT_DIR: Record<string, 'ASC' | 'DESC'> = {
  relevance: 'DESC',
  newest: 'DESC',
  oldest: 'ASC',
  price: 'ASC',
  popular: 'DESC',
  favorites: 'DESC',
  distance: 'ASC',
  featured: 'DESC',
};

const sortMetaFor = (
  marketplaceId: number | null,
): { map: Record<string, string>; directions: Record<string, 'ASC' | 'DESC'> } => {
  const map = { ...CORE_SORT };
  const directions = { ...CORE_SORT_DIR };
  const module = marketplaceId ? marketplaceRegistry.getById(marketplaceId) : null;
  for (const option of module?.sortOptions() ?? []) {
    map[option.code] = option.expression;
    directions[option.code] = option.direction;
  }
  return { map, directions };
};

/**
 * The feed (§8, §9, §10). Also serves category browsing and filtered search,
 * because they are the same query with different parameters.
 */
listingsRouter.get(
  '/',
  authenticate,
  resolveMarketplace,
  searchRateLimit,
  validate({ query: listingQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<ListingQueryInput>(req);
    const marketplaceId = q.marketplaceId ?? req.marketplaceId;
    const sortMeta = sortMetaFor(marketplaceId);
    const pagination = resolvePagination(q, sortMeta.map, [], sortMeta.directions);

    const result = await queryFeed({
      query: q,
      language: req.context.language,
      marketplaceId,
      marketplaceCode: req.marketplaceCode,
      countryId: q.countryId ?? req.context.countryId,
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

/** The current user's own listings, including drafts and rejected ones. */
listingsRouter.get(
  '/mine',
  authenticate,
  requireAuth,
  resolveMarketplace,
  validate({ query: listingQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<ListingQueryInput>(req);
    const marketplace =
      q.marketplace && (MARKETPLACE_CODES as readonly string[]).includes(q.marketplace)
        ? (q.marketplace as (typeof MARKETPLACE_CODES)[number])
        : undefined;
    const scope = await resolveSellerScope(req.auth!, {
      period: '30d',
      page: 1,
      perPage: 20,
      marketplace,
    });
    const ownerScope = listingScopeSql(scope, 'l');
    // My ads spans every marketplace unless the client filters explicitly.
    // Do not inherit X-Marketplace from browse context.
    const marketplaceId = q.marketplaceId ?? null;
    const sortMeta = sortMetaFor(marketplaceId ?? req.marketplaceId ?? null);
    const pagination = resolvePagination(q, sortMeta.map, [], sortMeta.directions);

    const result = await queryFeed({
      query: { ...q, sellerId: undefined, businessId: undefined },
      language: req.context.language,
      marketplaceId,
      marketplaceCode: q.marketplace ?? null,
      countryId: null,
      currency: req.context.currency,
      viewerId: req.auth!.userId,
      includePrivate: true,
      ownerScope,
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

/* Drafts (§26 Offline Support) --------------------------------------------- */

listingsRouter.get(
  '/drafts',
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => ok(res, await listDrafts(req.auth!.userId))),
);

listingsRouter.put(
  '/drafts',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({
    body: z.object({
      uuid: z.string().uuid().optional(),
      marketplaceId: z.coerce.number().int().positive(),
      categoryId: z.coerce.number().int().positive().optional(),
      step: z.coerce.number().int().min(0).max(20).optional(),
      data: z.record(z.string(), z.unknown()),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ uuid?: string; marketplaceId: number; categoryId?: number; step?: number; data: Record<string, unknown> }>(req);
    return ok(res, await saveDraft(req.auth!.userId, input));
  }),
);

listingsRouter.delete(
  '/drafts/:uuid',
  authenticate,
  requireAuth,
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    await deleteDraft(req.auth!.userId, params<{ uuid: string }>(req).uuid);
    return noContent(res);
  }),
);

listingsRouter.get(
  '/promotion-packages',
  authenticate,
  resolveMarketplace,
  asyncHandler(async (req, res) => ok(res, await listPromotionPackages(req.marketplaceId ?? null))),
);

/* Create / read / update --------------------------------------------------- */

listingsRouter.post(
  '/',
  authenticate,
  requireAuth,
  denyGuest('post a listing'),
  writeRateLimit,
  riskGuard('enforce'),
  resolveMarketplace,
  validate({ body: createListingSchema }),
  asyncHandler(async (req, res) => {
    const input = body<CreateListingInput>(req);
    const result = await createListing(req.auth!.userId, {
      ...input,
      marketplaceId: input.marketplaceId ?? req.marketplaceId ?? undefined,
    });
    void recordAudit({ action: 'listing.create', entityType: 'listing', entityId: result.listing.id, after: { title: input.title } });
    return created(res, result);
  }),
);

listingsRouter.get(
  '/:idOrUuid',
  authenticate,
  validate({ params: z.object({ idOrUuid: z.string().min(1).max(220) }) }),
  asyncHandler(async (req, res) => {
    const { idOrUuid } = params<{ idOrUuid: string }>(req);
    const listing = await getListing({
      idOrUuid,
      language: req.context.language,
      currency: req.context.currency,
      viewerId: req.auth?.userId ?? null,
      isStaff: req.auth?.isStaff ?? false,
    });

    // Fire-and-forget: a view write must never delay the page.
    if (listing.lifecycleStatus === 'published' && listing.seller.id !== req.auth?.userId) {
      void recordView({
        listingId: listing.id,
        viewerId: req.auth?.userId ?? null,
        guestUuid: req.guestUuid,
        source: String(req.query.source ?? 'direct'),
      }).catch(() => undefined);
    }

    return ok(res, listing);
  }),
);

listingsRouter.patch(
  '/:id',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: updateListingSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<UpdateListingInput>(req);
    const result = await updateListing(id, req.auth!.userId, req.auth!.isStaff, input);
    void recordAudit({ action: 'listing.update', entityType: 'listing', entityId: id, after: input });
    return ok(res, result);
  }),
);

listingsRouter.delete(
  '/:id',
  authenticate,
  requireAuth,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    await softDeleteListing(id, req.auth!.userId, req.auth!.isStaff);
    void recordAudit({ action: 'listing.delete', entityType: 'listing', entityId: id });
    return noContent(res);
  }),
);

/* Lifecycle (§8) ----------------------------------------------------------- */

listingsRouter.post(
  '/:id/submit',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const result = await submitForReview(id, req.auth!.userId);
    return ok(res, result);
  }),
);

listingsRouter.patch(
  '/:id/status',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: listingStatusSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<{ status: ListingStatus; reason?: string; buyerId?: number }>(req);
    const result = await changeStatus({
      listingId: id,
      userId: req.auth!.userId,
      isStaff: req.auth!.isStaff,
      to: input.status,
      reason: input.reason,
      buyerId: input.buyerId,
      roles: req.auth!.roles,
      permissions: req.auth!.permissions,
    });
    void recordAudit({ action: `listing.status.${input.status}`, entityType: 'listing', entityId: id, after: input });
    return ok(res, result);
  }),
);

listingsRouter.post(
  '/:id/renew',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return ok(res, await renewListing(id, req.auth!.userId, req.auth!.isStaff));
  }),
);

listingsRouter.post(
  '/:id/promote',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: promoteListingSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<{
      kind?: 'feature' | 'boost' | 'urgent' | 'bump' | 'top_of_search' | 'homepage' | 'story';
      packageCode?: string;
      days: number;
      useQuota: boolean;
      gatewayCode?: string;
    }>(req);
    const result = await promoteListing({
      listingId: id,
      userId: req.auth!.userId,
      isStaff: req.auth!.isStaff,
      kind: input.kind,
      packageCode: input.packageCode,
      days: input.days,
      useQuota: input.useQuota,
      gatewayCode: input.gatewayCode,
    });
    void recordAudit({ action: `listing.promote.${input.kind ?? input.packageCode}`, entityType: 'listing', entityId: id });
    return ok(res, result);
  }),
);

listingsRouter.post(
  '/:id/publish',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const result = await publishOwnedListing(
      id,
      req.auth!.userId,
      req.auth!.isStaff,
      req.auth!.roles,
      req.auth!.permissions,
    );
    void recordAudit({ action: 'listing.publish', entityType: 'listing', entityId: id });
    return ok(res, result);
  }),
);

listingsRouter.post(
  '/:id/archive',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({ reason: z.string().trim().max(500).optional() }).optional(),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = (req.body ?? {}) as { reason?: string };
    const result = await archiveOwnedListing(id, req.auth!.userId, req.auth!.isStaff, input.reason);
    void recordAudit({ action: 'listing.archive', entityType: 'listing', entityId: id });
    return ok(res, result);
  }),
);

listingsRouter.post(
  '/:id/restore',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const result = await restoreOwnedListing(id, req.auth!.userId, req.auth!.isStaff);
    void recordAudit({ action: 'listing.restore', entityType: 'listing', entityId: id });
    return ok(res, result);
  }),
);

listingsRouter.post(
  '/:id/reject',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: rejectListingSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<{ reasonCode: string; reason: string; details?: string }>(req);
    const result = await rejectOwnedListing(
      id,
      req.auth!.userId,
      req.auth!.isStaff,
      req.auth!.roles,
      req.auth!.permissions,
      input,
    );
    void recordAudit({ action: 'listing.reject', entityType: 'listing', entityId: id, after: input });
    return ok(res, result);
  }),
);

listingsRouter.post(
  '/:id/appeal',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: appealListingSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<{ note: string }>(req);
    return ok(res, await appealOwnedListing(id, req.auth!.userId, input.note));
  }),
);

listingsRouter.post(
  '/:id/transaction',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: transactionStatusSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<{
      status: 'available' | 'reserved' | 'sold' | 'rented';
      buyerId?: number;
      startsAt?: Date;
      endsAt?: Date;
    }>(req);
    const result = await setOwnedTransaction(id, req.auth!.userId, req.auth!.isStaff, input);
    void recordAudit({ action: `listing.transaction.${input.status}`, entityType: 'listing', entityId: id });
    return ok(res, result);
  }),
);

listingsRouter.post(
  '/:id/promotions',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: promoteListingSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<{
      kind?: 'feature' | 'boost' | 'urgent' | 'bump' | 'top_of_search' | 'homepage' | 'story';
      packageCode?: string;
      days: number;
      useQuota: boolean;
      gatewayCode?: string;
    }>(req);
    return ok(
      res,
      await promoteListing({
        listingId: id,
        userId: req.auth!.userId,
        isStaff: req.auth!.isStaff,
        kind: input.kind,
        packageCode: input.packageCode,
        days: input.days,
        useQuota: input.useQuota,
        gatewayCode: input.gatewayCode,
      }),
    );
  }),
);

listingsRouter.get(
  '/:id/promotions',
  authenticate,
  requireAuth,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return ok(res, await getOwnedPromotions(id, req.auth!.userId, req.auth!.isStaff));
  }),
);

listingsRouter.post(
  '/:id/favorite',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) =>
    created(res, await addFavorite(req.auth!.userId, { listingId: params<{ id: number }>(req).id })),
  ),
);

listingsRouter.delete(
  '/:id/favorite',
  authenticate,
  requireAuth,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    await removeFavoriteByEntity(req.auth!.userId, { listingId: params<{ id: number }>(req).id });
    return noContent(res);
  }),
);

listingsRouter.get(
  '/:id/analytics',
  authenticate,
  requireAuth,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const { days } = query<{ days: number }>(req);
    return ok(res, await getOwnedAnalytics(id, req.auth!.userId, req.auth!.isStaff, days));
  }),
);

listingsRouter.get(
  '/:id/events',
  authenticate,
  requireAuth,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return ok(res, await getOwnedEvents(id, req.auth!.userId, req.auth!.isStaff));
  }),
);

listingsRouter.get(
  '/:id/versions',
  authenticate,
  requireAuth,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return ok(res, await getOwnedVersions(id, req.auth!.userId, req.auth!.isStaff));
  }),
);

listingsRouter.get(
  '/:id/rejections',
  authenticate,
  requireAuth,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return ok(res, await getOwnedRejections(id, req.auth!.userId, req.auth!.isStaff));
  }),
);

listingsRouter.post(
  '/:id/share',
  authenticate,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: shareListingSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<{ channel: 'link' | 'whatsapp' | 'sms' | 'email' | 'other' }>(req);
    return ok(res, await shareListingPublic(id, req.auth?.userId ?? null, input.channel));
  }),
);

listingsRouter.get(
  '/:id/availability',
  authenticate,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), query: availabilityQuerySchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const range = query<{ from: Date; to: Date }>(req);
    return ok(res, await getListingAvailabilityWindow(id, range.from, range.to));
  }),
);

listingsRouter.post(
  '/:id/availability',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: availabilityBlockSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<{
      kind: 'booking' | 'reserved' | 'rented' | 'blocked' | 'maintenance';
      startsAt: Date;
      endsAt: Date;
      note?: string;
    }>(req);
    return created(res, await addOwnedAvailabilityBlock(id, req.auth!.userId, req.auth!.isStaff, input));
  }),
);

/* Media -------------------------------------------------------------------- */

listingsRouter.post(
  '/:id/media',
  authenticate,
  requireAuth,
  uploadRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: mediaUploadSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<z.infer<typeof mediaUploadSchema>>(req);
    return created(res, await addMedia(id, req.auth!.userId, req.auth!.isStaff, input));
  }),
);

listingsRouter.delete(
  '/:id/media/:mediaId',
  authenticate,
  requireAuth,
  validate({ params: z.object({ id: z.coerce.number().int().positive(), mediaId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id, mediaId } = params<{ id: number; mediaId: number }>(req);
    await deleteMedia(id, mediaId, req.auth!.userId, req.auth!.isStaff);
    return noContent(res);
  }),
);

listingsRouter.put(
  '/:id/media/order',
  authenticate,
  requireAuth,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({ mediaIds: z.array(z.coerce.number().int().positive()).min(1).max(50) }),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const { mediaIds } = body<{ mediaIds: number[] }>(req);
    await reorderMedia(id, req.auth!.userId, req.auth!.isStaff, mediaIds);
    return ok(res, { reordered: mediaIds.length });
  }),
);

/* Discovery ---------------------------------------------------------------- */

listingsRouter.get(
  '/:id/similar',
  authenticate,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    query: z.object({ limit: z.coerce.number().int().min(1).max(30).default(12) }),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const { limit } = query<{ limit: number }>(req);
    return ok(res, await getSimilarListings(id, req.context.language, limit));
  }),
);
