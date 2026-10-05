import { z } from 'zod';
import { paginationSchema } from '../../core/http/pagination';

/** §8 Listing System — the state machine's legal transitions. */
export const LISTING_STATUSES = [
  'draft',
  'validating',
  'pending_review',
  'published',
  'rejected',
  'expired',
  'sold',
  'rented',
  'reserved',
  'archived',
  'removed',
  'suspended',
  'cancelled',
  'completed',
] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

/**
 * Who may move a listing where. The owner can never publish straight past
 * review, and only a moderator can reject or remove.
 */
export const ALLOWED_TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  draft: ['validating', 'pending_review', 'published', 'archived', 'removed', 'cancelled'],
  validating: ['pending_review', 'published', 'rejected', 'draft', 'cancelled'],
  pending_review: ['published', 'rejected', 'draft', 'archived', 'removed', 'suspended', 'validating'],
  published: ['sold', 'rented', 'reserved', 'expired', 'archived', 'pending_review', 'removed', 'suspended', 'cancelled', 'completed'],
  rejected: ['draft', 'pending_review', 'archived', 'removed'],
  expired: ['published', 'pending_review', 'archived', 'removed'],
  sold: ['archived', 'published', 'completed'],
  rented: ['archived', 'published', 'completed'],
  reserved: ['published', 'sold', 'rented', 'expired', 'cancelled', 'completed'],
  archived: ['draft', 'published'],
  removed: [],
  suspended: ['published', 'pending_review', 'removed', 'archived'],
  cancelled: ['archived', 'draft'],
  completed: ['archived'],
};

const locationSchema = z.object({
  countryId: z.coerce.number().int().positive().optional(),
  regionId: z.coerce.number().int().positive().optional(),
  cityId: z.coerce.number().int().positive().optional(),
  areaId: z.coerce.number().int().positive().optional(),
  address: z.string().trim().max(255).optional(),
  postalCode: z.string().trim().max(24).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  hideExactLocation: z.coerce.boolean().default(false),
});

export const createListingSchema = z.object({
  marketplaceId: z.coerce.number().int().positive().optional(),
  marketplace: z.string().max(32).optional(),
  categoryId: z.coerce.number().int().positive(),
  operation: z.enum(['buy', 'sell', 'rent', 'auction', 'exchange']).default('sell'),

  title: z.string().trim().min(6, 'Give your listing a descriptive title').max(191),
  description: z.string().trim().max(20_000).optional(),
  conditionCode: z
    .enum([
      'new',
      'like_new',
      'excellent',
      'good',
      'fair',
      'used',
      'refurbished',
      'for_parts',
      'under_construction',
      'certified_used',
      'damaged',
      'salvage',
      'restored',
      'classic',
      'antique',
      'rebuilt',
    ])
    .optional(),

  price: z.coerce.number().min(0).max(1_000_000_000_000).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  priceType: z.enum(['fixed', 'negotiable', 'on_call', 'starting_from', 'auction', 'free']).default('fixed'),
  pricePeriod: z
    .enum([
      'total', 'per_month', 'per_week', 'per_day', 'per_night', 'per_hour', 'per_year',
      'per_gram', 'per_tola', 'per_ounce', 'per_sqft', 'per_sqm', 'per_marla', 'per_kanal',
    ])
    .default('total'),
  priceNegotiable: z.coerce.boolean().default(false),
  installmentsAvailable: z.coerce.boolean().default(false),

  location: locationSchema.optional(),

  contactPhone: z.string().trim().max(24).optional(),
  contactWhatsapp: z.string().trim().max(24).optional(),
  allowChat: z.coerce.boolean().default(true),
  allowCalls: z.coerce.boolean().default(true),
  allowOffers: z.coerce.boolean().default(true),

  businessId: z.coerce.number().int().positive().optional(),

  /** EAV values keyed by attribute code. */
  attributes: z.record(z.string().max(64), z.unknown()).optional(),
  /** Marketplace-specific detail payload, validated by the module. */
  details: z.unknown().optional(),

  media: z
    .array(
      z.object({
        url: z.string().url().max(512),
        thumbUrl: z.string().url().max(512).optional(),
        kind: z.enum(['image', 'video', 'tour_360', 'floor_plan', 'audio']).default('image'),
        caption: z.string().trim().max(191).optional(),
        isPrimary: z.coerce.boolean().default(false),
        width: z.coerce.number().int().positive().optional(),
        height: z.coerce.number().int().positive().optional(),
        durationSecs: z.coerce.number().int().positive().optional(),
      }),
    )
    .max(50)
    .optional(),

  documents: z
    .array(
      z.object({
        docType: z.enum([
          'ownership', 'title_deed', 'title_registry', 'map', 'site_plan', 'approval', 'noc', 'tax_receipt',
          'registration', 'transfer_letter', 'inspection', 'certificate', 'assay', 'invoice',
          'insurance', 'building_approval', 'completion_certificate',
          'title', 'bill_of_sale', 'certificate_of_origin', 'export_certificate',
          'import_permit', 'customs_declaration', 'inspection_certificate',
          'bill_of_lading', 'commercial_invoice', 'shipping', 'vin_photo', 'other',
        ]),
        title: z.string().trim().max(191).optional(),
        fileUrl: z.string().url().max(512),
        isPublic: z.coerce.boolean().default(false),
      }),
    )
    .max(20)
    .optional(),

  /** Auction terms, only read when operation === 'auction'. */
  auction: z
    .object({
      startPrice: z.coerce.number().min(0),
      reservePrice: z.coerce.number().min(0).optional(),
      buyNowPrice: z.coerce.number().min(0).optional(),
      bidIncrement: z.coerce.number().positive().default(1),
      startsAt: z.coerce.date(),
      endsAt: z.coerce.date(),
      antiSnipeSecs: z.coerce.number().int().min(0).max(600).default(0),
      requiresDeposit: z.coerce.boolean().default(false),
      depositAmount: z.coerce.number().min(0).optional(),
    })
    .optional(),

  /** `true` submits for review immediately; `false` keeps it as a draft. */
  publish: z.coerce.boolean().default(false),
  /** Client-generated id so a retried create does not duplicate the listing. */
  idempotencyKey: z.string().max(64).optional(),
});

