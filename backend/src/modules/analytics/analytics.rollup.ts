import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { uuid } from '../../core/security/crypto';
import { loggerFor } from '../../config/logger';
import {
  FUNNEL_SEEDS,
  GMV_ORDER_KINDS,
  RENTAL_ORDER_KINDS,
  RETENTION_DAYS,
  funnelRates,
  mapRevenueSource,
  mapTrafficSource,
} from './analytics.catalog';

const log = loggerFor('analytics.rollup');

function dayString(value = new Date()): string {
  return value.toISOString().slice(0, 10);
}

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export async function ensureFunnelDefinitions(): Promise<number> {
  const marketplaces = await queryRows<Row>(`SELECT id, code FROM marketplaces`);
  const byCode = new Map(marketplaces.map((row) => [String(row.code), Number(row.id)]));
  let written = 0;
  for (const funnel of FUNNEL_SEEDS) {
    const marketplaceId =
      funnel.marketplaceId == null
        ? null
        : funnel.code.startsWith('gold.')
          ? byCode.get('gold') ?? funnel.marketplaceId
          : funnel.code.startsWith('property.')
            ? byCode.get('property') ?? funnel.marketplaceId
            : funnel.code.startsWith('vehicles.')
              ? byCode.get('vehicles') ?? funnel.marketplaceId
              : funnel.marketplaceId;
    await execute(
      `INSERT INTO funnel_definitions (code, name, marketplace_id, steps, window_hours, is_active)
       VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name), steps = VALUES(steps), window_hours = VALUES(window_hours), is_active = 1`,
      [funnel.code, funnel.name, marketplaceId, JSON.stringify(funnel.steps), funnel.windowHours],
    );
    written += 1;
  }
  return written;
}

async function upsertMetric(params: {
  date: string;
  key: string;
  marketplaceId?: number;
  countryId?: number;
  cityId?: number;
  platformId?: number;
  categoryId?: number;
  dimensionKey?: string;
  dimensionValue?: string;
  count: number;
  sum?: number | null;
  avg?: number | null;
  currency?: string | null;
}): Promise<void> {
  await execute(
    `INSERT INTO daily_metrics
       (metric_date, metric_key, marketplace_id, country_id, city_id, platform_id, category_id,
        dimension_key, dimension_value, value_count, value_sum, value_avg, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       value_count = VALUES(value_count),
       value_sum = VALUES(value_sum),
       value_avg = VALUES(value_avg),
       currency = COALESCE(VALUES(currency), currency)`,
    [
      params.date,
      params.key,
      params.marketplaceId ?? 0,
      params.countryId ?? 0,
      params.cityId ?? 0,
      params.platformId ?? 0,
      params.categoryId ?? 0,
      params.dimensionKey ?? '',
      params.dimensionValue ?? '',
      params.count,
      params.sum ?? null,
      params.avg ?? null,
      params.currency ?? null,
    ],
  );
}

