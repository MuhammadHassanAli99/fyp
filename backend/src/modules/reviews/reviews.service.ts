import { execute, insertAndGetId, queryOne, queryRows, queryCount, transaction, type Row } from '../../db/query';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { uuid } from '../../core/security/crypto';
import { eventBus } from '../../core/events/event-bus';
import { toBoolean } from '../../db/sql';
import { screenReview } from '../moderation/screening.service';
import { assessReviewRisk } from '../risk/risk.review';
import { evaluateEligibility, type EligibilityQuery } from './reviews.eligibility';
import { recomputeRatingSummary } from './reviews.aggregate';
import { attachReviewMedia, listReviewMedia } from './reviews.media';
import { publicStatusFromRow, type ReviewType, type VerificationKind } from './reviews.types';

async function writeAudit(reviewId: number, actorId: number | null, action: string, fromStatus?: string | null, toStatus?: string | null, note?: string) {
  await execute(
    `INSERT INTO review_audit (review_id, actor_id, action, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?)`,
    [reviewId, actorId, action, fromStatus ?? null, toStatus ?? null, note ?? null],
  ).catch(() => undefined);
}

function subjectIdOf(kind: string, userId?: number | null, listingId?: number | null, businessId?: number | null): number {
  if (kind === 'user') return userId ?? 0;
  if (kind === 'listing') return listingId ?? 0;
  return businessId ?? 0;
}

const mapReview = async (row: Row) => {
  const media = await listReviewMedia(Number(row.id)).catch(() => []);
  const ratings = await queryRows<Row>(
    `SELECT c.code, c.label, cr.rating
       FROM review_criteria_ratings cr
       JOIN review_criteria c ON c.id = cr.criteria_id
      WHERE cr.review_id = ?`,
    [row.id],
  ).catch(() => []);
  const verificationKind = String(row.verification_kind ?? 'none') as VerificationKind;
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    reviewerId: Number(row.reviewer_id),
    reviewerName: (row.reviewer_name as string | null) ?? null,
    reviewerAvatar: (row.reviewer_avatar as string | null) ?? null,
    subjectKind: String(row.subject_kind),
    subjectUserId: row.subject_user_id === null ? null : Number(row.subject_user_id),
    subjectListingId: row.subject_listing_id === null ? null : Number(row.subject_listing_id),
    subjectBusinessId: row.subject_business_id === null ? null : Number(row.subject_business_id),
    marketplaceId: row.marketplace_id === null ? null : Number(row.marketplace_id),
    reviewType: String(row.review_type ?? 'buyer_to_seller'),
    entityType: String(row.entity_type ?? 'user'),
    rating: Number(row.rating),
    title: (row.title as string | null) ?? null,
    body: (row.body as string | null) ?? null,
    criteria: ratings.map((item) => ({ code: String(item.code), label: String(item.label), rating: Number(item.rating) })),
    media,
    isTransactionVerified: toBoolean(row.is_transaction_verified),
    verificationKind,
    verificationLabel:
      verificationKind === 'purchase'
        ? 'Verified Purchase'
        : verificationKind === 'rental'
          ? 'Verified Rental'
          : verificationKind === 'transaction'
            ? 'Verified Transaction'
            : verificationKind === 'interaction'
              ? 'Verified Interaction'
              : null,
    status: publicStatusFromRow(String(row.status), (row.deleted_at as Date | null) ?? null),
    helpfulCount: Number(row.helpful_count ?? 0),
    replyCount: Number(row.reply_count ?? 0),
    publishedAt: row.published_at ? (row.published_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
  };
};

export async function listReviewCriteria(marketplaceId: number | null, appliesTo?: string | null) {
  const rows = await queryRows<Row>(
    `SELECT id, marketplace_id, code, label, applies_to, sort_order
       FROM review_criteria
      WHERE is_active = 1
        AND (marketplace_id IS NULL OR marketplace_id = ?)
        AND (? IS NULL OR applies_to IN ('all', ?))
      ORDER BY marketplace_id IS NULL DESC, sort_order, id`,
    [marketplaceId, appliesTo ?? null, appliesTo ?? null],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    marketplaceId: row.marketplace_id === null ? null : Number(row.marketplace_id),
    code: String(row.code),
    label: String(row.label),
    appliesTo: String(row.applies_to),
  }));
}

export async function getEligibility(query: EligibilityQuery) {
  return evaluateEligibility(query);
}

