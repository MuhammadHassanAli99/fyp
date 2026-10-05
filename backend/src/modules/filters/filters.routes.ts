import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { ok } from '../../core/http/response';
import { validate, query, body } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { resolveMarketplace } from '../../middleware/request-context';
import { searchRateLimit } from '../../middleware/rate-limit';
import { listFilterDefinitions, lookupFilterValues, resolveFilters } from './filters.service';
import { filterStateFromQueryParams } from './filters.state';
import { visibleDefinitions } from './filters.validate';

export const filtersRouter = Router();
filtersRouter.use(authenticate);

const marketplaceQuery = z
  .string()
  .max(32)
  .optional()
  .transform((value) => (value === 'gold' || value === 'property' || value === 'vehicles' || value === 'parts' ? value : undefined));

filtersRouter.get(
  '/definitions',
  resolveMarketplace,
  searchRateLimit,
  validate({
    query: z.object({
      marketplace: marketplaceQuery,
      category: z.string().max(64).optional(),
      subcategory: z.string().max(64).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ marketplace?: string; category?: string; subcategory?: string }>(req);
    const marketplace = q.marketplace ?? req.marketplaceCode ?? null;
    return ok(res, await listFilterDefinitions({ marketplace, category: q.category, subcategory: q.subcategory }));
  }),
);

filtersRouter.get(
  '/lookups',
  resolveMarketplace,
  searchRateLimit,
  validate({
    query: z.object({
      key: z.string().trim().min(1).max(64),
      marketplace: marketplaceQuery,
      parentKey: z.string().max(64).optional(),
      parentValue: z.string().max(96).optional(),
      q: z.string().trim().max(96).optional(),
      countryId: z.coerce.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{
      key: string;
      marketplace?: string;
      parentKey?: string;
      parentValue?: string;
      q?: string;
      countryId?: number;
    }>(req);
    return ok(
      res,
      await lookupFilterValues({
        key: q.key,
        marketplace: q.marketplace ?? req.marketplaceCode ?? null,
        parentKey: q.parentKey ?? null,
        parentValue: q.parentValue ?? null,
        q: q.q ?? null,
        countryId: q.countryId ?? req.context.countryId,
      }),
    );
  }),
);

filtersRouter.post(
  '/validate',
  resolveMarketplace,
  searchRateLimit,
  validate({
    body: z.object({
      marketplace: z.string().max(32).nullable().optional(),
      category: z.string().max(64).nullable().optional(),
      subcategory: z.string().max(64).nullable().optional(),
      values: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      marketplace?: string | null;
      category?: string | null;
      subcategory?: string | null;
      values?: Record<string, unknown>;
    }>(req);
    return ok(
      res,
      await resolveFilters({
        marketplace: input.marketplace ?? req.marketplaceCode ?? null,
        category: input.category,
        subcategory: input.subcategory,
        values: input.values,
        currency: req.context.currency,
        language: req.context.language,
        countryCode: req.context.countryCode,
      }),
    );
  }),
);

filtersRouter.get(
  '/serialize',
  resolveMarketplace,
  validate({
    query: z.record(z.string(), z.unknown()),
  }),
  asyncHandler(async (req, res) => {
    const state = filterStateFromQueryParams(req.query as Record<string, unknown>, {
      marketplace: req.marketplaceCode,
      currency: req.context.currency,
    });
    return ok(res, {
      state,
      query: Object.fromEntries(
        Object.entries(req.query).filter(([key]) => !['ownerId', 'userId', 'sellerId', 'email', 'phone'].includes(key)),
      ),
      definitions: visibleDefinitions(state).map((item) => item.key),
    });
  }),
);