async function rollupEvents(day: string): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT event_name,
            COALESCE(marketplace_id, 0) AS marketplace_id,
            COALESCE(country_id, 0) AS country_id,
            COALESCE(city_id, 0) AS city_id,
            COALESCE(platform_id, 0) AS platform_id,
            COALESCE(os_name, '') AS os_name,
            COALESCE(device_kind, '') AS device_kind,
            COUNT(*) AS c
       FROM analytics_events
      WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY event_name, marketplace_id, country_id, city_id, platform_id, os_name, device_kind`,
    [day, day],
  );
  for (const row of rows) {
    await upsertMetric({
      date: day,
      key: String(row.event_name),
      marketplaceId: Number(row.marketplace_id),
      countryId: Number(row.country_id),
      cityId: Number(row.city_id),
      platformId: Number(row.platform_id),
      count: Number(row.c),
    });
    if (String(row.os_name)) {
      await upsertMetric({
        date: day,
        key: String(row.event_name),
        marketplaceId: Number(row.marketplace_id),
        countryId: Number(row.country_id),
        platformId: Number(row.platform_id),
        dimensionKey: 'os',
        dimensionValue: String(row.os_name).slice(0, 96),
        count: Number(row.c),
      });
    }
    if (String(row.device_kind)) {
      await upsertMetric({
        date: day,
        key: String(row.event_name),
        marketplaceId: Number(row.marketplace_id),
        countryId: Number(row.country_id),
        platformId: Number(row.platform_id),
        dimensionKey: 'device',
        dimensionValue: String(row.device_kind).slice(0, 96),
        count: Number(row.c),
      });
    }
  }
  return rows.length;
}

async function rollupOperational(day: string): Promise<number> {
  let written = 0;
  const listings = await queryRows<Row>(
    `SELECT marketplace_id, country_id, COALESCE(city_id, 0) AS city_id, COALESCE(category_id, 0) AS category_id,
            COUNT(*) AS c,
            SUM(status = 'sold') AS sold,
            SUM(status = 'rented') AS rented,
            SUM(operation = 'rent') AS rental_listings
       FROM listings
      WHERE deleted_at IS NULL AND DATE(created_at) = ?
      GROUP BY marketplace_id, country_id, city_id, category_id`,
    [day],
  );
  for (const row of listings) {
    await upsertMetric({
      date: day,
      key: 'listings.created',
      marketplaceId: Number(row.marketplace_id),
      countryId: Number(row.country_id),
      cityId: Number(row.city_id),
      categoryId: Number(row.category_id),
      count: Number(row.c),
    });
    written += 1;
  }

  const sold = await queryRows<Row>(
    `SELECT marketplace_id, country_id, COALESCE(city_id, 0) AS city_id, COUNT(*) AS c
       FROM listings WHERE deleted_at IS NULL AND DATE(sold_at) = ?
      GROUP BY marketplace_id, country_id, city_id`,
    [day],
  );
  for (const row of sold) {
    await upsertMetric({
      date: day,
      key: 'listings.sold',
      marketplaceId: Number(row.marketplace_id),
      countryId: Number(row.country_id),
      cityId: Number(row.city_id),
      count: Number(row.c),
    });
    written += 1;
  }

  const users = await queryRows<Row>(
    `SELECT COALESCE(country_id, 0) AS country_id, COUNT(*) AS c,
            SUM(email_verified_at IS NOT NULL OR phone_verified_at IS NOT NULL) AS verified
       FROM users WHERE deleted_at IS NULL AND DATE(created_at) = ?
      GROUP BY country_id`,
    [day],
  );
  for (const row of users) {
    await upsertMetric({ date: day, key: 'users.signup', countryId: Number(row.country_id), count: Number(row.c) });
    await upsertMetric({ date: day, key: 'users.verified', countryId: Number(row.country_id), count: Number(row.verified) });
    written += 2;
  }

  const accountTypes = await queryRows<Row>(
    `SELECT COALESCE(country_id, 0) AS country_id, COALESCE(account_type, 'individual') AS account_type, COUNT(*) AS c
       FROM users
      WHERE deleted_at IS NULL AND DATE(created_at) = ?
      GROUP BY country_id, account_type`,
    [day],
  );
  for (const row of accountTypes) {
    await upsertMetric({
      date: day,
      key: 'users.signup',
      countryId: Number(row.country_id),
      dimensionKey: 'account_type',
      dimensionValue: String(row.account_type).slice(0, 96),
      count: Number(row.c),
    });
    written += 1;
  }

  const leads = await queryRows<Row>(
    `SELECT l.marketplace_id, l.country_id, COALESCE(l.city_id, 0) AS city_id, COUNT(*) AS c
       FROM listing_leads ll JOIN listings l ON l.id = ll.listing_id
      WHERE DATE(ll.created_at) = ?
      GROUP BY l.marketplace_id, l.country_id, l.city_id`,
    [day],
  );
  for (const row of leads) {
    await upsertMetric({
      date: day,
      key: 'leads.created',
      marketplaceId: Number(row.marketplace_id),
      countryId: Number(row.country_id),
      cityId: Number(row.city_id),
      count: Number(row.c),
    });
    written += 1;
  }
  return written;
}

async function rollupSales(day: string): Promise<number> {
  const kinds = GMV_ORDER_KINDS.map(() => '?').join(', ');
  const rows = await queryRows<Row>(
    `SELECT COALESCE(l.marketplace_id, 0) AS marketplace_id,
            COALESCE(l.country_id, o.country_id, 0) AS country_id,
            COALESCE(l.city_id, 0) AS city_id,
            COALESCE(l.category_id, 0) AS category_id,
            o.kind,
            o.currency,
            COUNT(*) AS c,
            COALESCE(SUM(o.total_amount), 0) AS gross,
            COALESCE(SUM(o.tax_amount), 0) AS tax
       FROM orders o
       LEFT JOIN listings l ON o.reference_type = 'listing' AND o.reference_id = l.id
      WHERE o.status IN ('paid', 'partially_refunded')
        AND o.kind IN (${kinds})
        AND DATE(COALESCE(o.paid_at, o.created_at)) = ?
      GROUP BY COALESCE(l.marketplace_id, 0), COALESCE(l.country_id, o.country_id, 0),
               COALESCE(l.city_id, 0), COALESCE(l.category_id, 0), o.kind, o.currency`,
    [...GMV_ORDER_KINDS, day],
  );
  for (const row of rows) {
    const rental = (RENTAL_ORDER_KINDS as readonly string[]).includes(String(row.kind));
    const money = toNumber(row.gross);
    const count = Number(row.c);
    const avg = count > 0 ? Number(money ?? 0) / count : 0;
    const dims = {
      date: day,
      marketplaceId: Number(row.marketplace_id),
      countryId: Number(row.country_id),
      cityId: Number(row.city_id),
      categoryId: Number(row.category_id),
      count,
      sum: money,
      avg,
      currency: String(row.currency),
    };
    await upsertMetric({ ...dims, key: rental ? 'rentals.revenue' : 'sales.gmv' });
    await upsertMetric({
      ...dims,
      key: rental ? 'rentals.revenue' : 'sales.gmv',
      dimensionKey: 'kind',
      dimensionValue: String(row.kind),
    });
    await upsertMetric({
      date: day,
      key: rental ? 'rentals.bookings' : 'sales.transactions',
      marketplaceId: Number(row.marketplace_id),
      countryId: Number(row.country_id),
      cityId: Number(row.city_id),
      count,
      currency: String(row.currency),
    });
  }

  const refunds = await queryRows<Row>(
    `SELECT COALESCE(l.marketplace_id, 0) AS marketplace_id, COALESCE(o.country_id, 0) AS country_id,
            o.currency, COALESCE(SUM(r.amount), 0) AS amount, COUNT(*) AS c
       FROM refunds r
       JOIN orders o ON o.id = r.order_id
       LEFT JOIN listings l ON o.reference_type = 'listing' AND o.reference_id = l.id
      WHERE r.status = 'succeeded' AND DATE(COALESCE(r.processed_at, r.created_at)) = ?
      GROUP BY COALESCE(l.marketplace_id, 0), COALESCE(o.country_id, 0), o.currency`,
    [day],
  );
  for (const row of refunds) {
    await upsertMetric({
      date: day,
      key: 'sales.refunds',
      marketplaceId: Number(row.marketplace_id),
      countryId: Number(row.country_id),
      count: Number(row.c),
      sum: toNumber(row.amount),
      currency: String(row.currency),
    });
  }
  return rows.length + refunds.length;
}


async function rollupRevenue(day: string): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT o.kind, o.currency, COALESCE(o.country_id, 0) AS country_id, COALESCE(l.marketplace_id, 0) AS marketplace_id,
            COUNT(*) AS c,
            COUNT(DISTINCT o.user_id) AS payers,
            COALESCE(SUM(o.total_amount), 0) AS gross,
            COALESCE(SUM(o.discount_amount), 0) AS discount,
            COALESCE(SUM(o.tax_amount), 0) AS tax
       FROM orders o
       LEFT JOIN listings l ON o.reference_type = 'listing' AND o.reference_id = l.id
      WHERE o.status IN ('paid', 'partially_refunded')
        AND o.kind IN ('subscription','promotion','advertisement','verification','inspection')
        AND DATE(COALESCE(o.paid_at, o.created_at)) = ?
      GROUP BY o.kind, o.currency, COALESCE(o.country_id, 0), COALESCE(l.marketplace_id, 0)`,
    [day],
  );
  for (const row of rows) {
    const gross = toNumber(row.gross) ?? 0;
    const discount = toNumber(row.discount) ?? 0;
    const tax = toNumber(row.tax) ?? 0;
    const net = gross - discount;
    const payers = Number(row.payers ?? 0);
    await execute(
      `INSERT INTO revenue_daily
         (revenue_date, marketplace_id, country_id, currency, source, gross_amount, discount_amount, tax_amount,
          refund_amount, net_amount, transaction_count, paying_user_count, arpu)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         gross_amount = VALUES(gross_amount),
         discount_amount = VALUES(discount_amount),
         tax_amount = VALUES(tax_amount),
         net_amount = VALUES(net_amount),
         transaction_count = VALUES(transaction_count),
         paying_user_count = VALUES(paying_user_count),
         arpu = VALUES(arpu)`,
      [
        day,
        Number(row.marketplace_id),
        Number(row.country_id),
        String(row.currency),
        mapRevenueSource(String(row.kind)),
        gross,
        discount,
        tax,
        net,
        Number(row.c),
        payers,
        payers > 0 ? net / payers : null,
      ],
    );
  }
  return rows.length;
}

