import { z } from 'zod';
import { usernameSchema } from '../auth/auth.schema';

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(128).optional(),
  firstName: z.string().trim().max(96).optional(),
  lastName: z.string().trim().max(96).optional(),
  bio: z.string().trim().max(1000).optional().nullable(),
  dateOfBirth: z.string().date().optional().nullable(),
  gender: z.enum(['male', 'female', 'other', 'undisclosed']).optional().nullable(),
  addressLine1: z.string().trim().max(191).optional(),
  addressLine2: z.string().trim().max(191).optional(),
  postalCode: z.string().trim().max(24).optional(),
  website: z.string().url().max(255).optional().nullable(),
  whatsapp: z.string().trim().max(24).optional().nullable(),
  showPhone: z.coerce.boolean().optional(),
  showEmail: z.coerce.boolean().optional(),
  showWhatsapp: z.coerce.boolean().optional(),
});

export const updatePreferencesSchema = z.object({
  countryId: z.coerce.number().int().positive().optional(),
  language: z.string().trim().min(2).max(10).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  timezone: z.string().trim().max(64).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  measurementSystem: z.enum(['metric', 'imperial']).optional(),
});

export const updateLocationSchema = z.object({
  countryId: z.coerce.number().int().positive().optional().nullable(),
  regionId: z.coerce.number().int().positive().optional().nullable(),
  cityId: z.coerce.number().int().positive().optional().nullable(),
  areaId: z.coerce.number().int().positive().optional().nullable(),
  postalCode: z.string().trim().max(24).optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  source: z.enum(['manual', 'gps', 'ip', 'profile', 'listing', 'device']).optional(),
});

export const mergePreferencesSchema = z.object({
  countryId: z.coerce.number().int().positive().optional().nullable(),
  language: z.string().trim().min(2).max(10).optional().nullable(),
  currency: z.string().length(3).toUpperCase().optional().nullable(),
  timezone: z.string().trim().max(64).optional().nullable(),
  theme: z.enum(['light', 'dark', 'system']).optional().nullable(),
  measurementSystem: z.enum(['metric', 'imperial']).optional().nullable(),
  regionId: z.coerce.number().int().positive().optional().nullable(),
  cityId: z.coerce.number().int().positive().optional().nullable(),
  areaId: z.coerce.number().int().positive().optional().nullable(),
  postalCode: z.string().trim().max(24).optional().nullable(),
  locationSource: z.enum(['manual', 'gps', 'ip', 'profile', 'listing', 'device']).optional().nullable(),
});

export const setLastMarketplaceSchema = z.object({
  marketplaceId: z.coerce.number().int().positive(),
});

export const changeUsernameSchema = z.object({
  username: usernameSchema,
});

export const usernameLookupSchema = z.object({
  username: z.string().trim().min(1).max(32),
});

export const confirmAvatarSchema = z.object({
  storagePath: z.string().trim().min(8).max(512),
});

export const updatePrivacySchema = z.object({
  visibility: z.enum(['public', 'registered', 'private']).optional(),
  showPhone: z.coerce.boolean().optional(),
  showEmail: z.coerce.boolean().optional(),
  showWhatsapp: z.coerce.boolean().optional(),
  showLocation: z.coerce.boolean().optional(),
  showListings: z.coerce.boolean().optional(),
  showBusinesses: z.coerce.boolean().optional(),
  showReviews: z.coerce.boolean().optional(),
  showLastActive: z.coerce.boolean().optional(),
});

export const publicUsernameParam = z.object({
  username: z.string().trim().min(3).max(32),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type MergePreferencesInput = z.infer<typeof mergePreferencesSchema>;
export type UpdatePrivacyInput = z.infer<typeof updatePrivacySchema>;
export type ConfirmAvatarInput = z.infer<typeof confirmAvatarSchema>;
