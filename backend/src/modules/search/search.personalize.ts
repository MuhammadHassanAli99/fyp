import { queryRows, type Row } from '../../db/query';
import type { RankableHit } from './search.rank';

/**
 * Personalization is a ranking nudge, not a filter. Caps keep the user from
 * being trapped in a bubble of previously clicked categories.
 */
export async function personalizationBoost(userId: number | null, hits: RankableHit[]): Promise<RankableHit[]> {
  if (!userId || hits.length === 0) return hits;
  const [favorites, recent] = await Promise.all([
    queryRows<Row>(
      `SELECT l.category_id, COUNT(*) AS n
         FROM favorites f JOIN listings l ON l.id = COALESCE(f.listing_id, IF(f.entity_type = 'listing', f.entity_id, NULL))
        WHERE f.user_id = ?
        GROUP BY l.category_id
        ORDER BY n DESC LIMIT 8`,
      [userId],
    ).catch(() => [] as Row[]),
    queryRows<Row>(
      `SELECT clicked_listing_id FROM search_history
        WHERE user_id = ? AND clicked_listing_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 20`,
      [userId],
    ).catch(() => [] as Row[]),
  ]);

  const favoriteCategories = new Set(favorites.map((row) => Number(row.category_id)));
  const clicked = new Set(recent.map((row) => Number(row.clicked_listing_id)));

  return hits.map((hit) => {
    const card = hit.card as { categoryId?: number } | undefined;
    let boost = 0;
    if (card?.categoryId && favoriteCategories.has(card.categoryId)) boost += 0.06;
    if (clicked.has(hit.listingId)) boost -= 0.02;
    const organicScore = Math.min(1, hit.organicScore + boost);
    return { ...hit, organicScore, finalScore: hit.placement === 'sponsored' ? hit.finalScore : organicScore };
  });
}
