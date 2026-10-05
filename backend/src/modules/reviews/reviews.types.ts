/**
 * Review Platform domain. One engine for Gold, Property and Vehicle.
 * Marketplace-specific rating labels live in review_criteria, not here.
 */

export const REVIEW_WINDOW_DAYS = 90;

export const REVIEW_TYPES = [
  'buyer_to_seller',
  'seller_to_buyer',
  'buyer_to_dealer',
  'customer_to_agency',
  'customer_to_gold_shop',
] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];

export const ENTITY_TYPES = [
  'user',
  'seller',
  'dealer',
  'agency',
  'gold_shop',
  'listing',
  'property',
  'vehicle',
] as const;
export type ReviewEntityType = (typeof ENTITY_TYPES)[number];

export const VERIFICATION_KINDS = ['none', 'purchase', 'rental', 'transaction', 'interaction'] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

export const ELIGIBILITY_STATES = [
  'ELIGIBLE',
  'NOT_ELIGIBLE',
  'ALREADY_REVIEWED',
  'EXPIRED',
  'UNDER_REVIEW',
] as const;
export type EligibilityState = (typeof ELIGIBILITY_STATES)[number];

export const PUBLIC_REVIEW_STATUSES = [
  'ACTIVE',
  'PENDING',
  'UNDER_REVIEW',
  'HIDDEN',
  'REMOVED',
  'RESTORED',
] as const;
export type PublicReviewStatus = (typeof PUBLIC_REVIEW_STATUSES)[number];

export function publicStatusFromRow(status: string, deletedAt: Date | string | null): PublicReviewStatus {
  if (deletedAt) return 'HIDDEN';
  switch (status) {
    case 'published':
      return 'ACTIVE';
    case 'pending':
      return 'PENDING';
    case 'flagged':
    case 'under_review':
      return 'UNDER_REVIEW';
    case 'hidden':
      return 'HIDDEN';
    case 'rejected':
    case 'removed':
      return 'REMOVED';
    case 'restored':
      return 'RESTORED';
    default:
      return 'PENDING';
  }
}

export function dbStatusFromPublic(status: PublicReviewStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'published';
    case 'PENDING':
      return 'pending';
    case 'UNDER_REVIEW':
      return 'under_review';
    case 'HIDDEN':
      return 'hidden';
    case 'REMOVED':
      return 'removed';
    case 'RESTORED':
      return 'restored';
  }
}

export function inferReviewType(params: {
  reviewerIsBuyer: boolean;
  businessKind: string | null;
}): ReviewType {
  if (!params.reviewerIsBuyer) return 'seller_to_buyer';
  if (params.businessKind === 'dealer' || params.businessKind === 'showroom') return 'buyer_to_dealer';
  if (params.businessKind === 'agency' || params.businessKind === 'broker' || params.businessKind === 'builder') {
    return 'customer_to_agency';
  }
  if (params.businessKind === 'gold_shop') return 'customer_to_gold_shop';
  return 'buyer_to_seller';
}

export function inferEntityType(params: {
  subjectKind: 'user' | 'listing' | 'business';
  businessKind: string | null;
  marketplaceCode: string | null;
}): ReviewEntityType {
  if (params.subjectKind === 'listing') {
    if (params.marketplaceCode === 'property') return 'property';
    if (params.marketplaceCode === 'vehicles') return 'vehicle';
    return 'listing';
  }
  if (params.subjectKind === 'business') {
    if (params.businessKind === 'dealer' || params.businessKind === 'showroom') return 'dealer';
    if (params.businessKind === 'agency' || params.businessKind === 'broker' || params.businessKind === 'builder') {
      return 'agency';
    }
    if (params.businessKind === 'gold_shop') return 'gold_shop';
    return 'seller';
  }
  return 'seller';
}

export function verificationLabel(kind: VerificationKind): string | null {
  switch (kind) {
    case 'purchase':
      return 'Verified Purchase';
    case 'rental':
      return 'Verified Rental';
    case 'transaction':
      return 'Verified Transaction';
    case 'interaction':
      return 'Verified Interaction';
    default:
      return null;
  }
}

export function isVerifiedKind(kind: VerificationKind): boolean {
  return kind !== 'none';
}

export function windowExpired(completedAt: Date, now = new Date(), days = REVIEW_WINDOW_DAYS): boolean {
  return now.getTime() - completedAt.getTime() > days * 86_400_000;
}
