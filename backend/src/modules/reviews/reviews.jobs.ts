import { execute } from '../../db/query';
import { recomputeStaleSummaries } from './reviews.aggregate';
import { processPendingReviewMedia } from './reviews.media';

export async function expireReviewInvitations(): Promise<number> {
  const result = await execute(
    `UPDATE review_invitations
        SET status = 'expired'
      WHERE status IN ('pending','sent') AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP`,
  );
  return Number(result.affectedRows ?? 0);
}

export async function runReviewJobs(): Promise<{ invitations: number; media: number; aggregates: number }> {
  const invitations = await expireReviewInvitations();
  const media = await processPendingReviewMedia();
  const aggregates = await recomputeStaleSummaries();
  return { invitations, media, aggregates };
}
