import { execute, queryRows, type Row } from '../../db/query';

export async function listTrendingSearches(params: {
  marketplaceId: number | null;
  countryId: number | null;
  regionId?: number | null;
  cityId?: number | null;
  period?: 'hour' | 'day' | 'week' | 'month';
  limit?: number;
}) {
  const period = params.period ?? 'day';
  const limit = params.limit ?? 10;
  const today = new Date().toISOString().slice(0, 10);
  const rows = await queryRows<Row>(
    `SELECT term, normalized_term, search_count, unique_users, click_count, growth_rate, ctr, rank_position
       FROM trending_searches
      WHERE period = ? AND period_start = ?
        AND (marketplace_id <=> ?)
        AND (country_id <=> ?)
        AND (city_id <=> ?)
      ORDER BY rank_position ASC, search_count DESC
      LIMIT ?`,
    [period, today, params.marketplaceId, params.countryId, params.cityId ?? null, limit],
  );
  return rows.map((row) => ({
    term: String(row.term),
    searchCount: Number(row.search_count),
    uniqueUsers: Number(row.unique_users ?? 0),
    clickCount: Number(row.click_count),
    growthRate: Number(row.growth_rate ?? 0),
    ctr: Number(row.ctr ?? 0),
    rank: Number(row.rank_position),
  }));
}

/**
 * Trending is not raw search count. Score combines volume, unique users,
 * growth vs previous window, and CTR.
 */
export async function rollupTrendingSearches(): Promise<number> {
  const periodStart = new Date().toISOString().slice(0, 10);
  const rows = await queryRows<Row>(
    `SELECT marketplace_id, country_id, city_id, normalized_query,
            ANY_VALUE(query) AS term,
            COUNT(*) AS search_count,
            COUNT(DISTINCT COALESCE(user_id, guest_uuid)) AS unique_users,
            SUM(CASE WHEN clicked_listing_id IS NOT NULL THEN 1 ELSE 0 END) AS click_count
       FROM search_history
      WHERE created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 DAY)
        AND CHAR_LENGTH(normalized_query) >= 2
      GROUP BY marketplace_id, country_id, city_id, normalized_query
      HAVING unique_users >= 1
      ORDER BY search_count DESC
      LIMIT 400`,
  );

  const previous = await queryRows<Row>(
    `SELECT marketplace_id, country_id, city_id, normalized_term, search_count
       FROM trending_searches
      WHERE period = 'day' AND period_start = DATE_SUB(?, INTERVAL 1 DAY)`,
    [periodStart],
  );
  const prevMap = new Map(
    previous.map((row) => [
      `${row.marketplace_id}|${row.country_id}|${row.city_id}|${row.normalized_term}`,
      Number(row.search_count),
    ]),
  );

  const scored = rows.map((row) => {
    const key = `${row.marketplace_id}|${row.country_id}|${row.city_id}|${row.normalized_query}`;
    const prev = prevMap.get(key) ?? 0;
    const searchCount = Number(row.search_count);
    const uniqueUsers = Number(row.unique_users);
    const clickCount = Number(row.click_count);
    const ctr = searchCount > 0 ? clickCount / searchCount : 0;
    const growth = prev > 0 ? (searchCount - prev) / prev : 1;
    const score = searchCount * 0.35 + uniqueUsers * 0.3 + Math.max(growth, 0) * 20 + ctr * 15;
    return { row, searchCount, uniqueUsers, clickCount, ctr, growth, score };
  });
  scored.sort((a, b) => b.score - a.score);

  let rank = 1;
  for (const item of scored.slice(0, 80)) {
    await execute(
      `INSERT INTO trending_searches
         (marketplace_id, country_id, city_id, term, normalized_term, search_count, unique_users,
          click_count, growth_rate, ctr, period, period_start, rank_position, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'day', ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         term = VALUES(term), search_count = VALUES(search_count), unique_users = VALUES(unique_users),
         click_count = VALUES(click_count), growth_rate = VALUES(growth_rate), ctr = VALUES(ctr),
         rank_position = VALUES(rank_position), computed_at = CURRENT_TIMESTAMP`,
      [
        item.row.marketplace_id,
        item.row.country_id,
        item.row.city_id,
        String(item.row.term).slice(0, 255),
        String(item.row.normalized_query).slice(0, 255),
        item.searchCount,
        item.uniqueUsers,
        item.clickCount,
        Number(item.growth.toFixed(4)),
        Number(item.ctr.toFixed(4)),
        periodStart,
        rank,
      ],
    );
    rank += 1;
  }
  return scored.length;
}