async function rollupTraffic(day: string): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT COALESCE(platform_id, 0) AS platform_id, COALESCE(country_id, 0) AS country_id, COALESCE(city_id, 0) AS city_id,
            utm_source, utm_campaign, referrer, COUNT(*) AS sessions,
            COUNT(DISTINCT COALESCE(user_id, guest_uuid)) AS users,
            SUM(page_view_count) AS page_views,
            AVG(duration_secs) AS avg_secs,
            AVG(is_bounce) AS bounce
       FROM analytics_sessions
      WHERE started_at >= ? AND started_at < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY platform_id, country_id, city_id, utm_source, utm_campaign, referrer`,
    [day, day],
  );
  type Bucket = {
    countryId: number;
    cityId: number;
    platformId: number;
    source: string;
    campaign: string;
    sessions: number;
    users: number;
    pageViews: number;
    avgSecs: number | null;
    bounce: number | null;
  };
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    const source = mapTrafficSource((row.utm_source as string | null) ?? null, (row.referrer as string | null) ?? null);
    const campaign = String(row.utm_campaign ?? '');
    const key = `${row.country_id}|${row.city_id}|${row.platform_id}|${source}|${campaign}`;
    const current = buckets.get(key) ?? {
      countryId: Number(row.country_id),
      cityId: Number(row.city_id),
      platformId: Number(row.platform_id),
      source,
      campaign,
      sessions: 0,
      users: 0,
      pageViews: 0,
      avgSecs: null,
      bounce: null,
    };
    current.sessions += Number(row.sessions);
    current.users += Number(row.users);
    current.pageViews += Number(row.page_views ?? 0);
    current.avgSecs = row.avg_secs == null ? current.avgSecs : Math.round(Number(row.avg_secs));
    current.bounce = row.bounce == null ? current.bounce : Number((Number(row.bounce) * 100).toFixed(2));
    buckets.set(key, current);
  }
  await execute(`DELETE FROM traffic_daily WHERE metric_date = ?`, [day]);
  for (const bucket of buckets.values()) {
    await execute(
      `INSERT INTO traffic_daily
         (metric_date, marketplace_id, country_id, city_id, platform_id, source, utm_campaign,
          sessions, users, new_users, page_views, avg_session_secs, bounce_rate)
       VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        day,
        bucket.countryId,
        bucket.cityId,
        bucket.platformId,
        bucket.source,
        bucket.campaign,
        bucket.sessions,
        bucket.users,
        bucket.pageViews,
        bucket.avgSecs,
        bucket.bounce,
      ],
    );
  }
  return buckets.size;
}