export async function listReviews(params: {
  subjectKind: 'user' | 'listing' | 'business';
  subjectId: number;
  limit?: number;
  viewerId?: number | null;
}) {
  const limit = params.limit ?? 20;
  const condition =
    params.subjectKind === 'user'
      ? 'subject_user_id = ?'
      : params.subjectKind === 'listing'
        ? 'subject_listing_id = ?'
        : 'subject_business_id = ?';

  const rows = await queryRows<Row>(
    `SELECT r.*, up.display_name AS reviewer_name, up.avatar_url AS reviewer_avatar
       FROM reviews r
       LEFT JOIN user_profiles up ON up.user_id = r.reviewer_id
      WHERE r.subject_kind = ? AND ${condition} AND r.status = 'published' AND r.deleted_at IS NULL
      ORDER BY r.is_transaction_verified DESC, r.published_at DESC
      LIMIT ?`,
    [params.subjectKind, params.subjectId, limit],
  );

  return Promise.all(rows.map(mapReview));
}

export async function getReview(reviewUuid: string, viewerId?: number | null) {
  const row = await queryOne<Row>(
    `SELECT r.*, up.display_name AS reviewer_name, up.avatar_url AS reviewer_avatar
       FROM reviews r
       LEFT JOIN user_profiles up ON up.user_id = r.reviewer_id
      WHERE r.uuid = ? AND r.deleted_at IS NULL`,
    [reviewUuid],
  );
  if (!row) throw notFound('Review');
  const isOwner = viewerId !== null && viewerId !== undefined && Number(row.reviewer_id) === viewerId;
  if (String(row.status) !== 'published' && !isOwner) throw notFound('Review');
  return mapReview(row);
}

export async function getSummary(subjectKind: 'user' | 'listing' | 'business', subjectId: number, marketplaceId = 0) {
  const row = await queryOne<Row>(
    `SELECT review_count, verified_review_count, average_rating,
            rating_1_count, rating_2_count, rating_3_count, rating_4_count, rating_5_count, criteria_averages
       FROM rating_summaries
      WHERE subject_kind = ? AND subject_id = ? AND marketplace_id = ?`,
    [subjectKind, subjectId, marketplaceId],
  );
  return {
    subjectKind,
    subjectId,
    marketplaceId,
    reviewCount: Number(row?.review_count ?? 0),
    verifiedReviewCount: Number(row?.verified_review_count ?? 0),
    averageRating: Number(row?.average_rating ?? 0),
    distribution: {
      1: Number(row?.rating_1_count ?? 0),
      2: Number(row?.rating_2_count ?? 0),
      3: Number(row?.rating_3_count ?? 0),
      4: Number(row?.rating_4_count ?? 0),
      5: Number(row?.rating_5_count ?? 0),
    },
    criteriaAverages: row?.criteria_averages ?? null,
  };
}

async function saveCriteriaRatings(
  reviewId: number,
  marketplaceId: number | null,
  ratings: Array<{ code: string; rating: number }> | undefined,
) {
  if (!ratings || ratings.length === 0) return;
  const catalogue = await listReviewCriteria(marketplaceId);
  const byCode = new Map(catalogue.map((item) => [item.code, item.id]));
  for (const item of ratings) {
    const criteriaId = byCode.get(item.code);
    if (!criteriaId) continue;
    if (item.rating < 1 || item.rating > 5) throw badRequest('Category ratings must be between 1 and 5');
    await execute(
      `INSERT INTO review_criteria_ratings (review_id, criteria_id, rating) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating)`,
      [reviewId, criteriaId, item.rating],
    );
  }
}

