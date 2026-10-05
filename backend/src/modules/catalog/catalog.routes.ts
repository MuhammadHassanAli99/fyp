import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { ok, withCache } from '../../core/http/response';
import { validate, params, query } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { resolveMarketplace } from '../../middleware/request-context';
import {
  getAttributes,
  getCategory,
  getCategoryTree,
  getFilterDefinition,
  getMarketplace,
  listMarketplaces,
} from './catalog.service';

export const catalogRouter = Router();

catalogRouter.use(authenticate);

catalogRouter.get(
  '/marketplaces',
  asyncHandler(async (req, res) => {
    withCache(res, 600);
    return ok(res, await listMarketplaces(req.context.countryId, req.context.language));
  }),
);

catalogRouter.get(
  '/marketplaces/:codeOrId',
  validate({ params: z.object({ codeOrId: z.string().min(1).max(64) }) }),
  asyncHandler(async (req, res) => {
    const { codeOrId } = params<{ codeOrId: string }>(req);
    withCache(res, 600);
    return ok(res, await getMarketplace(codeOrId));
  }),
);

catalogRouter.get(
  '/:marketplaceId/categories',
  resolveMarketplace,
  validate({
    params: z.object({ marketplaceId: z.coerce.number().int().positive() }),
  }),
  asyncHandler(async (req, res) => {
    const marketplaceId = req.marketplaceId ?? Number(params<{ marketplaceId: number }>(req).marketplaceId);
    withCache(res, 900);
    return ok(res, await getCategoryTree(marketplaceId, req.context.language));
  }),
);

catalogRouter.get(
  '/:marketplaceId/categories/:idOrSlug',
  resolveMarketplace,
  validate({
    params: z.object({
      marketplaceId: z.coerce.number().int().positive(),
      idOrSlug: z.string().min(1).max(128),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { marketplaceId, idOrSlug } = params<{ marketplaceId: number; idOrSlug: string }>(req);
    withCache(res, 900);
    return ok(res, await getCategory(req.marketplaceId ?? marketplaceId, idOrSlug, req.context.language));
  }),
);

catalogRouter.get(
  '/:marketplaceId/attributes',
  resolveMarketplace,
  validate({
    params: z.object({ marketplaceId: z.coerce.number().int().positive() }),
    query: z.object({
      categoryId: z.coerce.number().int().positive().optional(),
      filterable: z.coerce.boolean().optional(),
      comparable: z.coerce.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { marketplaceId } = params<{ marketplaceId: number }>(req);
    const q = query<{ categoryId?: number; filterable?: boolean; comparable?: boolean }>(req);
    withCache(res, 900);
    return ok(
      res,
      await getAttributes({
        marketplaceId: req.marketplaceId ?? marketplaceId,
        categoryId: q.categoryId ?? null,
        language: req.context.language,
        onlyFilterable: q.filterable,
        onlyComparable: q.comparable,
      }),
    );
  }),
);

catalogRouter.get(
  '/:marketplaceId/filters',
  resolveMarketplace,
  validate({
    params: z.object({ marketplaceId: z.coerce.number().int().positive() }),
    query: z.object({ categoryId: z.coerce.number().int().positive().optional() }),
  }),
  asyncHandler(async (req, res) => {
    const { marketplaceId } = params<{ marketplaceId: number }>(req);
    const { categoryId } = query<{ categoryId?: number }>(req);
    withCache(res, 900);
    return ok(
      res,
      await getFilterDefinition(req.marketplaceId ?? marketplaceId, categoryId ?? null, req.context.language),
    );
  }),
);