async function rollupGrowth(day: string): Promise<number> {
  const countries = await queryRows<Row>(
    `SELECT COALESCE(country_id, 0) AS country_id, COUNT(*) AS signups,
            SUM(email_verified_at IS NOT NULL OR phone_verified_at IS NOT NULL) AS activated
       FROM users WHERE deleted_at IS NULL AND DATE(created_at) = ?
      GROUP BY country_id`,
    [day],
  );
  const dau = await queryRows<Row>(
    `SELECT COALESCE(country_id, 0) AS country_id, COUNT(DISTINCT user_id) AS c
       FROM user_sessions
      WHERE DATE(COALESCE(last_used_at, created_at)) = ?
      GROUP BY country_id`,
    [day],
  );
  const wau = await queryRows<Row>(
    `SELECT COALESCE(country_id, 0) AS country_id, COUNT(DISTINCT user_id) AS c
       FROM user_sessions
      WHERE COALESCE(last_used_at, created_at) >= DATE_SUB(?, INTERVAL 6 DAY)
        AND COALESCE(last_used_at, created_at) < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY country_id`,
    [day, day],
  );
  const mau = await queryRows<Row>(
    `SELECT COALESCE(country_id, 0) AS country_id, COUNT(DISTINCT user_id) AS c
       FROM user_sessions
      WHERE COALESCE(last_used_at, created_at) >= DATE_SUB(?, INTERVAL 29 DAY)
        AND COALESCE(last_used_at, created_at) < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY country_id`,
    [day, day],
  );
  const guests = await queryOneCount(
    `SELECT COUNT(*) FROM analytics_sessions WHERE user_id IS NULL AND DATE(started_at) = ?`,
    [day],
  );
  const map = (rows: Row[]) => new Map(rows.map((row) => [Number(row.country_id), Number(row.c ?? row.signups ?? 0)]));
  const dauMap = map(dau);
  const wauMap = map(wau);
  const mauMap = map(mau);
  const countrySet = new Set<number>([
    ...countries.map((row) => Number(row.country_id)),
    ...dauMap.keys(),
    ...wauMap.keys(),
    ...mauMap.keys(),
    0,
  ]);
  const signupMap = new Map(countries.map((row) => [Number(row.country_id), row]));
  for (const countryId of countrySet) {
    const signup = signupMap.get(countryId);
    await execute(
      `INSERT INTO user_growth_daily
         (metric_date, marketplace_id, country_id, new_signups, activated_users, dau, wau, mau, guest_sessions)
       VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         new_signups = VALUES(new_signups),
         activated_users = VALUES(activated_users),
         dau = VALUES(dau),
         wau = VALUES(wau),
         mau = VALUES(mau),
         guest_sessions = VALUES(guest_sessions)`,
      [
        day,
        countryId,
        Number(signup?.signups ?? 0),
        Number(signup?.activated ?? 0),
        dauMap.get(countryId) ?? 0,
        wauMap.get(countryId) ?? 0,
        mauMap.get(countryId) ?? 0,
        countryId === 0 ? guests : 0,
      ],
    );
  }
  return countrySet.size;
}

