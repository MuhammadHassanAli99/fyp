import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, noContent, ok } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { resolveMarketplace } from '../../middleware/request-context';
import { aiRateLimit, writeRateLimit } from '../../middleware/rate-limit';
import { badRequest } from '../../core/errors';
import {
  addItem,
  compareByNames,
  createSet,
  deleteSet,
  generateAiComparison,
  getSet,
  listSets,
  removeItem,
  shareSet,
} from './comparison.service';

export const comparisonRouter = Router();

/**
 * Comparison is available to guests (§1 allows browsing), so every route takes
 * the owner from either the authenticated user or the guest session header.
 */
const ownerOf = (req: { auth: { userId: number } | null; guestUuid: string | null; context: { guestUuid: string | null } }) => ({
  userId: req.auth?.userId ?? null,
  guestUuid: req.auth ? null : (req.guestUuid ?? req.context.guestUuid),
});

comparisonRouter.use(authenticate);

comparisonRouter.get(
  '/',
  asyncHandler(async (req, res) => ok(res, await listSets(ownerOf(req)))),
);

comparisonRouter.post(
  '/',
  resolveMarketplace,
  writeRateLimit,
  validate({
    body: z.object({
      marketplaceId: z.coerce.number().int().positive().optional(),
      name: z.string().trim().max(128).optional(),
      listingIds: z.array(z.coerce.number().int().positive()).max(6).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ marketplaceId?: number; name?: string; listingIds?: number[] }>(req);
    const marketplaceId = input.marketplaceId ?? req.marketplaceId;
    if (!marketplaceId) throw badRequest('Specify which marketplace you are comparing in');

    const set = await createSet({
      owner: ownerOf(req),
      marketplaceId,
      name: input.name,
      listingIds: input.listingIds,
    });
    return created(res, set);
  }),
);

/**
 * Spec line 1: the user types 3–4 names and gets an automatic AI comparison.
 * This resolves the names to listings, builds the set and runs the AI in one call.
 */
comparisonRouter.post(
  '/by-names',
  resolveMarketplace,
  aiRateLimit,
  validate({
    body: z.object({
      marketplaceId: z.coerce.number().int().positive().optional(),
      names: z.array(z.string().trim().min(2).max(120)).min(2).max(4),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ marketplaceId?: number; names: string[] }>(req);
    const marketplaceId = input.marketplaceId ?? req.marketplaceId;
    if (!marketplaceId) throw badRequest('Specify which marketplace you are comparing in');

    const result = await compareByNames({
      owner: ownerOf(req),
      marketplaceId,
      names: input.names,
      countryId: req.context.countryId,
    });
    return created(res, result);
  }),
);

comparisonRouter.get(
  '/:idOrUuid',
  validate({
    params: z.object({ idOrUuid: z.string().min(1).max(64) }),
    query: z.object({ shared: z.coerce.boolean().default(false) }),
  }),
  asyncHandler(async (req, res) => {
    const { idOrUuid } = params<{ idOrUuid: string }>(req);
    const { shared } = query<{ shared: boolean }>(req);
    return ok(res, await getSet({ idOrUuid, owner: ownerOf(req), viaShareToken: shared }));
  }),
);

comparisonRouter.post(
  '/:idOrUuid/items',
  writeRateLimit,
  validate({
    params: z.object({ idOrUuid: z.string().min(1).max(64) }),
    body: z.object({ listingId: z.coerce.number().int().positive() }),
  }),
  asyncHandler(async (req, res) => {
    const { idOrUuid } = params<{ idOrUuid: string }>(req);
    const { listingId } = body<{ listingId: number }>(req);
    return ok(res, await addItem({ setId: idOrUuid, owner: ownerOf(req), listingId }));
  }),
);

comparisonRouter.delete(
  '/:idOrUuid/items/:listingId',
  validate({
    params: z.object({ idOrUuid: z.string().min(1).max(64), listingId: z.coerce.number().int().positive() }),
  }),
  asyncHandler(async (req, res) => {
    const { idOrUuid, listingId } = params<{ idOrUuid: string; listingId: number }>(req);
    return ok(res, await removeItem({ setId: idOrUuid, owner: ownerOf(req), listingId }));
  }),
);

/** Manual trigger, for re-running after the set changed or the user asks again. */
comparisonRouter.post(
  '/:idOrUuid/ai',
  aiRateLimit,
  validate({
    params: z.object({ idOrUuid: z.string().min(1).max(64) }),
    body: z.object({ force: z.coerce.boolean().default(false) }),
  }),
  asyncHandler(async (req, res) => {
    const { idOrUuid } = params<{ idOrUuid: string }>(req);
    const { force } = body<{ force: boolean }>(req);
    const verdict = await generateAiComparison(idOrUuid, ownerOf(req), force);
    return ok(res, {
      verdict,
      disclaimer:
        'This comparison is generated from the listing details each seller provided. Verify the specifications and inspect in person before buying.',
    });
  }),
);

comparisonRouter.post(
  '/:idOrUuid/share',
  validate({ params: z.object({ idOrUuid: z.string().min(1).max(64) }) }),
  asyncHandler(async (req, res) => {
    const { idOrUuid } = params<{ idOrUuid: string }>(req);
    return ok(res, await shareSet(idOrUuid, ownerOf(req)));
  }),
);

comparisonRouter.delete(
  '/:idOrUuid',
  validate({ params: z.object({ idOrUuid: z.string().min(1).max(64) }) }),
  asyncHandler(async (req, res) => {
    const { idOrUuid } = params<{ idOrUuid: string }>(req);
    await deleteSet(idOrUuid, ownerOf(req));
    return noContent(res);
  }),
);
