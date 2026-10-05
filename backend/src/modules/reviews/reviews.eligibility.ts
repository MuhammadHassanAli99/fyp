import { queryOne, queryRows, type Row } from '../../db/query';
import { toBoolean } from '../../db/sql';
import {
  inferEntityType,
  inferReviewType,
  isVerifiedKind,
  windowExpired,
  type EligibilityState,
  type ReviewEntityType,
  type ReviewType,
  type VerificationKind,
} from './reviews.types';

export interface ReviewRelationship {
  listingId: number;
  marketplaceId: number;
  marketplaceCode: string;
  sellerId: number;
  businessId: number | null;
  businessKind: string | null;
  verificationKind: VerificationKind;
  transactionReference: string;
  orderId: number | null;
  listingEventId: number | null;
  completedAt: Date;
  listingOperation: string;
}

export interface EligibilityResult {
  state: EligibilityState;
  eligible: boolean;
  reason: string;
  reviewType: ReviewType;
  entityType: ReviewEntityType;
  verificationKind: VerificationKind;
  verified: boolean;
  verificationLabel: string | null;
  relationship: ReviewRelationship | null;
  existingReviewUuid: string | null;
  windowEndsAt: string | null;
  subject: {
    kind: 'user' | 'listing' | 'business';
    userId: number | null;
    listingId: number | null;
    businessId: number | null;
  };
}

export interface EligibilityQuery {
  reviewerId: number;
  listingId?: number | null;
  subjectKind?: 'user' | 'listing' | 'business';
  subjectUserId?: number | null;
  subjectListingId?: number | null;
  subjectBusinessId?: number | null;
  reviewType?: ReviewType;
}

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

async function loadListing(listingId: number) {
  return queryOne<Row>(
    `SELECT l.id, l.user_id, l.business_id, l.marketplace_id, l.operation, m.code AS marketplace_code,
            bp.kind AS business_kind
       FROM listings l
       JOIN marketplaces m ON m.id = l.marketplace_id
       LEFT JOIN business_profiles bp ON bp.id = l.business_id
      WHERE l.id = ? AND l.deleted_at IS NULL`,
    [listingId],
  );
}

function fromListingRow(
  listing: Row,
  extras: {
    verificationKind: VerificationKind;
    transactionReference: string;
    orderId: number | null;
    listingEventId: number | null;
    completedAt: Date;
  },
): ReviewRelationship {
  return {
    listingId: Number(listing.id),
    marketplaceId: Number(listing.marketplace_id),
    marketplaceCode: String(listing.marketplace_code),
    sellerId: Number(listing.user_id),
    businessId: listing.business_id === null ? null : Number(listing.business_id),
    businessKind: (listing.business_kind as string | null) ?? null,
    verificationKind: extras.verificationKind,
    transactionReference: extras.transactionReference,
    orderId: extras.orderId,
    listingEventId: extras.listingEventId,
    completedAt: extras.completedAt,
    listingOperation: String(listing.operation),
  };
}

function kindRank(kind: VerificationKind): number {
  switch (kind) {
    case 'purchase':
      return 4;
    case 'rental':
      return 3;
    case 'transaction':
      return 2;
    case 'interaction':
      return 1;
    default:
      return 0;
  }
}

function bestRelationship(rows: ReviewRelationship[]): ReviewRelationship | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const kind = kindRank(b.verificationKind) - kindRank(a.verificationKind);
    if (kind !== 0) return kind;
    return b.completedAt.getTime() - a.completedAt.getTime();
  })[0]!;
}