export const updateListingSchema = createListingSchema
  .partial()
  .omit({ marketplaceId: true, marketplace: true, publish: true, idempotencyKey: true });

export const listingStatusSchema = z.object({
  status: z.enum(LISTING_STATUSES),
  reason: z.string().trim().max(500).optional(),
  buyerId: z.coerce.number().int().positive().optional(),
});

/** §9 + §10: the full query grammar for the feed and search. */
export const listingQuerySchema = paginationSchema.extend({
  marketplace: z.string().max(32).optional(),
  marketplaceId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  categorySlug: z.string().max(160).optional(),
  /** Include descendants of the chosen category. */
  includeSubcategories: z.coerce.boolean().default(true),
  operation: z.string().max(64).optional(),
  q: z.string().trim().max(191).optional(),

  countryId: z.coerce.number().int().positive().optional(),
  regionId: z.coerce.number().int().positive().optional(),
  cityId: z.string().max(191).optional(),
  areaId: z.string().max(191).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(0.1).max(500).optional(),

  priceMin: z.coerce.number().min(0).optional(),
  priceMax: z.coerce.number().min(0).optional(),
  priceBaseMin: z.coerce.number().min(0).optional(),
  priceBaseMax: z.coerce.number().min(0).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  priceType: z.string().max(64).optional(),
  pricePeriod: z.string().max(64).optional(),

  condition: z.string().max(191).optional(),
  brandId: z.string().max(191).optional(),
  sellerId: z.coerce.number().int().positive().optional(),
  businessId: z.coerce.number().int().positive().optional(),

  verifiedSeller: z.coerce.boolean().optional(),
  premiumSeller: z.coerce.boolean().optional(),
  verifiedListing: z.coerce.boolean().optional(),
  withPhotos: z.coerce.boolean().optional(),
  withVideo: z.coerce.boolean().optional(),
  negotiable: z.coerce.boolean().optional(),
  installments: z.coerce.boolean().optional(),
  featuredOnly: z.coerce.boolean().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  /** Hours since publication: 24, 72, 168, 720. */
  postedWithinHours: z.coerce.number().int().min(1).max(8760).optional(),

  status: z.string().max(64).optional(),
  lifecycleStatus: z.string().max(64).optional(),
  transactionStatus: z.string().max(64).optional(),
  /** Free-form module filters are read straight off the query by the module. */
}).passthrough();

export const mediaUploadSchema = z.object({
  url: z.string().url().max(512),
  thumbUrl: z.string().url().max(512).optional(),
  kind: z.enum(['image', 'video', 'tour_360', 'floor_plan', 'audio']).default('image'),
  caption: z.string().trim().max(191).optional(),
  isPrimary: z.coerce.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(100).optional(),
  width: z.coerce.number().int().positive().optional(),
  height: z.coerce.number().int().positive().optional(),
  sizeBytes: z.coerce.number().int().positive().optional(),
  mimeType: z.string().max(96).optional(),
});

export const promoteListingSchema = z.object({
  kind: z.enum(['feature', 'boost', 'urgent', 'bump', 'top_of_search', 'homepage', 'story']).optional(),
  packageCode: z.string().trim().min(2).max(48).optional(),
  days: z.coerce.number().int().min(1).max(90).default(7),
  /** Consume subscription quota instead of paying. Ignored when a paid package is used. */
  useQuota: z.coerce.boolean().default(true),
  gatewayCode: z.string().trim().min(1).max(32).optional(),
}).refine((value) => Boolean(value.packageCode || value.kind), {
  message: 'Provide a packageCode or kind',
});

export const rejectListingSchema = z.object({
  reasonCode: z.enum([
    'INVALID_DOCUMENT',
    'DUPLICATE_LISTING',
    'PROHIBITED_CONTENT',
    'INVALID_PRICE',
    'MISSING_INFORMATION',
    'FRAUD_SUSPECTED',
    'WRONG_CATEGORY',
    'MISLEADING_INFORMATION',
  ]),
  reason: z.string().trim().min(3).max(500),
  details: z.string().trim().max(4000).optional(),
});

export const appealListingSchema = z.object({
  note: z.string().trim().min(8).max(1000),
});

export const transactionStatusSchema = z.object({
  status: z.enum(['available', 'reserved', 'sold', 'rented']),
  buyerId: z.coerce.number().int().positive().optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
});

export const shareListingSchema = z.object({
  channel: z.enum(['link', 'whatsapp', 'sms', 'email', 'other']).default('link'),
});

export const availabilityQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export const availabilityBlockSchema = z.object({
  kind: z.enum(['booking', 'reserved', 'rented', 'blocked', 'maintenance']),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  note: z.string().trim().max(255).optional(),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
export type ListingQueryInput = z.infer<typeof listingQuerySchema>;
export type PromoteListingInput = z.infer<typeof promoteListingSchema>;
