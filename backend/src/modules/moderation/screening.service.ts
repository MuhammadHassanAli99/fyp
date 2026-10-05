import { execute, queryOne, queryRows, queryCount, type Row } from '../../db/query';
import { toNumber, toBoolean } from '../../db/sql';
import { remember } from '../../config/cache';
import { uuid } from '../../core/security/crypto';
import { loggerFor } from '../../config/logger';
import { eventBus } from '../../core/events/event-bus';
import { transaction } from '../../db/query';
import { detectDuplicates, scoreSpamSignals } from '../ai/ai.capabilities';

const log = loggerFor('screening');

/**
 * The automated gate every listing passes before publication
 * (§18 Duplicate/Spam/Fraud Detection, §19, §22 Moderation).
 *
 * Each detector returns a 0..1 score. The decision is deliberately three-way:
 * publish, hold for a human, or reject outright. Auto-rejecting on a single
 * signal would punish legitimate sellers, so only an overwhelming combination
 * (or an exact duplicate) rejects without review.
 */
export interface ScreeningResult {
  decision: 'approve' | 'review' | 'reject';
  flags: Record<string, number>;
  reasons: string[];
  queueId: number | null;
}

const loadBannedTerms = (marketplaceId: number, language: string | null) =>
  remember(`banned:${marketplaceId}:${language ?? 'any'}`, 600, () =>
    queryRows<Row>(
      `SELECT term, severity, match_kind, applies_to FROM banned_terms
        WHERE is_active = 1
          AND (marketplace_id = ? OR marketplace_id IS NULL)
          AND (language = ? OR language IS NULL)`,
      [marketplaceId, language],
    ),
  );

async function loadPolicyCuts(code: string, fallback: { review: number; reject: number }) {
  const row = await queryOne<Row>(
    `SELECT rules FROM moderation_policies WHERE code = ? AND is_active = 1 ORDER BY version DESC LIMIT 1`,
    [code],
  ).catch(() => null);
  const rules =
    row?.rules && typeof row.rules === 'object' ? (row.rules as { review?: number; reject?: number }) : {};
  return {
    review: Number(rules.review ?? fallback.review),
    reject: Number(rules.reject ?? fallback.reject),
  };
}