async function paidOrderRelationships(reviewerId: number, listingId: number | null): Promise<ReviewRelationship[]> {
  const rows = await queryRows<Row>(
    `SELECT o.id AS order_id, o.kind, o.paid_at, o.reference_id,
            l.id AS listing_id, l.user_id, l.business_id, l.marketplace_id, l.operation,
            m.code AS marketplace_code, bp.kind AS business_kind
       FROM orders o
       JOIN listings l ON l.id = o.reference_id AND o.reference_type = 'listing'
       JOIN marketplaces m ON m.id = l.marketplace_id
       LEFT JOIN business_profiles bp ON bp.id = l.business_id
      WHERE o.user_id = ? AND o.status = 'paid'
        AND o.kind IN ('listing_purchase','rental_payment','rental_deposit','booking_payment','parts_purchase')
        AND (? IS NULL OR l.id = ?)`,
    [reviewerId, listingId, listingId],
  );
  return rows
    .filter((row) => row.paid_at)
    .map((row) => {
      const kind: VerificationKind =
        String(row.kind) === 'listing_purchase'
          ? 'purchase'
          : String(row.kind).includes('rental') || String(row.kind) === 'booking_payment'
            ? 'rental'
            : 'transaction';
      return fromListingRow(row, {
        verificationKind: kind,
        transactionReference: `order:${row.order_id}`,
        orderId: Number(row.order_id),
        listingEventId: null,
        completedAt: asDate(row.paid_at),
      });
    });
}

async function soldEventRelationships(reviewerId: number, listingId: number | null): Promise<ReviewRelationship[]> {
  const rows = await queryRows<Row>(
    `SELECT e.id AS event_id, e.created_at, e.event_type, e.payload,
            l.id AS listing_id, l.user_id, l.business_id, l.marketplace_id, l.operation,
            m.code AS marketplace_code, bp.kind AS business_kind
       FROM listing_events e
       JOIN listings l ON l.id = e.listing_id
       JOIN marketplaces m ON m.id = l.marketplace_id
       LEFT JOIN business_profiles bp ON bp.id = l.business_id
      WHERE e.event_type IN ('SOLD','RENTED')
        AND (? IS NULL OR l.id = ?)
        AND JSON_UNQUOTE(JSON_EXTRACT(e.payload, '$.buyerId')) = ?`,
    [listingId, listingId, String(reviewerId)],
  );
  return rows.map((row) =>
    fromListingRow(row, {
      verificationKind: String(row.event_type) === 'RENTED' ? 'rental' : 'purchase',
      transactionReference: `event:${row.event_id}`,
      orderId: null,
      listingEventId: Number(row.event_id),
      completedAt: asDate(row.created_at),
    }),
  );
}

async function bookingRelationships(reviewerId: number, listingId: number | null): Promise<ReviewRelationship[]> {
  const property = await queryRows<Row>(
    `SELECT b.id, b.updated_at, b.check_out,
            l.id AS listing_id, l.user_id, l.business_id, l.marketplace_id, l.operation,
            m.code AS marketplace_code, bp.kind AS business_kind
       FROM property_bookings b
       JOIN listings l ON l.id = b.listing_id
       JOIN marketplaces m ON m.id = l.marketplace_id
       LEFT JOIN business_profiles bp ON bp.id = l.business_id
      WHERE b.guest_id = ? AND b.status IN ('confirmed','checked_in','checked_out')
        AND (? IS NULL OR l.id = ?)`,
    [reviewerId, listingId, listingId],
  );
  const vehicles = await queryRows<Row>(
    `SELECT b.id, b.updated_at, b.end_date,
            l.id AS listing_id, l.user_id, l.business_id, l.marketplace_id, l.operation,
            m.code AS marketplace_code, bp.kind AS business_kind
       FROM vehicle_rental_bookings b
       JOIN listings l ON l.id = b.listing_id
       JOIN marketplaces m ON m.id = l.marketplace_id
       LEFT JOIN business_profiles bp ON bp.id = l.business_id
      WHERE b.renter_id = ? AND b.status IN ('confirmed','active','completed')
        AND (? IS NULL OR l.id = ?)`,
    [reviewerId, listingId, listingId],
  );
  return [
    ...property.map((row) =>
      fromListingRow(row, {
        verificationKind: 'rental',
        transactionReference: `property_booking:${row.id}`,
        orderId: null,
        listingEventId: null,
        completedAt: asDate(row.check_out ?? row.updated_at),
      }),
    ),
    ...vehicles.map((row) =>
      fromListingRow(row, {
        verificationKind: 'rental',
        transactionReference: `vehicle_booking:${row.id}`,
        orderId: null,
        listingEventId: null,
        completedAt: asDate(row.end_date ?? row.updated_at),
      }),
    ),
  ];
}

