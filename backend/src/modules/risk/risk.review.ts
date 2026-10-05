import { execute, queryCount, queryOne, type Row } from '../../db/query';
import { toBoolean } from '../../db/sql';
import { evaluateRisk } from './risk.engine';
import { signalHit } from './risk.signals';
import { upsertRelationship } from './risk.graph';
import type { ReviewRiskState, RiskDecisionRecord } from './risk.types';

export interface ReviewRiskAssessment {
  state: ReviewRiskState;
  score: number;
  decision: RiskDecisionRecord;
}

export function reviewStateFrom(score: number, decision: string): ReviewRiskState {
  if (decision === 'block' || decision === 'temporary_restriction' || score >= 0.85) return 'REJECTED';
  if (decision === 'review' || decision === 'step_up_verification' || score >= 0.5) return 'REVIEW';
  if (score >= 0.25 || decision === 'allow_with_monitoring') return 'SUSPICIOUS';
  return 'NORMAL';
}

export async function assessReviewRisk(reviewId: number): Promise<ReviewRiskAssessment> {
  const review = await queryOne<Row>(
    `SELECT r.id, r.reviewer_id, r.subject_user_id, r.body, r.is_transaction_verified, r.rating,
            u.created_at AS reviewer_created_at
       FROM reviews r JOIN users u ON u.id = r.reviewer_id
      WHERE r.id = ?`,
    [reviewId],
  );
  const extra = [];
  let heuristic = 0;
  if (review && !toBoolean(review.is_transaction_verified)) {
    extra.push(await signalHit('unverified_review', 12, undefined, 'content'));
    heuristic += 0.2;
  }
  const ageHours = review?.reviewer_created_at
    ? (Date.now() - new Date(review.reviewer_created_at as Date).getTime()) / 3_600_000
    : 0;
  if (ageHours < 24) heuristic += 0.3;
  if (String(review?.body ?? '').trim().length < 15) heuristic += 0.15;

  if (review?.subject_user_id) {
    const reciprocal = await queryCount(
      `SELECT COUNT(*) FROM reviews WHERE reviewer_id = ? AND subject_user_id = ? AND id <> ?`,
      [review.subject_user_id, review.reviewer_id, reviewId],
    );
    if (reciprocal > 0) heuristic += 0.35;
    await upsertRelationship({
      fromKind: 'user',
      fromKey: String(review.reviewer_id),
      toKind: 'user',
      toKey: String(review.subject_user_id),
      relType: 'USER_CREATED_REVIEW',
      strength: 0.3,
    });
  }

  const decision = await evaluateRisk(
    {
      eventType: 'REVIEW_CREATED',
      subjectKind: 'review',
      subjectId: reviewId,
      userId: review ? Number(review.reviewer_id) : null,
      reviewId,
      policyCode: 'review',
    },
    extra,
  );

  const state = reviewStateFrom(heuristic, decision.decision);
  if (state === 'REVIEW' || state === 'REJECTED') {
    await execute(
      `INSERT INTO fake_detections
         (target_kind, target_id, detection_kind, confidence, evidence, model, status)
       VALUES ('review', ?, 'fake_review', ?, ?, 'rules-v1', 'detected')`,
      [reviewId, heuristic, JSON.stringify({ heuristic, decision: decision.decision })],
    ).catch(() => undefined);
  }

  return { state, score: heuristic, decision };
}