export async function screenListing(listingId: number): Promise<ScreeningResult> {
  const listing = await queryOne<Row>(
    `SELECT l.id, l.user_id, l.marketplace_id, l.category_id, l.title, l.description, l.price,
            l.currency, l.language, l.media_count, l.city_id, l.country_id, l.completeness_score,
            u.created_at AS user_created_at, u.status AS user_status,
            ts.score AS trust_score, ts.band AS trust_band
       FROM listings l
       JOIN users u ON u.id = l.user_id
       LEFT JOIN trust_scores ts ON ts.user_id = l.user_id
      WHERE l.id = ?`,
    [listingId],
  );

  if (!listing) {
    return { decision: 'review', flags: {}, reasons: ['listing_not_found'], queueId: null };
  }

  const flags: Record<string, number> = {};
  const reasons: string[] = [];
  const text = `${listing.title ?? ''} ${listing.description ?? ''}`;
  const [spamPolicy, duplicatePolicy] = await Promise.all([
    loadPolicyCuts('ai.spam.listing', { review: 0.35, reject: 0.85 }),
    loadPolicyCuts('ai.duplicate.listing', { review: 0.82, reject: 0.98 }),
  ]);

  /* 1. Duplicate detection (§19 Duplicate Listing Detection) --------------- */
  const duplicate = await detectDuplicates(listingId);
  if (duplicate.score >= duplicatePolicy.review && duplicate.matches[0]) {
    flags.duplicate = duplicate.score;
    reasons.push(
      duplicate.score >= duplicatePolicy.reject
        ? `Identical to listing #${duplicate.matches[0].listingId}`
        : `Very similar to listing #${duplicate.matches[0].listingId}`,
    );
  }

  /* 2. Banned terms + spam heuristics -------------------------------------- */
  const bannedTerms = await loadBannedTerms(Number(listing.marketplace_id), (listing.language as string | null) ?? null);
  const matchedTerms: string[] = [];
  let bannedSeverity = 0;
  const lowerText = text.toLowerCase();

  for (const rule of bannedTerms) {
    const term = String(rule.term).toLowerCase();
    const matched =
      rule.match_kind === 'exact'
        ? lowerText.split(/\s+/).includes(term)
        : rule.match_kind === 'regex'
          ? safeRegexTest(String(rule.term), text)
          : lowerText.includes(term);
    if (!matched) continue;
    matchedTerms.push(String(rule.term));
    bannedSeverity = Math.max(bannedSeverity, rule.severity === 'block' ? 1 : rule.severity === 'flag' ? 0.6 : 0.25);
  }
  if (matchedTerms.length > 0) {
    flags.banned_terms = bannedSeverity;
    reasons.push(`Contains restricted wording: ${matchedTerms.slice(0, 3).join(', ')}`);
  }

  const spam = await scoreSpamSignals(text, {
    price: toNumber(listing.price),
    mediaCount: Number(listing.media_count ?? 0),
  });
  if (spam.score > 0.2) {
    flags.spam = spam.score;
    reasons.push('Looks like spam or low-quality content');
  }

  /* 3. Contact details in the body ---------------------------------------- */
  // Phone numbers and emails in the description route buyers off-platform,
  // which is both a policy issue and the main vector for off-platform scams.
  const contactLeak = detectContactDetails(text);
  if (contactLeak > 0) {
    flags.contact_in_description = contactLeak;
    reasons.push('Contact details in the description');
  }

  /* 4. Seller reputation --------------------------------------------------- */
  const trust = toNumber(listing.trust_score) ?? 0;
  const accountAgeHours = listing.user_created_at
    ? (Date.now() - (listing.user_created_at as Date).getTime()) / 3_600_000
    : 0;

  if (accountAgeHours < 1) {
    flags.brand_new_account = 0.4;
    reasons.push('Posted by a brand-new account');
  } else if (accountAgeHours < 48 && trust < 20) {
    flags.new_account = 0.25;
  }

  const priorFlags = await queryCount(
    `SELECT COUNT(*) FROM fake_detections
      WHERE target_kind = 'user' AND target_id = ? AND status IN ('detected','confirmed')`,
    [listing.user_id],
  );
  if (priorFlags > 0) {
    flags.seller_prior_flags = Math.min(1, 0.3 + priorFlags * 0.2);
    reasons.push(`Seller has ${priorFlags} previous flag(s)`);
  }

  /* 5. Posting velocity (§19 velocity) ------------------------------------ */
  const recentListings = await queryCount(
    `SELECT COUNT(*) FROM listings
      WHERE user_id = ? AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR) AND id <> ?`,
    [listing.user_id, listingId],
  );
  if (recentListings >= 20) {
    flags.velocity = 0.7;
    reasons.push(`${recentListings} listings created in the last hour`);
  } else if (recentListings >= 8) {
    flags.velocity = 0.3;
  }

  /* 6. Quality floor ------------------------------------------------------- */
  if (Number(listing.media_count ?? 0) === 0) {
    flags.no_media = 0.2;
    reasons.push('No photos');
  }
  if (Number(listing.completeness_score ?? 0) < 35) {
    flags.incomplete = 0.25;
    reasons.push('Very incomplete listing');
  }

  /* 7. Image reuse (§19 Image Similarity Detection) ----------------------- */
  const stolenMedia = await detectStolenMedia(listingId);
  if (stolenMedia > 0) {
    flags.stolen_media = stolenMedia;
    reasons.push('Photos already appear on another listing');
  }

  /* Decision -------------------------------------------------------------- */
  const maxFlag = Object.values(flags).reduce((max, value) => Math.max(max, value), 0);
  // Sum with diminishing weight: many weak signals should matter, but not add up
  // to a certainty.
  const combined = Math.min(
    1,
    maxFlag + Object.values(flags).reduce((sum, value) => sum + value, 0) * 0.15 - maxFlag * 0.15,
  );

  const trustedSeller = trust >= 60 && priorFlags === 0;
  const decision: ScreeningResult['decision'] =
    combined >= spamPolicy.reject || (flags.duplicate ?? 0) >= duplicatePolicy.reject
      ? 'reject'
      : combined >= (trustedSeller ? spamPolicy.review + 0.2 : spamPolicy.review)
        ? 'review'
        : 'approve';

  await execute(
    `INSERT INTO ai_moderation_results
       (entity_type, entity_id, decision, categories, max_score, spam_score, scam_score, provider, model)
     VALUES ('listing', ?, ?, ?, ?, ?, ?, 'internal', 'rules-v1')`,
    [
      listingId,
      decision === 'approve' ? 'approve' : decision === 'reject' ? 'reject' : 'flag',
      JSON.stringify(flags),
      combined,
      flags.spam ?? 0,
      flags.seller_prior_flags ?? 0,
    ],
  ).catch((error) => log.warn({ err: error }, 'could not persist moderation result'));

  let queueId: number | null = null;
  if (decision !== 'approve') {
    queueId = await enqueueForModeration({
      entityType: 'listing',
      entityId: listingId,
      marketplaceId: Number(listing.marketplace_id),
      reason: flags.duplicate ? 'duplicate' : Object.keys(flags).length > 0 ? 'ai_flagged' : 'manual',
      priority: decision === 'reject' ? 'high' : combined >= 0.6 ? 'high' : 'normal',
      aiScore: combined,
      aiLabels: flags,
    });
  }

  return { decision, flags, reasons, queueId };
}

