import { z } from 'zod';
import { paginationSchema } from '../../core/http/pagination';
import { SCOPE_TYPES } from '../../middleware/grants';

export const adminListQuery = paginationSchema.extend({
  q: z.string().trim().max(191).optional(),
  status: z.string().trim().max(48).optional(),
  countryId: z.coerce.number().int().positive().optional(),
  marketplaceId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  companyId: z.coerce.number().int().positive().optional(),
  salesmanId: z.coerce.number().int().positive().optional(),
  from: z.string().max(32).optional(),
  to: z.string().max(32).optional(),
  currency: z.string().length(3).optional(),
});

export const reasonSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  confirm: z.boolean().optional(),
  approvalRequestUuid: z.string().uuid().optional(),
});

export const userActionSchema = reasonSchema.extend({
  status: z.enum(['active', 'suspended', 'banned']).optional(),
});

export const assignRoleSchema = z.object({
  roleCode: z.string().trim().min(1).max(64),
  scopeType: z.enum(SCOPE_TYPES).default('GLOBAL'),
  countryId: z.coerce.number().int().positive().optional(),
  regionId: z.coerce.number().int().positive().optional(),
  cityId: z.coerce.number().int().positive().optional(),
  marketplaceId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  businessId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
  reason: z.string().trim().max(255).optional(),
});

export const roleUpdateSchema = z.object({
  name: z.string().trim().min(2).max(96).optional(),
  description: z.string().trim().max(255).optional(),
  permissionCodes: z.array(z.string().trim().min(1).max(96)).max(400).optional(),
});

export const createRoleSchema = z.object({
  code: z.string().trim().min(2).max(64).regex(/^[a-z][a-z0-9_]+$/),
  name: z.string().trim().min(2).max(96),
  description: z.string().trim().max(255).optional(),
  isStaff: z.boolean().default(false),
  permissionCodes: z.array(z.string().trim().min(1).max(96)).default([]),
});

export const listingActionSchema = reasonSchema.extend({
  reasonCode: z.string().trim().max(64).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export const categoryUpsertSchema = z.object({
  marketplaceId: z.coerce.number().int().positive(),
  parentId: z.coerce.number().int().positive().nullable().optional(),
  code: z.string().trim().min(2).max(64),
  name: z.string().trim().min(2).max(128),
  slug: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().max(64).optional(),
  operations: z.array(z.string()).optional(),
  groupCode: z.string().trim().max(48).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
  validation: z.record(z.string(), z.unknown()).optional(),
});

export const countryUpdateSchema = z.object({
  name: z.string().trim().max(128).optional(),
  dialCode: z.string().trim().max(8).optional(),
  defaultCurrency: z.string().length(3).optional(),
  defaultLanguage: z.string().trim().max(10).optional(),
  defaultTimezone: z.string().trim().max(64).optional(),
  dateFormat: z.string().trim().max(32).optional(),
  timeFormat: z.string().trim().max(16).optional(),
  numberFormat: z.record(z.string(), z.unknown()).optional(),
  vatRate: z.coerce.number().min(0).max(100).optional(),
  requiresKyc: z.boolean().optional(),
  requiresAml: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const languageUpdateSchema = z.object({
  name: z.string().trim().max(96).optional(),
  nativeName: z.string().trim().max(96).optional(),
  direction: z.enum(['ltr', 'rtl']).optional(),
  isActive: z.boolean().optional(),
});

export const currencyUpdateSchema = z.object({
  name: z.string().trim().max(96).optional(),
  symbol: z.string().trim().max(8).optional(),
  decimals: z.coerce.number().int().min(0).max(6).optional(),
  isActive: z.boolean().optional(),
  rate: z.coerce.number().positive().optional(),
  rateProvider: z.string().trim().max(32).optional(),
});

export const translationUpsertSchema = z.object({
  language: z.string().trim().min(2).max(10),
  namespace: z.string().trim().min(1).max(64).default('common'),
  key: z.string().trim().min(1).max(191),
  value: z.string().min(1).max(8000),
});

export const cmsPageSchema = z.object({
  slug: z.string().trim().min(2).max(200).optional(),
  title: z.string().trim().min(2).max(255),
  body: z.string().max(200_000).optional(),
  kind: z.enum(['page', 'landing', 'help', 'legal', 'blog']).optional(),
  status: z.enum(['draft', 'in_review', 'scheduled', 'published', 'archived']).optional(),
  visibility: z.enum(['public', 'logged_in', 'staff']).optional(),
  seoTitle: z.string().trim().max(255).optional(),
  seoDescription: z.string().trim().max(500).optional(),
  marketplaceId: z.coerce.number().int().positive().optional(),
  scheduledAt: z.string().datetime().optional(),
});

export const bannerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  placement: z.string().trim().min(2).max(64),
  title: z.string().trim().max(191).optional(),
  subtitle: z.string().trim().max(255).optional(),
  imageUrl: z.string().url().max(512).optional(),
  ctaLabel: z.string().trim().max(96).optional(),
  ctaUrl: z.string().url().max(512).optional(),
  marketplaceId: z.coerce.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  priority: z.coerce.number().int().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});

export const broadcastSchema = z.object({
  title: z.string().trim().min(2).max(191),
  body: z.string().trim().min(2).max(2000),
  channels: z.array(z.enum(['push', 'email', 'sms', 'in_app'])).min(1),
  audience: z.enum(['all', 'country', 'city', 'marketplace', 'category', 'subscription', 'company', 'role', 'users']),
  countryId: z.coerce.number().int().positive().optional(),
  cityId: z.coerce.number().int().positive().optional(),
  marketplaceId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  companyId: z.coerce.number().int().positive().optional(),
  roleCode: z.string().trim().max(64).optional(),
  userIds: z.array(z.coerce.number().int().positive()).max(500).optional(),
  scheduledFor: z.string().datetime().optional(),
  categoryCode: z.string().trim().max(64).optional(),
});

export const ticketAssignSchema = z.object({
  assignedTo: z.coerce.number().int().positive().optional(),
  assignedTeam: z.string().trim().max(64).optional(),
  status: z
    .enum(['new', 'open', 'pending_customer', 'pending_internal', 'on_hold', 'resolved', 'closed', 'reopened'])
    .optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  note: z.string().trim().max(5000).optional(),
});

export const ticketReplySchema = z.object({
  body: z.string().trim().min(1).max(5000),
  internal: z.boolean().optional(),
});

export const employeeSchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'manager', 'agent', 'staff', 'salesperson', 'editor', 'accountant', 'support']),
  departmentId: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  reportsTo: z.coerce.number().int().positive().optional(),
  canPost: z.boolean().optional(),
  canReply: z.boolean().optional(),
  canBilling: z.boolean().optional(),
});

