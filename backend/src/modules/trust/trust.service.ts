import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { recordAudit } from '../../middleware/audit';
import { applyEvents, bandFromScore, clampEventDelta, levelFromBand, type TrustBand } from './trust.math';

export interface TrustEventInput {
  userId: number;
  type: string;
  source: string;
  delta: number;
  weight?: number;
  marketplaceId?: number | null;
  referenceType?: string | null;
  referenceId?: string | number | null;
  explanation?: string | null;
  internalNotes?: string | null;
}

export async function recordTrustEvent(input: TrustEventInput): Promise<number> {
  const delta = clampEventDelta(input.delta);
  const id = await insertAndGetId(
    `INSERT INTO trust_score_events
       (user_id, event_type, source, weight, delta, marketplace_id, reference_type, reference_id, explanation, internal_notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied')`,
    [
      input.userId,
      input.type,
      input.source,
      input.weight ?? 1,
      delta,
      input.marketplaceId ?? null,
      input.referenceType ?? null,
      input.referenceId != null ? String(input.referenceId) : null,
      input.explanation ?? null,
      input.internalNotes ?? null,
    ],
  );
  await recomputeTrust(input.userId);
  return id;
}

export async function recomputeTrust(userId: number): Promise<{ score: number; band: TrustBand }> {
  const events = await queryRows<Row>(
    `SELECT delta, status FROM trust_score_events WHERE user_id = ? ORDER BY id`,
    [userId],
  );
  const score = applyEvents(events.map((row) => ({ delta: toNumber(row.delta) ?? 0, status: String(row.status) })));
  const band = bandFromScore(score);

  await execute(
    `INSERT INTO trust_scores (user_id, score, band)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE score = VALUES(score), band = VALUES(band)`,
    [userId, score, band],
  );

  const byMarketplace = await queryRows<Row>(
    `SELECT marketplace_id, SUM(delta) AS total
       FROM trust_score_events
      WHERE user_id = ? AND status = 'applied' AND marketplace_id IS NOT NULL
      GROUP BY marketplace_id`,
    [userId],
  );
  for (const row of byMarketplace) {
    const mpScore = Math.max(0, Math.min(100, toNumber(row.total) ?? 0));
    await execute(
      `INSERT INTO trust_marketplace_scores (user_id, marketplace_id, score, band)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE score = VALUES(score), band = VALUES(band)`,
      [userId, row.marketplace_id, mpScore, bandFromScore(mpScore)],
    );
  }

  void recordAudit({
    action: 'trust.recomputed',
    entityType: 'user',
    entityId: userId,
    after: { band },
    actorType: 'system',
  });

  return { score, band };
}

export async function getPublicTrust(userId: number) {
  const row = await queryOne<Row>(`SELECT score, band FROM trust_scores WHERE user_id = ?`, [userId]);
  const band = (row ? String(row.band) : 'new') as TrustBand;
  const ratings = await queryRows<Row>(
    `SELECT rs.marketplace_id, rs.average_rating, rs.review_count, m.code AS marketplace_code
       FROM rating_summaries rs
       LEFT JOIN marketplaces m ON m.id = rs.marketplace_id
      WHERE rs.subject_kind = 'user' AND rs.subject_id = ?`,
    [userId],
  );
  const overall = ratings.find((item) => Number(item.marketplace_id) === 0);
  return {
    level: levelFromBand(band),
    band,
    rating: {
      average: overall ? toNumber(overall.average_rating) ?? 0 : 0,
      count: overall ? Number(overall.review_count) : 0,
    },
    marketplaces: ratings
      .filter((item) => Number(item.marketplace_id) > 0)
      .map((item) => ({
        marketplace: String(item.marketplace_code ?? item.marketplace_id),
        average: toNumber(item.average_rating) ?? 0,
        count: Number(item.review_count),
      })),
  };
}

export async function getOwnerTrust(userId: number) {
  const publicTrust = await getPublicTrust(userId);
  const row = await queryOne<Row>(`SELECT score, computed_at FROM trust_scores WHERE user_id = ?`, [userId]);
  return {
    ...publicTrust,
    score: row ? toNumber(row.score) ?? 0 : 0,
    computedAt: row?.computed_at ? (row.computed_at as Date).toISOString() : null,
  };
}

export async function seedAccountAgeEvent(userId: number, createdAt: Date): Promise<void> {
  const days = (Date.now() - createdAt.getTime()) / 86_400_000;
  const delta = days >= 365 ? 8 : days >= 90 ? 4 : days >= 30 ? 2 : 0;
  if (delta === 0) return;
  const existing = await queryOne<Row>(
    `SELECT id FROM trust_score_events WHERE user_id = ? AND event_type = 'account_age' LIMIT 1`,
    [userId],
  );
  if (existing) return;
  await recordTrustEvent({
    userId,
    type: 'account_age',
    source: 'system',
    delta,
    explanation: 'Account age',
  });
}
