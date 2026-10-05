import { execute, queryRows, type Row } from '../../db/query';
import { escapeLike } from '../../db/sql';

export async function suggest(params: {
  prefix: string;
  marketplaceId: number | null;
  userId: number | null;
  guestUuid: string | null;
  limit?: number;
}) {
  const prefix = params.prefix.trim().slice(0, 64);
  if (prefix.length < 1) return [];
  const limit = Math.min(params.limit ?? 10, 20);
  const like = `${escapeLike(prefix)}%`;

  const dictionary = await queryRows<Row>(
    `SELECT term, kind, weight, marketplace_id
       FROM search_suggestions
      WHERE is_active = 1
        AND term LIKE ?
        AND (marketplace_id <=> ? OR marketplace_id IS NULL)
      ORDER BY is_curated DESC, weight DESC
      LIMIT ?`,
    [like, params.marketplaceId, limit],
  );

  const recent =
    params.userId || params.guestUuid
      ? await queryRows<Row>(
          params.userId
            ? `SELECT query AS term, 'recent' AS kind, 50 AS weight, marketplace_id
                 FROM search_history WHERE user_id = ? AND query LIKE ? ORDER BY created_at DESC LIMIT 5`
            : `SELECT query AS term, 'recent' AS kind, 50 AS weight, marketplace_id
                 FROM search_history WHERE guest_uuid = ? AND query LIKE ? ORDER BY created_at DESC LIMIT 5`,
          [params.userId ?? params.guestUuid, like],
        )
      : [];

  const seen = new Set<string>();
  const items: Array<{ term: string; kind: string; marketplaceId: number | null }> = [];
  for (const row of [...recent, ...dictionary]) {
    const term = String(row.term);
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      term,
      kind: String(row.kind),
      marketplaceId: row.marketplace_id === null ? null : Number(row.marketplace_id),
    });
    if (items.length >= limit) break;
  }
  return items;
}

export async function refreshSuggestionWeights(): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT marketplace_id, normalized_query, COUNT(*) AS volume
       FROM search_history
      WHERE created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)
      GROUP BY marketplace_id, normalized_query
      HAVING volume >= 3
      LIMIT 200`,
  );
  let written = 0;
  for (const row of rows) {
    await execute(
      `INSERT INTO search_suggestions (marketplace_id, term, kind, weight, is_curated, is_active)
       VALUES (?, ?, 'keyword', ?, FALSE, TRUE)
       ON DUPLICATE KEY UPDATE weight = GREATEST(weight, VALUES(weight))`,
      [row.marketplace_id, String(row.normalized_query).slice(0, 191), Number(row.volume)],
    );
    written += 1;
  }
  return written;
}
