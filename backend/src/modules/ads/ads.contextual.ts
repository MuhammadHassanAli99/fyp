import { queryRows, type Row } from '../../db/query';
import type { RankableHit } from '../search/search.rank';
import { servePlacement, type ServedAd } from './ads.service';
import type { DeliveryContext } from './ads.eligibility';

/** Marks campaign-sponsored listings without changing organicScore. */
export async function markCampaignSponsored(hits: RankableHit[]): Promise<RankableHit[]> {
  if (hits.length === 0) return hits;
  const ids = [...new Set(hits.map((hit) => hit.listingId))];
  const rows = await queryRows<Row>(
    `SELECT listing_id FROM sponsored_listings
      WHERE status = 'active'
        AND listing_id IN (${ids.map(() => '?').join(',')})
        AND (starts_at IS NULL OR starts_at <= CURRENT_TIMESTAMP)
        AND (ends_at IS NULL OR ends_at >= CURRENT_TIMESTAMP)`,
    ids,
  );
  const sponsored = new Set(rows.map((row) => Number(row.listing_id)));
  if (sponsored.size === 0) return hits;
  return hits.map((hit) => (sponsored.has(hit.listingId) ? { ...hit, isSponsoredEligible: true } : hit));
}

export async function contextualAdsForSearch(ctx: DeliveryContext): Promise<ServedAd[]> {
  const [native, banner] = await Promise.all([
    servePlacement('search_native_3', ctx, 1),
    servePlacement('search_banner', ctx, 1),
  ]);
  return [...native.ads, ...banner.ads];
}