async function interactionRelationships(reviewerId: number, listingId: number | null): Promise<ReviewRelationship[]> {
  const offers = await queryRows<Row>(
    `SELECT o.id, o.updated_at,
            l.id AS listing_id, l.user_id, l.business_id, l.marketplace_id, l.operation,
            m.code AS marketplace_code, bp.kind AS business_kind
       FROM listing_offers o
       JOIN listings l ON l.id = o.listing_id
       JOIN marketplaces m ON m.id = l.marketplace_id
       LEFT JOIN business_profiles bp ON bp.id = l.business_id
      WHERE o.status = 'accepted' AND (o.buyer_id = ? OR o.seller_id = ?)
        AND (? IS NULL OR l.id = ?)`,
    [reviewerId, reviewerId, listingId, listingId],
  );
  const chats = await queryRows<Row>(
    `SELECT c.id, c.last_message_at, c.created_at,
            l.id AS listing_id, l.user_id, l.business_id, l.marketplace_id, l.operation,
            m.code AS marketplace_code, bp.kind AS business_kind
       FROM conversations c
       JOIN conversation_participants p ON p.conversation_id = c.id
       JOIN listings l ON l.id = c.listing_id
       JOIN marketplaces m ON m.id = l.marketplace_id
       LEFT JOIN business_profiles bp ON bp.id = l.business_id
      WHERE p.user_id = ? AND c.listing_id IS NOT NULL AND c.message_count > 0
        AND (? IS NULL OR l.id = ?)`,
    [reviewerId, listingId, listingId],
  );
  return [
    ...offers.map((row) =>
      fromListingRow(row, {
        verificationKind: 'interaction',
        transactionReference: `offer:${row.id}`,
        orderId: null,
        listingEventId: null,
        completedAt: asDate(row.updated_at),
      }),
    ),
    ...chats.map((row) =>
      fromListingRow(row, {
        verificationKind: 'interaction',
        transactionReference: `conversation:${row.id}`,
        orderId: null,
        listingEventId: null,
        completedAt: asDate(row.last_message_at ?? row.created_at),
      }),
    ),
  ];
}

