/**
 * Independent listing status dimensions.
 *
 * Lifecycle is never mixed with sold/featured/boosted. Those live on
 * transaction_status, listing_promotions, and expiration_status.
 */

export const LIFECYCLE_STATUSES = [
  'draft',
  'pending_review',
  'published',
  'rejected',
  'expired',
  'archived',
] as const;

export const TRANSACTION_STATUSES = ['available', 'reserved', 'sold', 'rented'] as const;
export const MODERATION_STATUSES = ['not_reviewed', 'in_review', 'approved', 'rejected'] as const;
export const EXPIRATION_STATUSES = ['active', 'expiring', 'expired'] as const;

export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];
export type ExpirationStatus = (typeof EXPIRATION_STATUSES)[number];

/** Legacy mixed `listings.status` values still written for gold/property/vehicle modules. */
export type CompatListingStatus =
  | LifecycleStatus
  | 'validating'
  | 'sold'
  | 'rented'
  | 'reserved'
  | 'removed'
  | 'suspended'
  | 'cancelled'
  | 'completed';

export interface ListingDimensions {
  lifecycleStatus: LifecycleStatus;
  transactionStatus: TransactionStatus;
  moderationStatus: ModerationStatus;
  expirationStatus: ExpirationStatus;
}

export const LIFECYCLE_TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]> = {
  draft: ['pending_review', 'archived'],
  pending_review: ['published', 'rejected', 'draft', 'archived'],
  published: ['expired', 'archived', 'pending_review'],
  rejected: ['draft', 'pending_review', 'archived'],
  expired: ['published', 'archived', 'pending_review'],
  archived: ['draft', 'published'],
};

export const TRANSACTION_TRANSITIONS: Record<TransactionStatus, TransactionStatus[]> = {
  available: ['reserved', 'sold', 'rented'],
  reserved: ['available', 'sold', 'rented'],
  sold: ['available'],
  rented: ['available', 'reserved'],
};

export const REJECTION_REASON_CODES = [
  'INVALID_DOCUMENT',
  'DUPLICATE_LISTING',
  'PROHIBITED_CONTENT',
  'INVALID_PRICE',
  'MISSING_INFORMATION',
  'FRAUD_SUSPECTED',
  'WRONG_CATEGORY',
  'MISLEADING_INFORMATION',
] as const;

export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

export const LISTING_EVENT_TYPES = [
  'CREATED',
  'UPDATED',
  'SUBMITTED',
  'REVIEW_STARTED',
  'APPROVED',
  'REJECTED',
  'PUBLISHED',
  'FEATURED',
  'BOOSTED',
  'RESERVED',
  'SOLD',
  'RENTED',
  'EXPIRED',
  'RENEWED',
  'ARCHIVED',
  'RESTORED',
  'PRICE_CHANGED',
  'APPEALED',
  'PROMOTION_STARTED',
  'PROMOTION_ENDED',
] as const;

export type ListingEventType = (typeof LISTING_EVENT_TYPES)[number];

const LIFECYCLE_SET = new Set<string>(LIFECYCLE_STATUSES);

export function isLifecycleStatus(value: string): value is LifecycleStatus {
  return LIFECYCLE_SET.has(value);
}

export function canTransitionLifecycle(from: LifecycleStatus, to: LifecycleStatus): boolean {
  if (from === to) return true;
  return LIFECYCLE_TRANSITIONS[from].includes(to);
}

export function canTransitionTransaction(from: TransactionStatus, to: TransactionStatus): boolean {
  if (from === to) return true;
  return TRANSACTION_TRANSITIONS[from].includes(to);
}

/**
 * Maps independent dimensions onto the legacy `status` column so existing
 * feed queries and marketplace modules keep working.
 */
export function compatStatus(dimensions: ListingDimensions): CompatListingStatus {
  if (dimensions.lifecycleStatus === 'published') {
    if (dimensions.transactionStatus === 'sold') return 'sold';
    if (dimensions.transactionStatus === 'rented') return 'rented';
    if (dimensions.transactionStatus === 'reserved') return 'reserved';
    return 'published';
  }
  return dimensions.lifecycleStatus;
}