async function queryOneCount(sql: string, params: unknown[]): Promise<number> {
  const rows = await queryRows<Row>(sql, params);
  const first = rows[0];
  if (!first) return 0;
  return Number(Object.values(first)[0] ?? 0);
}

async function rollupFunnels(day: string): Promise<number> {
  const funnels = await queryRows<Row>(`SELECT code, marketplace_id, steps, window_hours FROM funnel_definitions WHERE is_active = 1`);
  let written = 0;
  for (const funnel of funnels) {
    const steps = parseSteps(funnel.steps);
    if (steps.length === 0) continue;
    const marketplaceId = funnel.marketplace_id == null ? null : Number(funnel.marketplace_id);
    const windowHours = funnelWindowHours(funnel.window_hours);
    let previous = 0;
    const startCount = await countFunnelStep(steps[0]!, day, marketplaceId, windowHours);
    for (let index = 0; index < steps.length; index += 1) {
      const count = await countFunnelStep(steps[index]!, day, marketplaceId, windowHours);
      const rates = funnelRates(index, count, previous, startCount);
      const fromPrev = rates.fromPrevious;
      const fromStart = rates.fromStart;
      await execute(
        `INSERT INTO funnel_daily
           (funnel_code, metric_date, step_index, step_name, user_count, conversion_from_previous, conversion_from_start)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           user_count = VALUES(user_count),
           conversion_from_previous = VALUES(conversion_from_previous),
           conversion_from_start = VALUES(conversion_from_start)`,
        [String(funnel.code), day, index, steps[index], count, fromPrev, fromStart],
      );
      previous = count;
      written += 1;
    }
  }
  return written;
}