export async function createReview(
  reviewerId: number,
  input: {
    listingId?: number | null;
    subjectKind?: 'user' | 'listing' | 'business';
    subjectUserId?: number | null;
    subjectListingId?: number | null;
    subjectBusinessId?: number | null;
    marketplaceId?: number | null;
    rating: number;
    title?: string | null;
    body?: string | null;
    reviewerRole?: 'buyer' | 'seller' | 'renter' | 'landlord' | 'visitor';
    reviewType?: ReviewType;
    criteria?: Array<{ code: string; rating: number }>;
    media?: Array<{ url: string; objectKey?: string | null; kind?: 'image' | 'video'; mimeType?: string | null }>;
  },
) {
  const eligibility = await evaluateEligibility({
    reviewerId,
    listingId: input.listingId ?? input.subjectListingId,
    subjectKind: input.subjectKind,
    subjectUserId: input.subjectUserId,
    subjectListingId: input.subjectListingId,
    subjectBusinessId: input.subjectBusinessId,
    reviewType: input.reviewType,
  });
  if (!eligibility.eligible) {
    throw conflict(eligibility.reason, { details: { state: eligibility.state } });
  }

  const rel = eligibility.relationship!;
  const subjectKind = eligibility.subject.kind;
  const reviewUuid = uuid();
  const windowEnd = eligibility.windowEndsAt ? new Date(eligibility.windowEndsAt) : null;
  const id = await insertAndGetId(
    `INSERT INTO reviews
       (uuid, reviewer_id, subject_kind, subject_user_id, subject_listing_id, subject_business_id,
        marketplace_id, reviewer_role, review_type, entity_type, entity_id, rating, title, body,
        is_transaction_verified, verification_kind, transaction_reference, order_id, listing_event_id,
        window_starts_at, window_ends_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      reviewUuid,
      reviewerId,
      subjectKind,
      eligibility.subject.userId,
      eligibility.subject.listingId,
      eligibility.subject.businessId,
      rel.marketplaceId,
      input.reviewerRole ?? (eligibility.reviewType.startsWith('seller') ? 'seller' : 'buyer'),
      eligibility.reviewType,
      eligibility.entityType,
      subjectIdOf(subjectKind, eligibility.subject.userId, eligibility.subject.listingId, eligibility.subject.businessId),
      input.rating,
      input.title ?? null,
      input.body ?? null,
      eligibility.verified ? 1 : 0,
      eligibility.verificationKind,
      rel.transactionReference,
      rel.orderId,
      rel.listingEventId,
      rel.completedAt,
      windowEnd,
    ],
  );

  await saveCriteriaRatings(id, rel.marketplaceId, input.criteria);
  if (input.media?.length) await attachReviewMedia(id, input.media);
  await writeAudit(id, reviewerId, 'created', null, 'pending');

  const screening = await screenReview(id);
  const risk = await assessReviewRisk(id).catch(() => null);
  const hold =
    screening.decision === 'review' ||
    risk?.state === 'REVIEW' ||
    risk?.state === 'REJECTED';

  if (hold) {
    await execute(`UPDATE reviews SET status = 'under_review' WHERE id = ?`, [id]);
    await writeAudit(id, null, 'held_for_review', 'pending', 'under_review', risk?.state ?? screening.decision);
  } else {
    await execute(`UPDATE reviews SET status = 'published', published_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
    await writeAudit(id, null, 'published', 'pending', 'published');
    await recomputeRatingSummary(subjectKind, subjectIdOf(subjectKind, eligibility.subject.userId, eligibility.subject.listingId, eligibility.subject.businessId), rel.marketplaceId);
    const { recordTrustEvent } = await import('../trust/trust.service');
    if (eligibility.subject.userId) {
      await recordTrustEvent({
        userId: eligibility.subject.userId,
        type: 'review_received',
        source: 'reviews',
        delta: input.rating >= 4 ? 2 : input.rating <= 2 ? -2 : 0.5,
        marketplaceId: rel.marketplaceId,
        referenceType: 'review',
        referenceId: id,
        explanation: 'Review published',
      }).catch(() => undefined);
    }
    await transaction(async (connection) => {
      const event = await eventBus.enqueue(connection, 'review.published', 'review', id, {
        reviewId: id,
        subjectKind,
        subjectId: subjectIdOf(subjectKind, eligibility.subject.userId, eligibility.subject.listingId, eligibility.subject.businessId),
        rating: input.rating,
      });
      void eventBus.publishAfterCommit(event);
    });
  }

  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'review.created', 'review', id, {
      reviewId: id,
      reviewerId,
      subjectKind,
      subjectId: subjectIdOf(subjectKind, eligibility.subject.userId, eligibility.subject.listingId, eligibility.subject.businessId),
      rating: input.rating,
    });
    void eventBus.publishAfterCommit(event);
  });

  const row = await queryOne<Row>(
    `SELECT r.*, up.display_name AS reviewer_name, up.avatar_url AS reviewer_avatar
       FROM reviews r LEFT JOIN user_profiles up ON up.user_id = r.reviewer_id WHERE r.id = ?`,
    [id],
  );
  return { ...(await mapReview(row!)), screening, reviewState: risk?.state ?? 'NORMAL', eligibility: eligibility.state };
}