export function dimensionsFromLegacyStatus(status: string): ListingDimensions {
  switch (status) {
    case 'sold':
    case 'completed':
      return {
        lifecycleStatus: 'published',
        transactionStatus: 'sold',
        moderationStatus: 'approved',
        expirationStatus: 'active',
      };
    case 'rented':
      return {
        lifecycleStatus: 'published',
        transactionStatus: 'rented',
        moderationStatus: 'approved',
        expirationStatus: 'active',
      };
    case 'reserved':
      return {
        lifecycleStatus: 'published',
        transactionStatus: 'reserved',
        moderationStatus: 'approved',
        expirationStatus: 'active',
      };
    case 'validating':
      return {
        lifecycleStatus: 'pending_review',
        transactionStatus: 'available',
        moderationStatus: 'in_review',
        expirationStatus: 'active',
      };
    case 'removed':
    case 'suspended':
    case 'cancelled':
      return {
        lifecycleStatus: 'archived',
        transactionStatus: 'available',
        moderationStatus: 'not_reviewed',
        expirationStatus: 'active',
      };
    case 'expired':
      return {
        lifecycleStatus: 'expired',
        transactionStatus: 'available',
        moderationStatus: 'approved',
        expirationStatus: 'expired',
      };
    case 'rejected':
      return {
        lifecycleStatus: 'rejected',
        transactionStatus: 'available',
        moderationStatus: 'rejected',
        expirationStatus: 'active',
      };
    case 'pending_review':
      return {
        lifecycleStatus: 'pending_review',
        transactionStatus: 'available',
        moderationStatus: 'in_review',
        expirationStatus: 'active',
      };
    case 'published':
      return {
        lifecycleStatus: 'published',
        transactionStatus: 'available',
        moderationStatus: 'approved',
        expirationStatus: 'active',
      };
    case 'archived':
      return {
        lifecycleStatus: 'archived',
        transactionStatus: 'available',
        moderationStatus: 'not_reviewed',
        expirationStatus: 'active',
      };
    default:
      return {
        lifecycleStatus: 'draft',
        transactionStatus: 'available',
        moderationStatus: 'not_reviewed',
        expirationStatus: 'active',
      };
  }
}

export function readDimensions(row: object): ListingDimensions {
  const record = row as Record<string, unknown>;
  const lifecycle = String(record.lifecycle_status ?? '');
  if (isLifecycleStatus(lifecycle)) {
    return {
      lifecycleStatus: lifecycle,
      transactionStatus: (TRANSACTION_STATUSES as readonly string[]).includes(String(record.transaction_status))
        ? (record.transaction_status as TransactionStatus)
        : 'available',
      moderationStatus: (MODERATION_STATUSES as readonly string[]).includes(String(record.moderation_status))
        ? (record.moderation_status as ModerationStatus)
        : 'not_reviewed',
      expirationStatus: (EXPIRATION_STATUSES as readonly string[]).includes(String(record.expiration_status))
        ? (record.expiration_status as ExpirationStatus)
        : 'active',
    };
  }
  return dimensionsFromLegacyStatus(String(record.status ?? 'draft'));
}

export function expirationStatusFor(expiresAt: Date | null, now = new Date(), warningDays = 3): ExpirationStatus {
  if (!expiresAt) return 'active';
  if (expiresAt.getTime() <= now.getTime()) return 'expired';
  const warningMs = warningDays * 86_400_000;
  if (expiresAt.getTime() - now.getTime() <= warningMs) return 'expiring';
  return 'active';
}

export function isPubliclySearchable(dimensions: ListingDimensions): boolean {
  return (
    dimensions.lifecycleStatus === 'published' &&
    dimensions.expirationStatus !== 'expired' &&
    dimensions.transactionStatus !== 'sold'
  );
}

export function isPubliclyViewable(dimensions: ListingDimensions): boolean {
  return dimensions.lifecycleStatus === 'published';
}

/** Staff-only lifecycle targets. Owners submit/archive/renew through dedicated actions. */
export const STAFF_ONLY_LIFECYCLE: ReadonlySet<LifecycleStatus> = new Set(['published', 'rejected']);

export const PROMOTION_KIND_ALIASES: Record<string, string> = {
  feature: 'featured',
  featured: 'featured',
  boost: 'boosted',
  boosted: 'boosted',
  top_of_search: 'top_search',
  top_search: 'top_search',
  homepage: 'homepage',
  category_top: 'category_top',
  location_top: 'location_top',
  premium: 'premium',
  urgent: 'urgent',
  bump: 'bump',
  story: 'boosted',
};

export function canonicalPromotionType(kind: string): string {
  return PROMOTION_KIND_ALIASES[kind] ?? kind;
}
