import { queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { forbidden, notFound } from '../../core/errors';

export async function getListingAnalytics(listingId: number, userId: number, isStaff: boolean) {
  const listing = await queryRows<Row>(
    `SELECT id, user_id, view_count, unique_view_count, favorite_count, lead_count, published_at, sold_at
       FROM listings WHERE id = ? AND deleted_at IS NULL`,
    [listingId],
  );
  const row = listing[0];
  if (!row) throw notFound('Listing');
  if (!isStaff && Number(row.user_id) !== userId) throw forbidden('You can only view analytics for your listings');

  const daily = await queryRows<Row>(
    `SELECT day, views, unique_visitors, favorites, messages, calls, leads, offers
       FROM property_analytics_daily
      WHERE listing_id = ?
      ORDER BY day DESC
      LIMIT 30`,
    [listingId],
  );

  const offers = await queryRows<Row>(
    `SELECT COUNT(*) AS c, SUM(status = 'accepted') AS accepted
       FROM listing_offers WHERE listing_id = ?`,
    [listingId],
  );
  const offerRow = offers[0];
  const publishedAt = row.published_at ? new Date(row.published_at as Date).getTime() : null;
  const closedAt = row.sold_at ? new Date(row.sold_at as Date).getTime() : Date.now();
  const daysOnMarket =
    publishedAt && closedAt > publishedAt ? Math.round((closedAt - publishedAt) / 86_400_000) : null;

  return {
    listingId,
    views: Number(row.view_count ?? 0),
    uniqueVisitors: Number(row.unique_view_count ?? 0),
    favorites: Number(row.favorite_count ?? 0),
    leads: Number(row.lead_count ?? 0),
    offers: Number(offerRow?.c ?? 0),
    acceptedOffers: Number(offerRow?.accepted ?? 0),
    conversionRate:
      Number(row.unique_view_count ?? 0) > 0
        ? Number(row.lead_count ?? 0) / Number(row.unique_view_count)
        : 0,
    daysOnMarket,
    daily: daily.map((item) => ({
      day: String(item.day).slice(0, 10),
      views: Number(item.views),
      uniqueVisitors: Number(item.unique_visitors),
      favorites: Number(item.favorites),
      messages: Number(item.messages),
      calls: Number(item.calls),
      leads: Number(item.leads),
      offers: Number(item.offers),
    })),
    privacy: 'Aggregates only. Individual visitor identities are not included.',
  };
}

export { toNumber };
