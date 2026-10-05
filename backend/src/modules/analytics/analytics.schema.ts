import { z } from 'zod';
import { MARKETPLACE_CODES } from '../seller/seller.schema';

export const analyticsQuerySchema = z.object({
  marketplace: z.enum(MARKETPLACE_CODES).optional(),
  companyId: z.coerce.number().int().positive().optional(),
  sellerId: z.coerce.number().int().positive().optional(),
  countryId: z.coerce.number().int().positive().optional(),
  regionId: z.coerce.number().int().positive().optional(),
  cityId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  device: z.enum(['phone', 'tablet', 'desktop', 'tv', 'other']).optional(),
  os: z.string().trim().max(32).optional(),
  source: z.enum(['direct', 'organic', 'paid', 'social', 'referral', 'email', 'push', 'affiliate']).optional(),
  period: z.enum(['today', '7d', '30d', '90d', '1y', 'custom']).default('30d'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  funnel: z.string().trim().max(64).optional(),
  heatmap: z.enum(['geo', 'listing', 'search', 'lead', 'sales', 'hour', 'dow']).optional(),
  export: z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    return value === true || value === 1 || value === '1' || value === 'true';
  }, z.boolean().optional()),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const ingestBodySchema = z.object({
  eventName: z.string().trim().min(1).max(64),
  properties: z.record(z.string(), z.unknown()).optional(),
  entityType: z.string().max(48).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  eventUuid: z.string().uuid().optional(),
  sessionId: z.string().trim().min(8).max(64).optional(),
});

export const ingestBatchSchema = z.object({
  events: z.array(ingestBodySchema).min(1).max(50),
});