const safeRegexTest = (pattern: string, text: string): boolean => {
  try {
    // Cap the pattern length to keep a pathological admin-entered regex from
    // becoming a denial of service.
    if (pattern.length > 200) return false;
    return new RegExp(pattern, 'i').test(text);
  } catch {
    return false;
  }
};

function detectContactDetails(text: string): number {
  let score = 0;
  if (/[\w.+-]+@[\w-]+\.[\w.]{2,}/.test(text)) score += 0.3;
  // Long digit runs, allowing for separators sellers use to evade a naive filter.
  if (/(?:\+?\d[\s.-]?){9,}/.test(text)) score += 0.3;
  if (/\b(whats\s?app|telegram|imo|viber|wechat)\b/i.test(text)) score += 0.15;
  return Math.min(1, score);
}

/** Flags photos whose perceptual hash already belongs to another listing. */
async function detectStolenMedia(listingId: number): Promise<number> {
  const matches = await queryCount(
    `SELECT COUNT(*)
       FROM media_hashes mine
       JOIN media_hashes other ON other.phash = mine.phash AND other.listing_id <> mine.listing_id
      WHERE mine.listing_id = ? AND other.listing_id IS NOT NULL`,
    [listingId],
  );
  if (matches === 0) return 0;
  return Math.min(1, 0.3 + matches * 0.15);
}

export async function enqueueForModeration(params: {
  entityType: 'listing' | 'user' | 'review' | 'message' | 'media' | 'business' | 'ad_creative' | 'forum_post' | 'conversation';
  entityId: number;
  marketplaceId?: number | null;
  reason: 'ai_flagged' | 'user_reported' | 'keyword_match' | 'new_seller' | 'high_value' | 'duplicate' | 'manual' | 'appeal' | 'random_audit';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  aiScore?: number;
  aiLabels?: Record<string, number>;
}): Promise<number> {
  // Do not create a second open item for the same entity; bump the priority
  // of the existing one instead so the queue does not fill with duplicates.
  const open = await queryOne<Row>(
    `SELECT id, priority FROM moderation_queue
      WHERE entity_type = ? AND entity_id = ? AND status IN ('pending','claimed','in_review')
      ORDER BY id DESC LIMIT 1`,
    [params.entityType, params.entityId],
  );

  if (open) {
    const order = ['low', 'normal', 'high', 'urgent'];
    if (order.indexOf(params.priority) > order.indexOf(String(open.priority))) {
      await execute('UPDATE moderation_queue SET priority = ?, report_count = report_count + 1 WHERE id = ?', [
        params.priority,
        open.id,
      ]);
    } else {
      await execute('UPDATE moderation_queue SET report_count = report_count + 1 WHERE id = ?', [open.id]);
    }
    return Number(open.id);
  }

  const slaHours = params.priority === 'urgent' ? 2 : params.priority === 'high' ? 8 : 24;
  const inserted = await execute(
    `INSERT INTO moderation_queue
       (uuid, entity_type, entity_id, marketplace_id, reason, priority, ai_score, ai_labels, status, sla_due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? HOUR))`,
    [
      uuid(),
      params.entityType,
      params.entityId,
      params.marketplaceId ?? null,
      params.reason,
      params.priority,
      params.aiScore ?? null,
      params.aiLabels ? JSON.stringify(params.aiLabels) : null,
      slaHours,
    ],
  );

  const queueId = inserted.insertId;

  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'moderation.queued', 'moderation_queue', queueId, {
      queueId,
      entityType: params.entityType,
      entityId: params.entityId,
      reason: params.reason,
      priority: params.priority,
    });
    void eventBus.publishAfterCommit(event);
  }).catch(() => undefined);

  return queueId;
}