function parseSteps(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function funnelWindowHours(raw: unknown): number {
  const parsed = Math.trunc(Number(raw));
  if (!Number.isFinite(parsed)) return 168;
  return Math.min(8760, Math.max(1, parsed));
}

async function countFunnelStep(step: string, day: string, marketplaceId: number | null, windowHours: number): Promise<number> {
  const hours = funnelWindowHours(windowHours);
  if (step === 'lead.created') {
    return queryOneCount(
      `SELECT COUNT(DISTINCT COALESCE(ll.buyer_id, ll.id)) FROM listing_leads ll
         JOIN listings l ON l.id = ll.listing_id
        WHERE ll.created_at >= DATE_SUB(?, INTERVAL ? HOUR) AND ll.created_at < DATE_ADD(?, INTERVAL 1 DAY)
          AND (? IS NULL OR l.marketplace_id = ?)`,
      [day, hours, day, marketplaceId, marketplaceId],
    );
  }
  if (step === 'offer.created') {
    return queryOneCount(
      `SELECT COUNT(DISTINCT o.id) FROM listing_offers o
         JOIN listings l ON l.id = o.listing_id
        WHERE o.created_at >= DATE_SUB(?, INTERVAL ? HOUR) AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)
          AND (? IS NULL OR l.marketplace_id = ?)`,
      [day, hours, day, marketplaceId, marketplaceId],
    );
  }
  if (step === 'listing.sold' || step === 'listing.rented') {
    const status = step === 'listing.sold' ? 'sold' : 'rented';
    return queryOneCount(
      `SELECT COUNT(*) FROM listings
        WHERE deleted_at IS NULL AND status = ? AND DATE(COALESCE(sold_at, updated_at)) = ?
          AND (? IS NULL OR marketplace_id = ?)`,
      [status, day, marketplaceId, marketplaceId],
    );
  }
  return queryOneCount(
    `SELECT COUNT(DISTINCT COALESCE(user_id, guest_uuid)) FROM analytics_events
      WHERE event_name = ? AND created_at >= DATE_SUB(?, INTERVAL ? HOUR) AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
        AND (? IS NULL OR marketplace_id = ?)`,
    [step, day, hours, day, marketplaceId, marketplaceId],
  );
}

async function rollupRetention(day: string): Promise<number> {
  let written = 0;
  for (const period of RETENTION_DAYS) {
    const cohortDate = addDays(day, -period);
    const cohorts = await queryRows<Row>(
      `SELECT COALESCE(country_id, 0) AS country_id, COUNT(*) AS size
         FROM users WHERE deleted_at IS NULL AND DATE(created_at) = ?
        GROUP BY country_id`,
      [cohortDate],
    );
    for (const row of cohorts) {
      const countryId = Number(row.country_id);
      const size = Number(row.size);
      const retained = await queryOneCount(
        `SELECT COUNT(DISTINCT u.id)
           FROM users u
           JOIN user_sessions s ON s.user_id = u.id
          WHERE u.deleted_at IS NULL AND DATE(u.created_at) = ?
            AND COALESCE(u.country_id, 0) = ?
            AND DATE(COALESCE(s.last_used_at, s.created_at)) = ?`,
        [cohortDate, countryId, day],
      );
      await execute(
        `INSERT INTO retention_cohorts
           (cohort_date, cohort_kind, marketplace_id, country_id, period_number, period_unit, cohort_size, retained_count, retention_pct)
         VALUES (?, 'signup', 0, ?, ?, 'day', ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           cohort_size = VALUES(cohort_size),
           retained_count = VALUES(retained_count),
           retention_pct = VALUES(retention_pct)`,
        [cohortDate, countryId, period, size, retained, size > 0 ? Number(((retained / size) * 100).toFixed(2)) : 0],
      );
      written += 1;
    }
  }
  return written;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(2));
}