async function existingReview(
  reviewerId: number,
  subjectKind: 'user' | 'listing' | 'business',
  subjectUserId: number | null,
  subjectListingId: number | null,
  transactionReference: string | null,
) {
  return queryOne<Row>(
    `SELECT uuid, status, deleted_at FROM reviews
      WHERE reviewer_id = ? AND subject_kind = ?
        AND ((? IS NULL AND subject_user_id IS NULL) OR subject_user_id = ?)
        AND ((? IS NULL AND subject_listing_id IS NULL) OR subject_listing_id = ?)
        AND ((? IS NULL AND transaction_reference IS NULL) OR transaction_reference = ?)
        AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [
      reviewerId,
      subjectKind,
      subjectUserId,
      subjectUserId,
      subjectListingId,
      subjectListingId,
      transactionReference,
      transactionReference,
    ],
  );
}

export async function evaluateEligibility(input: EligibilityQuery): Promise<EligibilityResult> {
  const listingId = input.listingId ?? input.subjectListingId ?? null;
  const empty = (state: EligibilityState, reason: string, extras?: Partial<EligibilityResult>): EligibilityResult => ({
    state,
    eligible: false,
    reason,
    reviewType: input.reviewType ?? 'buyer_to_seller',
    entityType: 'user',
    verificationKind: 'none',
    verified: false,
    verificationLabel: null,
    relationship: null,
    existingReviewUuid: null,
    windowEndsAt: null,
    subject: {
      kind: input.subjectKind ?? (listingId ? 'listing' : 'user'),
      userId: input.subjectUserId ?? null,
      listingId,
      businessId: input.subjectBusinessId ?? null,
    },
    ...extras,
  });

  const [orders, events, bookings, interactions] = await Promise.all([
    paidOrderRelationships(input.reviewerId, listingId),
    soldEventRelationships(input.reviewerId, listingId),
    bookingRelationships(input.reviewerId, listingId),
    interactionRelationships(input.reviewerId, listingId),
  ]);

  let relationship = bestRelationship([...orders, ...events, ...bookings, ...interactions]);

  if (!relationship && listingId) {
    const listing = await loadListing(listingId);
    if (listing && Number(listing.user_id) === input.reviewerId && input.reviewType === 'seller_to_buyer') {
      const buyerOffer = await queryOne<Row>(
        `SELECT buyer_id, updated_at FROM listing_offers
          WHERE listing_id = ? AND seller_id = ? AND status = 'accepted'
          ORDER BY id DESC LIMIT 1`,
        [listingId, input.reviewerId],
      );
      if (buyerOffer) {
        relationship = fromListingRow(listing, {
          verificationKind: 'transaction',
          transactionReference: `seller_offer:${listingId}:${buyerOffer.buyer_id}`,
          orderId: null,
          listingEventId: null,
          completedAt: asDate(buyerOffer.updated_at),
        });
      }
    }
  }

  if (!relationship) {
    return empty('NOT_ELIGIBLE', 'No completed transaction or verified interaction was found for this review.');
  }

  if (relationship.sellerId === input.reviewerId && (input.reviewType ?? 'buyer_to_seller') !== 'seller_to_buyer') {
    return empty('NOT_ELIGIBLE', 'You cannot review your own listing or business.');
  }

  const reviewerIsBuyer = relationship.sellerId !== input.reviewerId;
  const reviewType = input.reviewType ?? inferReviewType({ reviewerIsBuyer, businessKind: relationship.businessKind });
  const subjectKind: 'user' | 'listing' | 'business' =
    input.subjectKind ?? (reviewType === 'seller_to_buyer' ? 'user' : relationship.businessId ? 'business' : 'user');
  const subjectUserId =
    subjectKind === 'user' ? (reviewerIsBuyer ? relationship.sellerId : input.subjectUserId ?? relationship.sellerId) : null;
  const subjectListingId = subjectKind === 'listing' ? relationship.listingId : listingId;
  const subjectBusinessId = subjectKind === 'business' ? relationship.businessId : null;

  if (subjectKind === 'user' && subjectUserId === input.reviewerId) {
    return empty('NOT_ELIGIBLE', 'You cannot review yourself.');
  }

  if (windowExpired(relationship.completedAt)) {
    return empty('EXPIRED', 'The review window for this transaction has ended.', {
      relationship,
      windowEndsAt: new Date(relationship.completedAt.getTime() + 90 * 86_400_000).toISOString(),
    });
  }

  const existing = await existingReview(
    input.reviewerId,
    subjectKind,
    subjectUserId,
    subjectListingId,
    relationship.transactionReference,
  );
  if (existing) {
    const state: EligibilityState =
      existing.status === 'pending' || existing.status === 'flagged' || existing.status === 'under_review'
        ? 'UNDER_REVIEW'
        : 'ALREADY_REVIEWED';
    return empty(state, state === 'UNDER_REVIEW' ? 'A review for this transaction is already under review.' : 'You already reviewed this transaction.', {
      relationship,
      existingReviewUuid: String(existing.uuid),
    });
  }

  const entityType = inferEntityType({
    subjectKind,
    businessKind: relationship.businessKind,
    marketplaceCode: relationship.marketplaceCode,
  });
  const verified = isVerifiedKind(relationship.verificationKind);

  return {
    state: 'ELIGIBLE',
    eligible: true,
    reason: verified ? 'Verified relationship found.' : 'Interaction found. This review will not show a purchase badge.',
    reviewType,
    entityType,
    verificationKind: relationship.verificationKind,
    verified,
    verificationLabel:
      relationship.verificationKind === 'purchase'
        ? 'Verified Purchase'
        : relationship.verificationKind === 'rental'
          ? 'Verified Rental'
          : relationship.verificationKind === 'transaction'
            ? 'Verified Transaction'
            : relationship.verificationKind === 'interaction'
              ? 'Verified Interaction'
              : null,
    relationship,
    existingReviewUuid: null,
    windowEndsAt: new Date(relationship.completedAt.getTime() + 90 * 86_400_000).toISOString(),
    subject: {
      kind: subjectKind,
      userId: subjectUserId,
      listingId: subjectListingId,
      businessId: subjectBusinessId,
    },
  };
}

export { toBoolean };
