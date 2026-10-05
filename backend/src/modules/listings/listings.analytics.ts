import { execute, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';

export type AnalyticsEventType =
  | 'view'
  | 'unique_view'
  | 'impression'
  | 'favorite'
  | 'share'
  | 'message'
  | 'call'
  | 'offer'
  | 'booking'
  | 'conversion';

export async function enqueueListingAnalytics(params: {
  listingId: number;
  eventType: AnalyticsEventType;
  actorUserId?: number | null;
  guestUuid?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await execute(
    `INSERT INTO listing_analytics_events
       (listing_id, event_type, actor_user_id, guest_uuid, source, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      params.listingId,
      params.eventType,
      params.actorUserId ?? null,
      params.guestUuid ?? null,
      params.source ?? null,
      JSON.stringify(params.metadata ?? {}),
    ],
  );
}

export async function rollupListingAnalytics(limit = 2000): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT id, listing_id, event_type, actor_user_id, created_at
       FROM listing_analytics_events
      WHERE processed_at IS NULL
      ORDER BY id
      LIMIT ?`,
    [limit],
  );
  if (rows.length === 0) return 0;

  const byListing = new Map<
    number,
    { date: string; views: number; unique: number; impressions: number; favorites: number; shares: number; leads: number; calls: number; chats: number }
  >();

  for (const row of rows) {
    const listingId = Number(row.listing_id);
    const day = (row.created_at as Date).toISOString().slice(0, 10);
    const key = listingId;
    const current = byListing.get(key) ?? {
      date: day,
      views: 0,
      unique: 0,
      impressions: 0,
      favorites: 0,
      shares: 0,
      leads: 0,
      calls: 0,
      chats: 0,
    };
    current.date = day;
    switch (String(row.event_type)) {
      case 'view':
        current.views += 1;
        break;
      case 'unique_view':
        current.unique += 1;
        break;
      case 'impression':
        current.impressions += 1;
        break;
      case 'favorite':
        current.favorites += 1;
        break;
      case 'share':
        current.shares += 1;
        break;
      case 'offer':
      case 'conversion':
        current.leads += 1;
        break;
      case 'call':
        current.calls += 1;
        break;
      case 'message':
        current.chats += 1;
        break;
      default:
        break;
    }
    byListing.set(key, current);
  }

  for (const [listingId, agg] of byListing) {
    await execute(
      `INSERT INTO listing_metrics_daily
         (metric_date, listing_id, impressions, views, unique_views, favorites, shares, leads, calls, chats)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         impressions = impressions + VALUES(impressions),
         views = views + VALUES(views),
         unique_views = unique_views + VALUES(unique_views),
         favorites = favorites + VALUES(favorites),
         shares = shares + VALUES(shares),
         leads = leads + VALUES(leads),
         calls = calls + VALUES(calls),
         chats = chats + VALUES(chats)`,
      [
        agg.date,
        listingId,
        agg.impressions,
        agg.views,
        agg.unique,
        agg.favorites,
        agg.shares,
        agg.leads,
        agg.calls,
        agg.chats,
      ],
    );
    await execute(
      `UPDATE listings
          SET view_count = view_count + ?,
              unique_view_count = unique_view_count + ?,
              favorite_count = favorite_count + ?,
              share_count = share_count + ?,
              lead_count = lead_count + ?
        WHERE id = ?`,
      [agg.views, agg.unique, agg.favorites, agg.shares, agg.leads, listingId],
    );
  }

  const ids = rows.map((row) => Number(row.id));
  await execute(
    `UPDATE listing_analytics_events SET processed_at = CURRENT_TIMESTAMP WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids,
  );
  return rows.length;
}

export async function getListingAnalytics(listingId: number, days = 30) {
  const summary = await queryRows<Row>(
    `SELECT
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(views), 0) AS views,
        COALESCE(SUM(unique_views), 0) AS unique_views,
        COALESCE(SUM(favorites), 0) AS favorites,
        COALESCE(SUM(shares), 0) AS shares,
        COALESCE(SUM(leads), 0) AS leads,
        COALESCE(SUM(calls), 0) AS calls,
        COALESCE(SUM(chats), 0) AS chats,
        COALESCE(SUM(contact_reveals), 0) AS contact_reveals,
        COALESCE(SUM(search_appearances), 0) AS search_impressions
       FROM listing_metrics_daily
      WHERE listing_id = ? AND metric_date >= DATE_SUB(CURRENT_DATE, INTERVAL ? DAY)`,
    [listingId, days],
  );
  const row = summary[0];
  const daily = await queryRows<Row>(
    `SELECT metric_date, impressions, views, unique_views, favorites, shares, leads, calls, chats
       FROM listing_metrics_daily
      WHERE listing_id = ? AND metric_date >= DATE_SUB(CURRENT_DATE, INTERVAL ? DAY)
      ORDER BY metric_date`,
    [listingId, days],
  );

  return {
    periodDays: days,
    views: Number(row?.views ?? 0),
    uniqueViewers: Number(row?.unique_views ?? 0),
    searchImpressions: Number(row?.search_impressions ?? 0),
    favorites: Number(row?.favorites ?? 0),
    shares: Number(row?.shares ?? 0),
    messages: Number(row?.chats ?? 0),
    calls: Number(row?.calls ?? 0),
    offers: Number(row?.leads ?? 0),
    bookings: 0,
    conversions: Number(row?.leads ?? 0),
    series: daily.map((item) => ({
      date: (item.metric_date as Date).toISOString().slice(0, 10),
      views: Number(item.views ?? 0),
      impressions: Number(item.impressions ?? 0),
      favorites: Number(item.favorites ?? 0),
      leads: Number(item.leads ?? 0),
    })),
    ctr: (() => {
      const impressions = Number(row?.impressions ?? 0);
      const views = Number(row?.views ?? 0);
      return impressions > 0 ? Number((views / impressions).toFixed(4)) : null;
    })(),
  };
}

export async function recordShare(listingId: number, userId: number | null, channel: 'link' | 'whatsapp' | 'sms' | 'email' | 'other') {
  await execute(
    `INSERT INTO listing_shares (listing_id, user_id, channel) VALUES (?, ?, ?)`,
    [listingId, userId, channel],
  );
  await enqueueListingAnalytics({ listingId, eventType: 'share', actorUserId: userId, source: channel });
}