export async function generateAiInsights(day: string): Promise<number> {
  const keys = ['sales.gmv', 'users.signup', 'leads.created', 'listings.created', 'listing.viewed'];
  let written = 0;
  const from = addDays(day, -6);
  const prevFrom = addDays(day, -13);
  const prevTo = addDays(day, -7);
  for (const key of keys) {
    const useSum = key === 'sales.gmv';
    const expr = useSum ? 'COALESCE(SUM(value_sum), 0)' : 'COALESCE(SUM(value_count), 0)';
    const current = await queryOneCount(
      `SELECT ${expr} FROM daily_metrics WHERE metric_key = ? AND metric_date BETWEEN ? AND ? AND dimension_key = ''`,
      [key, from, day],
    );
    const previous = await queryOneCount(
      `SELECT ${expr} FROM daily_metrics WHERE metric_key = ? AND metric_date BETWEEN ? AND ? AND dimension_key = ''`,
      [key, prevFrom, prevTo],
    );
    const change = pctChange(current, previous);
    if (change == null || (Math.abs(change) < 25 && current < 8 && previous < 8)) continue;
    const kind = Math.abs(change) >= 40 ? 'anomaly' : 'trend';
    const direction = change > 0 ? 'increased' : 'decreased';
    const headline = `${key} ${direction} ${Math.abs(change)}% vs prior week`;
    const existing = await queryOne<Row>(
      `SELECT id FROM ai_insights WHERE headline = ? AND period_end = ? AND was_dismissed = 0 LIMIT 1`,
      [headline.slice(0, 255), day],
    );
    if (existing) continue;
    const body = `Current 7d ${useSum ? 'sum' : 'count'} ${current} vs previous 7d ${previous}. Generated from daily_metrics only.`;
    await execute(
      `INSERT INTO ai_insights
         (uuid, scope, scope_id, marketplace_id, period_start, period_end, headline, body, insight_kind, severity,
          metrics, suggested_actions, model, confidence, expires_at)
       VALUES (?, 'platform', 'global', NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'analytics-rules-v1', ?, DATE_ADD(?, INTERVAL 7 DAY))`,
      [
        uuid(),
        from,
        day,
        headline.slice(0, 255),
        body,
        kind,
        Math.abs(change) >= 60 ? 'important' : Math.abs(change) >= 40 ? 'notable' : 'info',
        JSON.stringify({
          metric: key,
          current,
          previous,
          changePct: change,
          period: { from, to: day },
          comparisonPeriod: { from: prevFrom, to: prevTo },
        }),
        JSON.stringify(
          kind === 'anomaly'
            ? ['Review ingestion volume', 'Confirm no pipeline gap', 'Do not treat as fraud']
            : ['Compare marketplace mix', 'Check listing supply'],
        ),
        Math.min(95, 55 + Math.round(Math.min(Math.abs(change), 40))),
        day,
      ],
    );
    written += 1;
  }
  return written;
}

export async function runPlatformAnalyticsRollup(day?: string): Promise<{ processed: number; day: string }> {
  const target = day ?? dayString();
  await ensureFunnelDefinitions();
  const run = async (name: string, fn: () => Promise<number>): Promise<number> => {
    try {
      return await fn();
    } catch (error) {
      log.warn({ err: error, name, day: target }, 'analytics rollup step failed');
      return 0;
    }
  };
  const events = await run('events', () => rollupEvents(target));
  const operational = await run('operational', () => rollupOperational(target));
  const sales = await run('sales', () => rollupSales(target));
  const revenue = await run('revenue', () => rollupRevenue(target));
  const traffic = await run('traffic', () => rollupTraffic(target));
  const growth = await run('growth', () => rollupGrowth(target));
  const funnels = await run('funnels', () => rollupFunnels(target));
  const retention = await run('retention', () => rollupRetention(target));
  const insights = await run('insights', () => generateAiInsights(target));
  const processed = events + operational + sales + revenue + traffic + growth + funnels + retention + insights;
  log.info({ day: target, processed, events, sales, revenue, growth, funnels, insights }, 'platform analytics rolled up');
  return { processed, day: target };
}
