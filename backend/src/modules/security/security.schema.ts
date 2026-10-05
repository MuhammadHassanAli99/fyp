import { z } from 'zod';

export const privacyCreateSchema = z.object({
  kind: z.enum(['export', 'erasure', 'rectification', 'restriction', 'portability', 'access', 'deletion', 'correction', 'opt_out', 'disclosure']),
  regulation: z.enum(['gdpr', 'ccpa', 'other']).optional(),
  notes: z.string().trim().max(500).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
});

export const consentUpdateSchema = z.object({
  consentType: z.enum([
    'terms',
    'privacy',
    'marketing_email',
    'marketing_sms',
    'marketing_push',
    'cookies_analytics',
    'cookies_ads',
    'data_processing',
    'location',
  ]),
  granted: z.coerce.boolean(),
  documentVersion: z.string().trim().max(24).optional(),
});

export const privacyStaffDecideSchema = z.object({
  status: z.enum(['completed', 'rejected', 'in_progress']),
  notes: z.string().trim().max(500).optional(),
});

export const sessionRevokeOthersSchema = z.object({
  keepCurrent: z.coerce.boolean().default(true),
});
