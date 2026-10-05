import { z } from 'zod';

export const MARKETPLACE_CODES = ['gold', 'property', 'vehicles'] as const;
export type MarketplaceCode = (typeof MARKETPLACE_CODES)[number];

export const dashboardQuerySchema = z.object({
  marketplace: z.enum(MARKETPLACE_CODES).optional(),
  /** Ignored unless the id is in the caller's authorized companies. */
  companyId: z.coerce.number().int().positive().optional(),
  /** Legacy numeric filter; ignored. Use `marketplace` codes only. */
  marketplaceId: z.coerce.number().int().positive().optional(),
  period: z.enum(['today', '7d', '30d', '90d', '1y', 'custom']).default('30d'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.string().max(48).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  export: z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    return value === true || value === 1 || value === '1' || value === 'true';
  }, z.boolean().optional()),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