/** §19 Fake Review Detection — runs when a review is submitted. */
export async function screenReview(reviewId: number): Promise<{ score: number; decision: 'approve' | 'review' }> {
  const review = await queryOne<Row>(
    `SELECT r.id, r.reviewer_id, r.subject_kind, r.subject_user_id, r.subject_listing_id, r.rating,
            r.body, r.is_transaction_verified, u.created_at AS reviewer_created_at,
            (SELECT COUNT(*) FROM reviews r2 WHERE r2.reviewer_id = r.reviewer_id) AS reviewer_review_count
       FROM reviews r JOIN users u ON u.id = r.reviewer_id
      WHERE r.id = ?`,
    [reviewId],
  );
  if (!review) return { score: 0, decision: 'approve' };

  let score = 0;
  const evidence: Record<string, unknown> = {};

  if (!toBoolean(review.is_transaction_verified)) {
    score += 0.2;
    evidence.unverified_transaction = true;
  }

  const ageHours = review.reviewer_created_at
    ? (Date.now() - (review.reviewer_created_at as Date).getTime()) / 3_600_000
    : 0;
  if (ageHours < 24) {
    score += 0.3;
    evidence.new_reviewer = true;
  }

  const body = String(review.body ?? '');
  if (body.trim().length < 15) {
    score += 0.15;
    evidence.very_short = true;
  }

  // Review rings: the same pair reviewing each other repeatedly.
  if (review.subject_user_id) {
    const reciprocal = await queryCount(
      `SELECT COUNT(*) FROM reviews
        WHERE reviewer_id = ? AND subject_user_id = ? AND id <> ?`,
      [review.subject_user_id, review.reviewer_id, reviewId],
    );
    if (reciprocal > 0) {
      score += 0.35;
      evidence.reciprocal_reviews = reciprocal;
    }

    const burst = await queryCount(
      `SELECT COUNT(*) FROM reviews
        WHERE subject_user_id = ? AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)`,
      [review.subject_user_id],
    );
    if (burst >= 5) {
      score += 0.3;
      evidence.review_burst = burst;
    }
  }

  score = Math.min(1, score);

  if (score >= 0.5) {
    await execute(
      `INSERT INTO fake_detections
         (target_kind, target_id, detection_kind, confidence, evidence, model, status)
       VALUES ('review', ?, 'fake_review', ?, ?, 'rules-v1', 'detected')`,
      [reviewId, score, JSON.stringify(evidence)],
    ).catch(() => undefined);

    await enqueueForModeration({
      entityType: 'review',
      entityId: reviewId,
      reason: 'ai_flagged',
      priority: score >= 0.75 ? 'high' : 'normal',
      aiScore: score,
    });
  }

  await execute('UPDATE reviews SET ai_authenticity_score = ? WHERE id = ?', [(1 - score) * 100, reviewId]).catch(
    () => undefined,
  );

  return { score, decision: score >= 0.5 ? 'review' : 'approve' };
}
