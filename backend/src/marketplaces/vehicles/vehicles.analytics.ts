import { queryRows, type Row } from '../../db/query';
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
    `SELECT day, views, unique_visitors, favorites, leads, offers
       FROM vehicle_analytics_daily
      WHERE listing_id = ?
      ORDER BY day DESC
      LIMIT 30`,
    [listingId],
  );
  const offers = await queryRows<Row>(
    `SELECT COUNT(*) AS c, SUM(status = 'accepted') AS accepted FROM listing_offers WHERE listing_id = ?`,
    [listingId],
  );
  return {
    listingId,
    views: Number(row.view_count ?? 0),
    uniqueVisitors: Number(row.unique_view_count ?? 0),
    favorites: Number(row.favorite_count ?? 0),
    leads: Number(row.lead_count ?? 0),
    offers: Number(offers[0]?.c ?? 0),
    acceptedOffers: Number(offers[0]?.accepted ?? 0),
    daily: daily.map((item) => ({
      day: String(item.day).slice(0, 10),
      views: Number(item.views),
      uniqueVisitors: Number(item.unique_visitors),
      favorites: Number(item.favorites),
      leads: Number(item.leads),
      offers: Number(item.offers),
    })),
    privacy: 'Aggregates only. Individual visitor identities are not included.',
  };
}
