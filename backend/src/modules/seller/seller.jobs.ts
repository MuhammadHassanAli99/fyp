import { execute, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { loggerFor } from '../../config/logger';

const log = loggerFor('seller.jobs');

function dayString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Fills seller_metrics_daily from listing_metrics_daily + orders + follows.
 * Unique key is (metric_date, user_id, marketplace_id).
 */
export async function rollupSellerMetrics(day?: string): Promise<number> {
  const target = day ?? dayString(new Date());
  const listingAgg = await queryRows<Row>(
    `SELECT ? AS metric_date,
            l.user_id,
            MAX(l.business_id) AS business_id,
            l.marketplace_id,
            COUNT(DISTINCT CASE WHEN l.status = 'published' THEN l.id END) AS active_listings,
            COALESCE(SUM(m.impressions), 0) AS impressions,
            COALESCE(SUM(m.views), 0) AS views,
            COALESCE(SUM(m.unique_views), 0) AS unique_views,
            COALESCE(SUM(m.favorites), 0) AS favorites,
            COALESCE(SUM(m.leads), 0) AS leads,
            COALESCE(SUM(m.calls), 0) AS calls,
            COALESCE(SUM(m.chats), 0) AS chats,
            COALESCE(SUM(m.contact_reveals), 0) AS contact_reveals
       FROM listings l
       LEFT JOIN listing_metrics_daily m
         ON m.listing_id = l.id AND m.metric_date = ?
      WHERE l.deleted_at IS NULL
      GROUP BY l.user_id, l.marketplace_id`,
    [target, target],
  );

  let written = 0;
  for (const row of listingAgg) {
    await execute(
      `INSERT INTO seller_metrics_daily
         (metric_date, user_id, business_id, marketplace_id, active_listings, impressions, views, unique_views,
          favorites, leads, calls, chats, contact_reveals)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         business_id = VALUES(business_id),
         active_listings = VALUES(active_listings),
         impressions = VALUES(impressions),
         views = VALUES(views),
         unique_views = VALUES(unique_views),
         favorites = VALUES(favorites),
         leads = VALUES(leads),
         calls = VALUES(calls),
         chats = VALUES(chats),
         contact_reveals = VALUES(contact_reveals)`,
      [
        target,
        Number(row.user_id),
        row.business_id === null ? null : Number(row.business_id),
        Number(row.marketplace_id),
        Number(row.active_listings ?? 0),
        Number(row.impressions ?? 0),
        Number(row.views ?? 0),
        Number(row.unique_views ?? 0),
        Number(row.favorites ?? 0),
        Number(row.leads ?? 0),
        Number(row.calls ?? 0),
        Number(row.chats ?? 0),
        Number(row.contact_reveals ?? 0),
      ],
    );
    written += 1;
  }

  const revenue = await queryRows<Row>(
    `SELECT l.user_id, l.marketplace_id, COALESCE(SUM(o.total_amount), 0) AS revenue, MAX(o.currency) AS currency
       FROM orders o
       JOIN listings l ON o.reference_type = 'listing' AND o.reference_id = l.id
      WHERE o.status IN ('paid', 'partially_refunded')
        AND o.kind IN ('listing_purchase', 'rental_payment', 'booking_payment', 'parts_purchase', 'escrow')
        AND DATE(COALESCE(o.paid_at, o.created_at)) = ?
      GROUP BY l.user_id, l.marketplace_id`,
    [target],
  );
  for (const row of revenue) {
    await execute(
      `INSERT INTO seller_metrics_daily (metric_date, user_id, marketplace_id, revenue, currency)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE revenue = VALUES(revenue), currency = COALESCE(VALUES(currency), currency)`,
      [target, Number(row.user_id), Number(row.marketplace_id), toNumber(row.revenue) ?? 0, (row.currency as string | null) ?? null],
    );
    written += 1;
  }

  const spend = await queryRows<Row>(
    `SELECT user_id, COALESCE(SUM(total_amount), 0) AS spend, MAX(currency) AS currency
       FROM orders
      WHERE status IN ('paid', 'partially_refunded')
        AND kind IN ('subscription', 'promotion', 'advertisement')
        AND DATE(COALESCE(paid_at, created_at)) = ?
      GROUP BY user_id`,
    [target],
  );
  for (const row of spend) {
    await execute(
      `INSERT INTO seller_metrics_daily (metric_date, user_id, marketplace_id, spend, currency)
       VALUES (?, ?, 0, ?, ?)
       ON DUPLICATE KEY UPDATE spend = VALUES(spend), currency = COALESCE(VALUES(currency), currency)`,
      [target, Number(row.user_id), toNumber(row.spend) ?? 0, (row.currency as string | null) ?? null],
    );
    written += 1;
  }

  const follows = await queryRows<Row>(
    `SELECT followee_id AS user_id, COUNT(*) AS gained
       FROM user_follows
      WHERE DATE(created_at) = ?
      GROUP BY followee_id`,
    [target],
  );
  for (const row of follows) {
    await execute(
      `INSERT INTO seller_metrics_daily (metric_date, user_id, marketplace_id, followers_gained)
       VALUES (?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE followers_gained = VALUES(followers_gained)`,
      [target, Number(row.user_id), Number(row.gained ?? 0)],
    );
    written += 1;
  }

  log.debug({ day: target, written }, 'seller metrics rolled up');
  return written;
}