export const departmentSchema = z.object({
  code: z.string().trim().min(2).max(64),
  name: z.string().trim().min(2).max(128),
  kind: z.enum(['sales', 'finance', 'support', 'marketing', 'operations', 'other']).default('other'),
  managerUserId: z.coerce.number().int().positive().optional(),
});

export const leadSchema = z.object({
  title: z.string().trim().min(2).max(191),
  businessId: z.coerce.number().int().positive(),
  assignedTo: z.coerce.number().int().positive().optional(),
  customerUserId: z.coerce.number().int().positive().optional(),
  listingId: z.coerce.number().int().positive().optional(),
  marketplaceId: z.coerce.number().int().positive().optional(),
  source: z.string().trim().max(64).optional(),
  expectedValue: z.coerce.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  notes: z.string().trim().max(5000).optional(),
});

export const leadUpdateSchema = leadSchema.partial().extend({
  status: z.enum(['new', 'contacted', 'qualified', 'appointment', 'quoted', 'won', 'lost']).optional(),
  nextFollowUpAt: z.string().datetime().optional(),
});

export const appointmentSchema = z.object({
  leadId: z.coerce.number().int().positive(),
  listingId: z.coerce.number().int().positive().optional(),
  scheduledFor: z.string().datetime(),
  location: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const quoteSchema = z.object({
  leadId: z.coerce.number().int().positive(),
  listingId: z.coerce.number().int().positive().optional(),
  amount: z.coerce.number().positive(),
  currency: z.string().length(3),
  validUntil: z.string().max(32).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const reportJobSchema = z.object({
  reportType: z.enum([
    'users',
    'listings',
    'transactions',
    'revenue',
    'subscriptions',
    'payments',
    'advertisements',
    'reviews',
    'fraud',
    'support',
    'sales',
    'companies',
    'salesmen',
  ]),
  filters: z.record(z.string(), z.unknown()).optional(),
});

export const refundAdminSchema = reasonSchema.extend({
  amount: z.coerce.number().positive().optional(),
});

export const subscriptionOverrideSchema = z.object({
  planCode: z.string().trim().max(64).optional(),
  status: z.enum(['active', 'cancelled', 'past_due', 'trialing', 'paused', 'grace', 'suspended']).optional(),
  reason: z.string().trim().min(3).max(500),
});

export const approvalDecideSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(3).max(500),
});

export const companyStatusSchema = reasonSchema.extend({
  status: z.enum(['draft', 'pending', 'active', 'suspended', 'rejected']),
});

export const noteSchema = z.object({
  leadId: z.coerce.number().int().positive().optional(),
  listingId: z.coerce.number().int().positive().optional(),
  businessId: z.coerce.number().int().positive(),
  body: z.string().trim().min(1).max(5000),
});

export const listingActionParam = z.object({
  id: z.coerce.number().int().positive(),
  action: z.enum(['approve', 'reject', 'suspend', 'feature', 'boost', 'expire', 'restore', 'archive', 'delete']),
});

export type AdminListQuery = z.infer<typeof adminListQuery>;
