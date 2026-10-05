import { execute, queryOne, type Row } from '../../db/query';

/**
 * SQL aggregates — never load every review row into the process.
 * marketplace_id 0 is the cross-marketplace summary row.
 */
export async function recomputeRatingSummary(
  subjectKind: 'user' | 'listing' | 'business',
  subjectId: number,
  marketplaceId: number,
): Promise<void> {
  if (!subjectId) return;
  const subjectColumn =
    subjectKind === 'user' ? 'subject_user_id' : subjectKind === 'listing' ? 'subject_listing_id' : 'subject_business_id';

  const row = await queryOne<Row>(
    `SELECT COUNT(*) AS review_count,
            COALESCE(AVG(rating), 0) AS average_rating,
            SUM(is_transaction_verified = 1) AS verified_review_count,
            SUM(ROUND(rating) = 1) AS rating_1_count,
            SUM(ROUND(rating) = 2) AS rating_2_count,
            SUM(ROUND(rating) = 3) AS rating_3_count,
            SUM(ROUND(rating) = 4) AS rating_4_count,
            SUM(ROUND(rating) = 5) AS rating_5_count
       FROM reviews
      WHERE subject_kind = ? AND ${subjectColumn} = ?
        AND status = 'published' AND deleted_at IS NULL
        AND (? = 0 OR marketplace_id = ?)`,
    [subjectKind, subjectId, marketplaceId, marketplaceId],
  );

  const criteria = await queryOne<Row>(
    `SELECT JSON_OBJECTAGG(c.code, ROUND(AVG(cr.rating), 2)) AS averages
       FROM review_criteria_ratings cr
       JOIN review_criteria c ON c.id = cr.criteria_id
       JOIN reviews r ON r.id = cr.review_id
      WHERE r.subject_kind = ? AND r.${subjectColumn} = ?
        AND r.status = 'published' AND r.deleted_at IS NULL
        AND (? = 0 OR r.marketplace_id = ?)`,
    [subjectKind, subjectId, marketplaceId, marketplaceId],
  ).catch(() => null);

  await execute(
    `INSERT INTO rating_summaries
       (subject_kind, subject_id, marketplace_id, review_count, verified_review_count, average_rating,
        rating_1_count, rating_2_count, rating_3_count, rating_4_count, rating_5_count, criteria_averages)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       review_count = VALUES(review_count),
       verified_review_count = VALUES(verified_review_count),
       average_rating = VALUES(average_rating),
       rating_1_count = VALUES(rating_1_count),
       rating_2_count = VALUES(rating_2_count),
       rating_3_count = VALUES(rating_3_count),
       rating_4_count = VALUES(rating_4_count),
       rating_5_count = VALUES(rating_5_count),
       criteria_averages = VALUES(criteria_averages)`,
    [
      subjectKind,
      subjectId,
      marketplaceId,
      Number(row?.review_count ?? 0),
      Number(row?.verified_review_count ?? 0),
      Number(row?.average_rating ?? 0).toFixed(2),
      Number(row?.rating_1_count ?? 0),
      Number(row?.rating_2_count ?? 0),
      Number(row?.rating_3_count ?? 0),
      Number(row?.rating_4_count ?? 0),
      Number(row?.rating_5_count ?? 0),
      criteria?.averages ? JSON.stringify(criteria.averages) : null,
    ],
  );

  if (marketplaceId !== 0) await recomputeRatingSummary(subjectKind, subjectId, 0);
}

export async function recomputeStaleSummaries(limit = 40): Promise<number> {
  const { queryRows } = await import('../../db/query');
  const rows = await queryRows<Row>(
    `SELECT DISTINCT subject_kind, subject_user_id, subject_listing_id, subject_business_id, marketplace_id
       FROM reviews
      WHERE status = 'published' AND deleted_at IS NULL
        AND updated_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)
      LIMIT ?`,
    [limit],
  );
  for (const row of rows) {
    const kind = String(row.subject_kind) as 'user' | 'listing' | 'business';
    const id =
      kind === 'user'
        ? Number(row.subject_user_id)
        : kind === 'listing'
          ? Number(row.subject_listing_id)
          : Number(row.subject_business_id);
    await recomputeRatingSummary(kind, id, Number(row.marketplace_id ?? 0));
  }
  return rows.length;
}