export async function updateReview(
  userId: number,
  reviewUuid: string,
  input: { rating?: number; title?: string | null; body?: string | null; criteria?: Array<{ code: string; rating: number }> },
) {
  const review = await queryOne<Row>(`SELECT * FROM reviews WHERE uuid = ? AND deleted_at IS NULL`, [reviewUuid]);
  if (!review) throw notFound('Review');
  if (Number(review.reviewer_id) !== userId) throw forbidden('You can only edit your own review');
  if (['removed', 'rejected'].includes(String(review.status))) throw conflict('This review can no longer be edited');

  const rating = input.rating ?? Number(review.rating);
  await execute(`UPDATE reviews SET rating = ?, title = ?, body = ?, status = 'pending', published_at = NULL WHERE id = ?`, [
    rating,
    input.title === undefined ? review.title : input.title,
    input.body === undefined ? review.body : input.body,
    review.id,
  ]);
  if (input.criteria) await saveCriteriaRatings(Number(review.id), review.marketplace_id === null ? null : Number(review.marketplace_id), input.criteria);
  await writeAudit(Number(review.id), userId, 'updated', String(review.status), 'pending');

  const screening = await screenReview(Number(review.id));
  const risk = await assessReviewRisk(Number(review.id)).catch(() => null);
  const hold = screening.decision === 'review' || risk?.state === 'REVIEW' || risk?.state === 'REJECTED';
  if (hold) {
    await execute(`UPDATE reviews SET status = 'under_review' WHERE id = ?`, [review.id]);
  } else {
    await execute(`UPDATE reviews SET status = 'published', published_at = CURRENT_TIMESTAMP WHERE id = ?`, [review.id]);
    await recomputeRatingSummary(
      String(review.subject_kind) as 'user' | 'listing' | 'business',
      subjectIdOf(String(review.subject_kind), Number(review.subject_user_id), Number(review.subject_listing_id), Number(review.subject_business_id)),
      Number(review.marketplace_id ?? 0),
    );
  }
  return getReview(reviewUuid, userId);
}

export async function replyToReview(userId: number, reviewUuid: string, bodyText: string) {
  const review = await queryOne<Row>(`SELECT * FROM reviews WHERE uuid = ? AND deleted_at IS NULL`, [reviewUuid]);
  if (!review) throw notFound('Review');
  const isOfficial =
    (review.subject_kind === 'user' && Number(review.subject_user_id) === userId) ||
    (review.subject_kind === 'business' &&
      Boolean(
        await queryOne<Row>(
          `SELECT id FROM business_members WHERE business_id = ? AND user_id = ? AND removed_at IS NULL AND accepted_at IS NOT NULL`,
          [review.subject_business_id, userId],
        ),
      ));
  if (!isOfficial && Number(review.reviewer_id) !== userId) {
    throw forbidden('Only the reviewed party may post an official response');
  }
  const id = await insertAndGetId(
    `INSERT INTO review_replies (review_id, user_id, body, is_official, status) VALUES (?, ?, ?, ?, 'pending')`,
    [review.id, userId, bodyText, isOfficial ? 1 : 0],
  );
  const screening = await screenReview(Number(review.id));
  const status = screening.decision === 'review' ? 'pending' : 'published';
  await execute(`UPDATE review_replies SET status = ? WHERE id = ?`, [status, id]);
  if (status === 'published') {
    await execute(`UPDATE reviews SET reply_count = reply_count + 1 WHERE id = ?`, [review.id]);
  }
  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'review.replied', 'review', Number(review.id), {
      reviewId: Number(review.id),
      replyId: id,
      userId,
    });
    void eventBus.publishAfterCommit(event);
  });
  await writeAudit(Number(review.id), userId, 'replied', null, status);
  return { id, official: isOfficial, status };
}

export async function reportReview(userId: number, reviewUuid: string, reason: string, description?: string) {
  const review = await queryOne<Row>(`SELECT id, reviewer_id, status FROM reviews WHERE uuid = ? AND deleted_at IS NULL`, [reviewUuid]);
  if (!review) throw notFound('Review');
  if (Number(review.reviewer_id) === userId) throw badRequest('You cannot report your own review');
  await execute(
    `INSERT INTO review_reports (review_id, reporter_id, reason_code, description)
     VALUES (?, ?, ?, ?)`,
    [review.id, userId, reason, description ?? null],
  );
  await execute(`UPDATE reviews SET report_count = report_count + 1, status = IF(status = 'published', 'flagged', status) WHERE id = ?`, [
    review.id,
  ]);
  await writeAudit(Number(review.id), userId, 'reported', String(review.status), 'flagged', reason);
  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'review.reported', 'review', Number(review.id), {
      reviewId: Number(review.id),
      reporterId: userId,
      reason,
    });
    void eventBus.publishAfterCommit(event);
  });
  return { reported: true };
}

