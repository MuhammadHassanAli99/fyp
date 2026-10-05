import { z } from 'zod';

export const PERSONAL_DOC_TYPES = ['government_id', 'passport', 'driving_license'] as const;
export const BUSINESS_DOC_TYPES = ['business_license'] as const;
export const DOC_TYPES = [...PERSONAL_DOC_TYPES, ...BUSINESS_DOC_TYPES, 'tax_certificate', 'utility_bill', 'selfie', 'ownership_proof'] as const;

export const PUBLIC_STATUS: Record<string, string> = {
  pending: 'PENDING',
  in_review: 'UNDER_REVIEW',
  action_required: 'ACTION_REQUIRED',
  approved: 'VERIFIED',
  rejected: 'REJECTED',
  expired: 'EXPIRED',
  revoked: 'REVOKED',
};

export function toPublicStatus(status: string | null | undefined): string {
  if (!status) return 'NOT_STARTED';
  return PUBLIC_STATUS[status] ?? 'PENDING';
}

export const startVerificationSchema = z.object({
  docType: z.enum(DOC_TYPES),
  businessId: z.coerce.number().int().positive().optional(),
  issuingCountryId: z.coerce.number().int().positive().optional(),
  docNumber: z.string().trim().max(96).optional(),
  issuedOn: z.string().date().optional(),
  expiresOn: z.string().date().optional(),
});

export const attachDocumentSchema = z.object({
  storagePath: z.string().trim().min(8).max(512),
  side: z.enum(['front', 'back', 'selfie', 'page', 'other']).default('front'),
  mimeType: z.string().trim().min(3).max(96).optional(),
});

export const reviewVerificationSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'action_required', 'revoked']),
  reason: z.string().trim().max(255).optional(),
});

export type StartVerificationInput = z.infer<typeof startVerificationSchema>;
export type AttachDocumentInput = z.infer<typeof attachDocumentSchema>;
export type ReviewVerificationInput = z.infer<typeof reviewVerificationSchema>;
