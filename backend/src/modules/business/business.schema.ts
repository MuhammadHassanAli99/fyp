import { z } from 'zod';

export const BUSINESS_KINDS = ['company', 'dealer', 'agency', 'builder', 'gold_shop'] as const;
export const MEMBER_ROLES = [
  'owner',
  'admin',
  'manager',
  'agent',
  'staff',
  'salesperson',
  'editor',
  'accountant',
  'support',
] as const;
export const INVITABLE_ROLES = MEMBER_ROLES.filter((role) => role !== 'owner');

export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ROLE_PERMISSIONS: Record<MemberRole, readonly string[]> = {
  owner: ['*'],
  admin: ['business.update', 'business.invite', 'business.remove_member', 'business.change_role', 'listing.post', 'listing.reply', 'billing'],
  manager: ['business.update', 'business.invite', 'listing.post', 'listing.reply'],
  agent: ['listing.post', 'listing.reply'],
  salesperson: ['listing.post', 'listing.reply'],
  editor: ['listing.post'],
  accountant: ['billing'],
  support: ['listing.reply'],
  staff: ['listing.reply'],
};

export function roleAllows(role: MemberRole, permission: string): boolean {
  const granted = ROLE_PERMISSIONS[role] ?? [];
  return granted.includes('*') || granted.includes(permission);
}

const hoursSchema = z.record(z.string(), z.unknown()).optional();

export const createBusinessSchema = z.object({
  kind: z.enum(BUSINESS_KINDS),
  legalName: z.string().trim().min(2).max(191),
  tradeName: z.string().trim().max(191).optional(),
  description: z.string().trim().max(5000).optional(),
  website: z.string().url().max(255).optional(),
  registrationNo: z.string().trim().max(96).optional(),
  licenseReference: z.string().trim().max(191).optional(),
  taxId: z.string().trim().max(96).optional(),
  countryId: z.coerce.number().int().positive().optional(),
  regionId: z.coerce.number().int().positive().optional(),
  cityId: z.coerce.number().int().positive().optional(),
  address: z.string().trim().max(255).optional(),
  contactPhone: z.string().trim().max(24).optional(),
  contactEmail: z.string().email().max(191).optional(),
  establishedYear: z.coerce.number().int().min(1800).max(2100).optional(),
  businessHours: hoursSchema,
  socialLinks: z.record(z.string(), z.string().url().max(255)).optional(),
  marketplaces: z.array(z.enum(['gold', 'property', 'vehicles'])).optional(),
});

export const updateBusinessSchema = createBusinessSchema.partial().omit({ kind: true });

export const inviteMemberSchema = z.object({
  email: z.string().email().max(191).optional(),
  phone: z.string().trim().max(24).optional(),
  userId: z.coerce.number().int().positive().optional(),
  role: z.enum(['admin', 'manager', 'agent', 'staff', 'salesperson', 'editor', 'accountant', 'support']).default('agent'),
}).refine((data) => Boolean(data.email || data.phone || data.userId), {
  message: 'Provide an email, phone or user id',
});

export const changeRoleSchema = z.object({
  role: z.enum(['admin', 'manager', 'agent', 'staff', 'salesperson', 'editor', 'accountant', 'support']),
});

export const transferOwnershipSchema = z.object({
  toUserId: z.coerce.number().int().positive(),
  password: z.string().min(8).max(128),
});

export const acceptInvitationSchema = z.object({
  token: z.string().trim().min(16).max(128),
});

export const dealerExtensionSchema = z.object({
  dealerLicense: z.string().trim().max(191).optional(),
  hasServiceCenter: z.coerce.boolean().optional(),
  notes: z.string().trim().max(1000).optional(),
  brands: z.array(z.string().trim().min(1).max(96)).max(40).optional(),
});

export const agencyExtensionSchema = z.object({
  agencyLicense: z.string().trim().max(191).optional(),
  propertyCategories: z.array(z.string().trim().max(64)).max(40).optional(),
  notes: z.string().trim().max(1000).optional(),
  areaIds: z.array(z.coerce.number().int().positive()).max(80).optional(),
  cityIds: z.array(z.coerce.number().int().positive()).max(40).optional(),
});

export const builderExtensionSchema = z.object({
  builderRegistration: z.string().trim().max(191).optional(),
  constructionHistory: z.string().trim().max(8000).optional(),
  notes: z.string().trim().max(1000).optional(),
  projects: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(191),
        cityId: z.coerce.number().int().positive().optional(),
        status: z.enum(['planned', 'under_construction', 'completed', 'on_hold']).optional(),
        completedYear: z.coerce.number().int().min(1900).max(2100).optional(),
      }),
    )
    .max(40)
    .optional(),
});

export const goldShopExtensionSchema = z.object({
  certifications: z.array(z.string().trim().max(96)).max(20).optional(),
  notes: z.string().trim().max(1000).optional(),
  offerings: z
    .array(
      z.object({
        category: z.string().trim().min(1).max(64),
        purity: z.string().trim().max(32).optional(),
      }),
    )
    .max(40)
    .optional(),
});

export const locationSchema = z.object({
  kind: z.enum(['office', 'showroom', 'service_center', 'shop', 'project', 'other']).default('office'),
  name: z.string().trim().max(191).optional(),
  countryId: z.coerce.number().int().positive().optional(),
  regionId: z.coerce.number().int().positive().optional(),
  cityId: z.coerce.number().int().positive().optional(),
  address: z.string().trim().max(255).optional(),
  phone: z.string().trim().max(24).optional(),
  isPrimary: z.coerce.boolean().optional(),
});

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type DealerExtensionInput = z.infer<typeof dealerExtensionSchema>;
export type AgencyExtensionInput = z.infer<typeof agencyExtensionSchema>;
export type BuilderExtensionInput = z.infer<typeof builderExtensionSchema>;
export type GoldShopExtensionInput = z.infer<typeof goldShopExtensionSchema>;
export type LocationInput = z.infer<typeof locationSchema>;
