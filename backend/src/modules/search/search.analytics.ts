import { execute } from '../../db/query';

export type SearchAnalyticsEvent =
  | 'search'
  | 'search_success'
  | 'search_zero_result'
  | 'impression'
  | 'click'
  | 'favorite'
  | 'contact'
  | 'call'
  | 'message'
  | 'share'
  | 'conversion'
  | 'filter_apply'
  | 'filter_clear'
  | 'filter_chip_remove'
  | 'save_search'
  | 'map_open'
  | 'map_move'
  | 'nearby_search'
  | 'marker_click'
  | 'listing_click'
  | 'directions_click'
  | 'street_view'
  | 'satellite'
  | 'poi_click';

export async function trackSearchEvent(params: {
  eventType: SearchAnalyticsEvent;
  userId: number | null;
  guestUuid: string | null;
  marketplaceId: number | null;
  queryHash?: string | null;
  listingId?: number | null;
  position?: number | null;
  metadata?: Record<string, unknown>;
  countryId: number | null;
  cityId?: number | null;
}) {
  await execute(
    `INSERT INTO search_analytics_events
       (event_type, user_id, guest_uuid, marketplace_id, query_hash, listing_id, position, metadata, country_id, city_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.eventType,
      params.userId,
      params.guestUuid,
      params.marketplaceId,
      params.queryHash ?? null,
      params.listingId ?? null,
      params.position ?? null,
      JSON.stringify(params.metadata ?? {}),
      params.countryId,
      params.cityId ?? null,
    ],
  ).catch(() => undefined);
}

export async function markSearchClick(params: {
  userId: number | null;
  guestUuid: string | null;
  listingId: number;
  query?: string;
}) {
  if (!params.query) return;
  await execute(
    params.userId
      ? `UPDATE search_history SET clicked_listing_id = ? WHERE user_id = ? AND query = ? ORDER BY id DESC LIMIT 1`
      : `UPDATE search_history SET clicked_listing_id = ? WHERE guest_uuid = ? AND query = ? ORDER BY id DESC LIMIT 1`,
    [params.listingId, params.userId ?? params.guestUuid, params.query.slice(0, 255)],
  ).catch(() => undefined);
}