export async function voteHelpful(userId: number, reviewUuid: string, helpful: boolean) {
  const review = await queryOne<Row>(`SELECT id FROM reviews WHERE uuid = ? AND deleted_at IS NULL AND status = 'published'`, [reviewUuid]);
  if (!review) throw notFound('Review');
  await execute(
    `INSERT INTO review_votes (review_id, user_id, is_helpful) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE is_helpful = VALUES(is_helpful)`,
    [review.id, userId, helpful ? 1 : 0],
  );
  const helpfulCount = await queryCount(`SELECT COUNT(*) FROM review_votes WHERE review_id = ? AND is_helpful = 1`, [review.id]);
  const notHelpful = await queryCount(`SELECT COUNT(*) FROM review_votes WHERE review_id = ? AND is_helpful = 0`, [review.id]);
  await execute(`UPDATE reviews SET helpful_count = ?, not_helpful_count = ? WHERE id = ?`, [helpfulCount, notHelpful, review.id]);
  return { helpful: helpfulCount, notHelpful };
}

export async function deleteOwnReview(userId: number, reviewUuid: string) {
  const review = await queryOne<Row>(`SELECT id, reviewer_id, status FROM reviews WHERE uuid = ? AND deleted_at IS NULL`, [reviewUuid]);
  if (!review) throw notFound('Review');
  if (Number(review.reviewer_id) !== userId) throw notFound('Review');
  await execute(`UPDATE reviews SET deleted_at = CURRENT_TIMESTAMP, status = 'hidden' WHERE id = ?`, [review.id]);
  await writeAudit(Number(review.id), userId, 'hidden', String(review.status), 'hidden');
  return { deleted: true };
}

export async function staffDecideReview(staffId: number, reviewUuid: string, decision: 'approve' | 'reject' | 'restore' | 'hide', note?: string) {
  const review = await queryOne<Row>(`SELECT * FROM reviews WHERE uuid = ?`, [reviewUuid]);
  if (!review) throw notFound('Review');
  const from = String(review.status);
  let to = from;
  if (decision === 'approve') {
    to = 'published';
    await execute(`UPDATE reviews SET status = 'published', published_at = COALESCE(published_at, CURRENT_TIMESTAMP), deleted_at = NULL WHERE id = ?`, [
      review.id,
    ]);
  } else if (decision === 'reject') {
    to = 'removed';
    await execute(`UPDATE reviews SET status = 'removed' WHERE id = ?`, [review.id]);
  } else if (decision === 'hide') {
    to = 'hidden';
    await execute(`UPDATE reviews SET status = 'hidden', deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [review.id]);
  } else {
    to = 'restored';
    await execute(
      `UPDATE reviews SET status = 'restored', deleted_at = NULL, restored_at = CURRENT_TIMESTAMP, restored_by = ? WHERE id = ?`,
      [staffId, review.id],
    );
  }
  await writeAudit(Number(review.id), staffId, `staff_${decision}`, from, to, note);
  if (to === 'published' || to === 'restored' || to === 'removed' || to === 'hidden') {
    await recomputeRatingSummary(
      String(review.subject_kind) as 'user' | 'listing' | 'business',
      subjectIdOf(String(review.subject_kind), Number(review.subject_user_id), Number(review.subject_listing_id), Number(review.subject_business_id)),
      Number(review.marketplace_id ?? 0),
    );
  }
  return { status: publicStatusFromRow(to, to === 'hidden' ? new Date() : null) };
}

export async function listModerationReviews(limit = 50) {
  const rows = await queryRows<Row>(
    `SELECT r.uuid, r.rating, r.body, r.status, r.created_at, r.report_count, r.ai_authenticity_score
       FROM reviews r
      WHERE r.status IN ('pending','under_review','flagged') AND r.deleted_at IS NULL
      ORDER BY r.created_at ASC
      LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({
    uuid: String(row.uuid),
    rating: Number(row.rating),
    body: (row.body as string | null) ?? null,
    status: publicStatusFromRow(String(row.status), null),
    reportCount: Number(row.report_count),
    authenticityScore: row.ai_authenticity_score === null ? null : Number(row.ai_authenticity_score),
    createdAt: (row.created_at as Date).toISOString(),
  }));
}

export { recomputeRatingSummary };
