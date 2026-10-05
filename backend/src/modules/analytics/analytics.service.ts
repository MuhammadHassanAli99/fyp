import { queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { remember, cacheKeys } from '../../config/cache';
import { recordAudit } from '../../middleware/audit';
import type { AuthPrincipal } from '../../types/express';
import { listingScopeSql } from '../seller/seller.scope';
import { dimSql, isPlatformScope, resolveAnalyticsScope, type AnalyticsScope } from './analytics.scope';
import type { AnalyticsQuery } from './analytics.schema';
import { RETENTION_DAYS } from './analytics.catalog';

function money(value: unknown): number {
  return toNumber(value) ?? 0;
}

function isoDay(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? '');
  return text.length >= 10 ? text.slice(0, 10) : text;
}

function cacheKey(scope: AnalyticsScope, report: string): string {
  return cacheKeys.analytics(
    scope.userId,
    `${report}:${scope.mode}:${scope.marketplaceId ?? 'all'}:${scope.period.from}:${scope.period.to}:${scope.cityId ?? ''}:${scope.os ?? ''}:${scope.device ?? ''}`,
  );
}

async function loadCached<T>(scope: AnalyticsScope, report: string, skipCache: boolean | undefined, loader: () => Promise<T>): Promise<T> {
  if (skipCache) return loader();
  return remember(cacheKey(scope, report), 60, loader);
}

async function metricSeries(scope: AnalyticsScope, keys: string[]) {
  const dim = dimSql(scope, { marketplace: 'marketplace_id', country: 'country_id', city: 'city_id' });
  const placeholders = keys.map(() => '?').join(', ');
  const extra: string[] = [];
  const extraParams: Array<string | number> = [];
  if (scope.os) {
    extra.push(`dimension_key = 'os' AND dimension_value = ?`);
    extraParams.push(scope.os);
  } else if (scope.device) {
    extra.push(`dimension_key = 'device' AND dimension_value = ?`);
    extraParams.push(scope.device);
  } else {
    extra.push(`dimension_key = ''`);
  }
  const rows = await queryRows<Row>(
    `SELECT metric_date, metric_key, SUM(value_count) AS c, SUM(value_sum) AS s, MAX(currency) AS currency
       FROM daily_metrics
      WHERE metric_key IN (${placeholders})
        AND metric_date BETWEEN ? AND ?
        AND ${dim.sql}
        AND ${extra.join(' AND ')}
      GROUP BY metric_date, metric_key
      ORDER BY metric_date`,
    [...keys, scope.period.from, scope.period.to, ...dim.params, ...extraParams],
  );
  return rows.map((row) => ({
    date: isoDay(row.metric_date),
    key: String(row.metric_key),
    count: Number(row.c ?? 0),
    sum: money(row.s),
    currency: (row.currency as string | null) ?? null,
  }));
}

async function metricTotal(scope: AnalyticsScope, key: string): Promise<{ count: number; sum: number; currency: string | null }> {
  const series = await metricSeries(scope, [key]);
  return {
    count: series.reduce((sum, row) => sum + row.count, 0),
    sum: series.reduce((sum, row) => sum + row.sum, 0),
    currency: series.find((row) => row.currency)?.currency ?? 'USD',
  };
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const escape = (value: unknown) => {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((key) => escape(row[key])).join(','))].join('\n');
}

async function maybeExport(
  auth: AuthPrincipal,
  scope: AnalyticsScope,
  report: string,
  rows: Array<Record<string, unknown>>,
  exported: boolean | undefined,
) {
  if (!exported) return undefined;
  if (!scope.canExport) return undefined;
  const csv = toCsv(rows);
  await recordAudit({
    action: 'analytics.export',
    entityType: 'analytics_report',
    entityId: report,
    actorType: auth.isStaff ? 'admin' : 'user',
    actorId: auth.userId,
    permissionCode: 'analytics.export',
    after: { report, period: scope.period, mode: scope.mode, rows: rows.length },
  });
  return { csv, filename: `analytics-${report}-${scope.period.from}-${scope.period.to}.csv`, rowCount: rows.length };
}

function sellerOwnerSql(scope: AnalyticsScope, alias = 'm'): { sql: string; params: number[] } {
  if (!scope.ownerUserIds || scope.ownerUserIds.length === 0) return { sql: '1 = 0', params: [] };
  return {
    sql: `${alias}.user_id IN (${scope.ownerUserIds.map(() => '?').join(', ')})`,
    params: scope.ownerUserIds,
  };
}

async function sellerTotals(scope: AnalyticsScope) {
  const owners = sellerOwnerSql(scope);
  const mp = scope.marketplaceId ? 'AND m.marketplace_id = ?' : '';
  const params: Array<string | number> = [...owners.params, scope.period.from, scope.period.to];
  if (scope.marketplaceId) params.push(scope.marketplaceId);
  return queryRows<Row>(
    `SELECT m.metric_date AS day,
            SUM(m.views) AS views,
            SUM(m.leads) AS leads,
            SUM(m.revenue) AS revenue,
            SUM(m.sold_listings) AS sold,
            MAX(m.currency) AS currency
       FROM seller_metrics_daily m
      WHERE ${owners.sql} AND m.metric_date BETWEEN ? AND ? ${mp}
      GROUP BY m.metric_date
      ORDER BY m.metric_date`,
    params,
  );
}

export async function getOverview(auth: AuthPrincipal, query: AnalyticsQuery) {
  const scope = await resolveAnalyticsScope(auth, query);
  const payload = await loadCached(scope, 'overview', query.export, async () => {
    if (isPlatformScope(scope)) {
      const [gmv, tx, signups, leads, views, growth] = await Promise.all([
        metricTotal(scope, 'sales.gmv'),
        metricTotal(scope, 'sales.transactions'),
        metricTotal(scope, 'users.signup'),
        metricTotal(scope, 'leads.created'),
        metricTotal(scope, 'listing.viewed'),
        queryRows<Row>(
          `SELECT metric_date, SUM(dau) AS dau, SUM(wau) AS wau, SUM(mau) AS mau, SUM(new_signups) AS signups
             FROM user_growth_daily
            WHERE metric_date BETWEEN ? AND ?
              AND (marketplace_id = 0 OR ? IS NULL OR marketplace_id = ?)
            GROUP BY metric_date ORDER BY metric_date`,
          [scope.period.from, scope.period.to, scope.marketplaceId, scope.marketplaceId],
        ),
      ]);
      const latest = growth[growth.length - 1];
      const dau = Number(latest?.dau ?? 0);
      const mau = Number(latest?.mau ?? 0);
      return {
        scope: { mode: scope.mode, persona: scope.persona, period: scope.period, marketplaceId: scope.marketplaceId },
        cards: {
          sales: gmv.sum,
          transactions: tx.count,
          users: signups.count,
          leads: leads.count,
          views: views.count,
          dau,
          wau: Number(latest?.wau ?? 0),
          mau,
          dauMau: mau > 0 ? Number((dau / mau).toFixed(4)) : 0,
        },
        series: {
          sales: (await metricSeries(scope, ['sales.gmv'])).map((row) => ({ date: row.date, value: row.sum })),
          users: growth.map((row) => ({ date: isoDay(row.metric_date), value: Number(row.signups ?? 0) })),
          dau: growth.map((row) => ({ date: isoDay(row.metric_date), value: Number(row.dau ?? 0) })),
        },
      };
    }

    const series = await sellerTotals(scope);
    const views = series.reduce((sum, row) => sum + Number(row.views ?? 0), 0);
    const leads = series.reduce((sum, row) => sum + Number(row.leads ?? 0), 0);
    const revenue = series.reduce((sum, row) => sum + money(row.revenue), 0);
    return {
      scope: { mode: scope.mode, persona: scope.persona, period: scope.period, marketplaceId: scope.marketplaceId },
      cards: {
        sales: revenue,
        transactions: series.reduce((sum, row) => sum + Number(row.sold ?? 0), 0),
        users: scope.ownerUserIds?.length ?? 1,
        leads,
        views,
        dau: 0,
        wau: 0,
        mau: 0,
        dauMau: 0,
        conversionRate: views > 0 ? Number((leads / views).toFixed(4)) : 0,
      },
      series: {
        sales: series.map((row) => ({ date: isoDay(row.day), value: money(row.revenue) })),
        users: [],
        dau: series.map((row) => ({ date: isoDay(row.day), value: Number(row.views ?? 0) })),
      },
    };
  });
  return { ...payload, export: await maybeExport(auth, scope, 'overview', [payload.cards], query.export) };
}

export async function getSales(auth: AuthPrincipal, query: AnalyticsQuery) {
  const scope = await resolveAnalyticsScope(auth, query);
  const payload = await loadCached(scope, 'sales', query.export, async () => {
    if (isPlatformScope(scope)) {
      const gmv = await metricSeries(scope, ['sales.gmv']);
      const tx = await metricSeries(scope, ['sales.transactions']);
      const refunds = await metricTotal(scope, 'sales.refunds');
      const gross = gmv.reduce((sum, row) => sum + row.sum, 0);
      const transactions = tx.reduce((sum, row) => sum + row.count, 0);
      return {
        period: scope.period,
        grossSales: gross,
        netSales: gross - refunds.sum,
        transactions,
        averageSalePrice: transactions > 0 ? gross / transactions : 0,
        refunds: refunds.sum,
        commission: 0,
        taxes: 0,
        series: gmv.map((row) => ({ date: row.date, gross: row.sum, transactions: tx.find((item) => item.date === row.date)?.count ?? 0 })),
        byKind: await dimensionBreakdown(scope, 'sales.gmv', 'kind'),
      };
    }
    const series = await sellerTotals(scope);
    const gross = series.reduce((sum, row) => sum + money(row.revenue), 0);
    return {
      period: scope.period,
      grossSales: gross,
      netSales: gross,
      transactions: series.reduce((sum, row) => sum + Number(row.sold ?? 0), 0),
      averageSalePrice: 0,
      refunds: 0,
      commission: 0,
      taxes: 0,
      series: series.map((row) => ({ date: isoDay(row.day), gross: money(row.revenue), transactions: Number(row.sold ?? 0) })),
      byKind: [],
    };
  });
  return { ...payload, export: await maybeExport(auth, scope, 'sales', payload.series, query.export) };
}

async function dimensionBreakdown(scope: AnalyticsScope, key: string, dimensionKey: string) {
  const dim = dimSql(scope, { marketplace: 'marketplace_id', country: 'country_id', city: 'city_id' });
  const rows = await queryRows<Row>(
    `SELECT dimension_value AS label, SUM(value_count) AS c, SUM(value_sum) AS s
       FROM daily_metrics
      WHERE metric_key = ? AND dimension_key = ? AND metric_date BETWEEN ? AND ? AND ${dim.sql}
      GROUP BY dimension_value ORDER BY s DESC, c DESC LIMIT 12`,
    [key, dimensionKey, scope.period.from, scope.period.to, ...dim.params],
  );
  return rows.map((row) => ({ label: String(row.label || 'unknown'), count: Number(row.c ?? 0), sum: money(row.s) }));
}

export async function getRentals(auth: AuthPrincipal, query: AnalyticsQuery) {
  const scope = await resolveAnalyticsScope(auth, query);
  const payload = await loadCached(scope, 'rentals', query.export, async () => {
    const revenue = await metricTotal(scope, 'rentals.revenue');
    const bookings = await metricTotal(scope, 'rentals.bookings');
    const series = await metricSeries(scope, ['rentals.revenue', 'rentals.bookings']);
    return {
      period: scope.period,
      rentalRevenue: revenue.sum,
      bookings: bookings.count,
      averageRentalPrice: bookings.count > 0 ? revenue.sum / bookings.count : 0,
      series: series.filter((row) => row.key === 'rentals.revenue').map((row) => ({ date: row.date, revenue: row.sum })),
    };
  });
  return { ...payload, export: await maybeExport(auth, scope, 'rentals', payload.series, query.export) };
}

export async function getRevenue(auth: AuthPrincipal, query: AnalyticsQuery) {
  const scope = await resolveAnalyticsScope(auth, query);
  const payload = await loadCached(scope, 'revenue', query.export, async () => {
    const dim = dimSql(scope, { marketplace: 'marketplace_id', country: 'country_id' });
    const rows = await queryRows<Row>(
      `SELECT revenue_date, source, SUM(gross_amount) AS gross, SUM(net_amount) AS net, SUM(tax_amount) AS tax,
              SUM(refund_amount) AS refunds, SUM(transaction_count) AS tx, MAX(currency) AS currency
         FROM revenue_daily
        WHERE revenue_date BETWEEN ? AND ? AND ${dim.sql}
        GROUP BY revenue_date, source
        ORDER BY revenue_date`,
      [scope.period.from, scope.period.to, ...dim.params],
    );
    const bySource: Record<string, number> = {};
    for (const row of rows) {
      bySource[String(row.source)] = (bySource[String(row.source)] ?? 0) + money(row.net);
    }
    return {
      period: scope.period,
      grossRevenue: rows.reduce((sum, row) => sum + money(row.gross), 0),
      netRevenue: rows.reduce((sum, row) => sum + money(row.net), 0),
      platformRevenue: rows.reduce((sum, row) => sum + money(row.net), 0),
      taxes: rows.reduce((sum, row) => sum + money(row.tax), 0),
      refunds: rows.reduce((sum, row) => sum + money(row.refunds), 0),
      bySource,
      series: rows.map((row) => ({
        date: isoDay(row.revenue_date),
        source: String(row.source),
        net: money(row.net),
        gross: money(row.gross),
      })),
    };
  });
  return { ...payload, export: await maybeExport(auth, scope, 'revenue', payload.series, query.export) };
}

async function geoBreakdown(scope: AnalyticsScope, group: 'country_id' | 'city_id') {
  const dim = dimSql(scope, { marketplace: 'marketplace_id', country: 'country_id', city: 'city_id' });
  const keys = ['sales.gmv', 'leads.created', 'listings.created', 'users.signup', 'rentals.revenue'];
  const rows = await queryRows<Row>(
    `SELECT ${group} AS geo_id, metric_key, SUM(value_count) AS c, SUM(value_sum) AS s
       FROM daily_metrics
      WHERE metric_key IN (${keys.map(() => '?').join(', ')})
        AND metric_date BETWEEN ? AND ? AND dimension_key = '' AND ${group} <> 0 AND ${dim.sql}
      GROUP BY ${group}, metric_key`,
    [...keys, scope.period.from, scope.period.to, ...dim.params],
  );
  type GeoAgg = { id: number; sales: number; leads: number; listings: number; users: number; rentals: number };
  const byId = new Map<number, GeoAgg>();
  for (const row of rows) {
    const id = Number(row.geo_id);
    const current = byId.get(id) ?? { id, sales: 0, leads: 0, listings: 0, users: 0, rentals: 0 };
    const key = String(row.metric_key);
    if (key === 'sales.gmv') current.sales += money(row.s);
    if (key === 'leads.created') current.leads += Number(row.c);
    if (key === 'listings.created') current.listings += Number(row.c);
    if (key === 'users.signup') current.users += Number(row.c);
    if (key === 'rentals.revenue') current.rentals += money(row.s);
    byId.set(id, current);
  }
  const ids = [...byId.keys()];
  if (ids.length === 0) return [];
  const table = group === 'country_id' ? 'countries' : 'cities';
  const names = await queryRows<Row>(
    `SELECT id, name FROM ${table} WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids,
  );
  const nameMap = new Map(names.map((row) => [Number(row.id), String(row.name)]));
  return [...byId.values()]
    .map((row) => ({
      id: row.id,
      name: nameMap.get(row.id) ?? `id:${row.id}`,
      sales: row.sales,
      rentals: row.rentals,
      revenue: row.sales + row.rentals,
      leads: row.leads,
      listings: row.listings,
      users: row.users,
      conversion: row.listings > 0 ? Number((row.leads / row.listings).toFixed(4)) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 25);
}

export async function getCountry(auth: AuthPrincipal, query: AnalyticsQuery) {
  const scope = await resolveAnalyticsScope(auth, query);
  const items = await geoBreakdown(scope, 'country_id');
  return { period: scope.period, items, export: await maybeExport(auth, scope, 'country', items, query.export) };
}

export async function getCity(auth: AuthPrincipal, query: AnalyticsQuery) {
  const scope = await resolveAnalyticsScope(auth, query);
  const items = await geoBreakdown(scope, 'city_id');
  return { period: scope.period, items, export: await maybeExport(auth, scope, 'city', items, query.export) };
}

export async function getDevice(auth: AuthPrincipal, query: AnalyticsQuery) {
  const scope = await resolveAnalyticsScope(auth, query);
  const dim = dimSql(scope, { marketplace: 'marketplace_id', country: 'country_id' });
  const rows = await queryRows<Row>(
    `SELECT dimension_value AS device, SUM(value_count) AS c
       FROM daily_metrics
      WHERE dimension_key = 'device' AND metric_date BETWEEN ? AND ? AND ${dim.sql}
      GROUP BY dimension_value ORDER BY c DESC`,
    [scope.period.from, scope.period.to, ...dim.params],
  );
  const items = rows.map((row) => ({ device: String(row.device || 'other'), users: Number(row.c ?? 0) }));
  return { period: scope.period, items, export: await maybeExport(auth, scope, 'device', items, query.export) };
}

export async function getOs(auth: AuthPrincipal, query: AnalyticsQuery) {
  const scope = await resolveAnalyticsScope(auth, query);
  const dim = dimSql(scope, { marketplace: 'marketplace_id', country: 'country_id' });
  const rows = await queryRows<Row>(
    `SELECT dimension_value AS os, SUM(value_count) AS c
       FROM daily_metrics
      WHERE dimension_key = 'os' AND metric_date BETWEEN ? AND ? AND ${dim.sql}
      GROUP BY dimension_value ORDER BY c DESC`,
    [scope.period.from, scope.period.to, ...dim.params],
  );
  const items = rows.map((row) => ({ os: String(row.os || 'unknown'), users: Number(row.c ?? 0) }));
  return { period: scope.period, items, export: await maybeExport(auth, scope, 'os', items, query.export) };
}

export async function getTraffic(auth: AuthPrincipal, query: AnalyticsQuery) {
  const scope = await resolveAnalyticsScope(auth, query);
  const dim = dimSql(scope, { marketplace: 'marketplace_id', country: 'country_id', city: 'city_id' });
  const sourceFilter = scope.source ? 'AND source = ?' : '';
  const params: Array<string | number> = [scope.period.from, scope.period.to, ...dim.params];
  if (scope.source) params.push(scope.source);
  const rows = await queryRows<Row>(
    `SELECT metric_date, source, SUM(sessions) AS sessions, SUM(users) AS users, SUM(page_views) AS page_views
       FROM traffic_daily
      WHERE metric_date BETWEEN ? AND ? AND ${dim.sql} ${sourceFilter}
      GROUP BY metric_date, source ORDER BY metric_date`,
    params,
  );
  const payload = {
    period: scope.period,
    totals: {
      sessions: rows.reduce((sum, row) => sum + Number(row.sessions ?? 0), 0),
      users: rows.reduce((sum, row) => sum + Number(row.users ?? 0), 0),
      pageViews: rows.reduce((sum, row) => sum + Number(row.page_views ?? 0), 0),
    },
    series: rows.map((row) => ({
      date: isoDay(row.metric_date),
      source: String(row.source),
      sessions: Number(row.sessions ?? 0),
      users: Number(row.users ?? 0),
    })),
  };
  return { ...payload, export: await maybeExport(auth, scope, 'traffic', payload.series, query.export) };
}

export async function getConversion(auth: AuthPrincipal, query: AnalyticsQuery) {
  const scope = await resolveAnalyticsScope(auth, query);
  const funnel = scope.funnel ?? (scope.marketplaceId === 2 ? 'property.visitor_to_rental' : scope.marketplaceId === 3 ? 'vehicles.visitor_to_sale' : scope.marketplaceId === 1 ? 'gold.visitor_to_sale' : 'platform.visitor_to_sale');
  const rows = await queryRows<Row>(
    `SELECT step_index, step_name, SUM(user_count) AS users,
            AVG(conversion_from_previous) AS from_prev, AVG(conversion_from_start) AS from_start
       FROM funnel_daily
      WHERE funnel_code = ? AND metric_date BETWEEN ? AND ?
      GROUP BY step_index, step_name
      ORDER BY step_index`,
    [funnel, scope.period.from, scope.period.to],
  );
  const steps = rows.map((row) => ({
    index: Number(row.step_index),
    name: String(row.step_name),
    users: Number(row.users ?? 0),
    conversionFromPrevious: Number(row.from_prev ?? 0),
    conversionFromStart: Number(row.from_start ?? 0),
  }));
  return { period: scope.period, funnel, steps, export: await maybeExport(auth, scope, 'conversion', steps, query.export) };
}

export async function getRetention(auth: AuthPrincipal, query: AnalyticsQuery) {
  const scope = await resolveAnalyticsScope(auth, query);
  const dim = dimSql(scope, { marketplace: 'marketplace_id', country: 'country_id' });
  const rows = await queryRows<Row>(
    `SELECT period_number, SUM(cohort_size) AS size, SUM(retained_count) AS retained, AVG(retention_pct) AS pct
       FROM retention_cohorts
      WHERE cohort_kind = 'signup' AND period_unit = 'day' AND ${dim.sql}
        AND cohort_date BETWEEN DATE_SUB(?, INTERVAL 90 DAY) AND ?
        AND period_number IN (${RETENTION_DAYS.map(() => '?').join(', ')})
      GROUP BY period_number ORDER BY period_number`,
    [...dim.params, scope.period.to, scope.period.to, ...RETENTION_DAYS],
  );
  const points = rows.map((row) => ({
    day: Number(row.period_number),
    cohortSize: Number(row.size ?? 0),
    retained: Number(row.retained ?? 0),
    retentionPct: Number(row.pct ?? 0),
  }));
  return { period: scope.period, points, export: await maybeExport(auth, scope, 'retention', points, query.export) };
}

export async function getUserGrowth(auth: AuthPrincipal, query: AnalyticsQuery) {
  const scope = await resolveAnalyticsScope(auth, query);
  const rows = await queryRows<Row>(
    `SELECT metric_date, SUM(new_signups) AS signups, SUM(activated_users) AS verified,
            SUM(dau) AS dau, SUM(wau) AS wau, SUM(mau) AS mau, SUM(guest_sessions) AS guests
       FROM user_growth_daily
      WHERE metric_date BETWEEN ? AND ?
        AND (marketplace_id = 0 OR ? IS NULL OR marketplace_id = ?)
      GROUP BY metric_date ORDER BY metric_date`,
    [scope.period.from, scope.period.to, scope.marketplaceId, scope.marketplaceId],
  );
  const series = rows.map((row) => ({
    date: isoDay(row.metric_date),
    newUsers: Number(row.signups ?? 0),
    verifiedUsers: Number(row.verified ?? 0),
    dau: Number(row.dau ?? 0),
    wau: Number(row.wau ?? 0),
    mau: Number(row.mau ?? 0),
    guests: Number(row.guests ?? 0),
  }));
  const last = series[series.length - 1];
  return {
    period: scope.period,
    totals: {
      newUsers: series.reduce((sum, row) => sum + row.newUsers, 0),
      verifiedUsers: series.reduce((sum, row) => sum + row.verifiedUsers, 0),
      dau: last?.dau ?? 0,
      wau: last?.wau ?? 0,
      mau: last?.mau ?? 0,
      dauMau: last && last.mau > 0 ? Number((last.dau / last.mau).toFixed(4)) : 0,
    },
    series,
    export: await maybeExport(auth, scope, 'user-growth', series, query.export),
  };
}

export async function getHeatmaps(auth: AuthPrincipal, query: AnalyticsQuery) {
  const scope = await resolveAnalyticsScope(auth, query);
  const kind = scope.heatmap ?? 'geo';
  if (kind === 'geo' || kind === 'sales' || kind === 'lead' || kind === 'listing' || kind === 'search') {
    const items = await geoBreakdown(scope, 'city_id');
    const metric = kind === 'sales' ? 'sales' : kind === 'lead' ? 'leads' : kind === 'listing' ? 'listings' : 'users';
    return {
      period: scope.period,
      kind,
      privacy: 'City-level aggregates only. Precise GPS is not stored.',
      points: items.map((item) => ({ id: item.id, name: item.name, weight: Number(item[metric as keyof typeof item] ?? 0) })),
    };
  }
  const dim = dimSql(scope, { marketplace: 'marketplace_id', country: 'country_id' });
  const expr = kind === 'dow' ? 'DAYOFWEEK(created_at)' : 'HOUR(created_at)';
  const rows = await queryRows<Row>(
    `SELECT ${expr} AS bucket, COUNT(*) AS c
       FROM analytics_events
      WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
        AND ${dim.sql.replaceAll('marketplace_id', 'marketplace_id').replaceAll('country_id', 'country_id').replaceAll('city_id', 'city_id')}
      GROUP BY bucket ORDER BY bucket`,
    [scope.period.from, scope.period.to, ...dim.params],
  );
  return {
    period: scope.period,
    kind,
    privacy: 'Aggregated clock buckets. No user identities.',
    points: rows.map((row) => ({ id: Number(row.bucket), name: String(row.bucket), weight: Number(row.c ?? 0) })),
  };
}

export async function getAiInsights(auth: AuthPrincipal, query: AnalyticsQuery) {
  const scope = await resolveAnalyticsScope(auth, query);
  const rows = await queryRows<Row>(
    `SELECT uuid, scope, marketplace_id, period_start, period_end, headline, body, insight_kind, severity,
            metrics, confidence, generated_at
       FROM ai_insights
      WHERE was_dismissed = 0 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        AND (? IS NULL OR marketplace_id IS NULL OR marketplace_id = ?)
      ORDER BY FIELD(severity, 'critical','important','notable','info'), generated_at DESC
      LIMIT 20`,
    [scope.marketplaceId, scope.marketplaceId],
  );
  const items = rows.map((row) => {
    const metrics = typeof row.metrics === 'string' ? JSON.parse(row.metrics) : row.metrics;
    return {
      uuid: String(row.uuid),
      insight: String(row.headline),
      body: (row.body as string | null) ?? null,
      kind: String(row.insight_kind),
      severity: String(row.severity),
      period: { start: isoDay(row.period_start), end: isoDay(row.period_end) },
      comparisonPeriod: metrics && typeof metrics === 'object' ? (metrics as { comparisonPeriod?: unknown }).comparisonPeriod ?? null : null,
      supportingMetrics: metrics,
      confidence: row.confidence == null ? null : Number(row.confidence),
      evidence: (row.body as string | null) ?? null,
    };
  });
  return { period: scope.period, items };
}

export async function getFilters(auth: AuthPrincipal, query: AnalyticsQuery) {
  const scope = await resolveAnalyticsScope(auth, query);
  return {
    period: scope.period,
    mode: scope.mode,
    persona: scope.persona,
    canExport: scope.canExport,
    marketplaces: [
      { code: 'gold', allowed: !scope.allowedMarketplaceIds || scope.allowedMarketplaceIds.includes(1) },
      { code: 'property', allowed: !scope.allowedMarketplaceIds || scope.allowedMarketplaceIds.includes(2) },
      { code: 'vehicles', allowed: !scope.allowedMarketplaceIds || scope.allowedMarketplaceIds.includes(3) },
    ],
    companies: scope.businessIds,
    sellerFilter: scope.mode !== 'own',
    countryFilter: Boolean(scope.countryIds),
    device: ['phone', 'tablet', 'desktop', 'windows', 'macos', 'linux', 'web', 'android', 'ios'],
  };
}

/** Used by seller dashboard analytics tab so we do not fork a second engine. */
export async function sellerAnalyticsFacade(auth: AuthPrincipal, query: AnalyticsQuery) {
  const [overview, sales] = await Promise.all([getOverview(auth, query), getSales(auth, query)]);
  const scope = await resolveAnalyticsScope(auth, query);
  const listing = listingScopeSql(
    {
      userId: auth.userId,
      persona: scope.persona === 'admin' ? 'individual' : scope.persona,
      roles: auth.roles,
      businessIds: scope.businessIds,
      teamIds: [],
      teamMemberIds: scope.ownerUserIds ?? [auth.userId],
      marketplaceId: scope.marketplaceId,
      allowedMarketplaceIds: scope.allowedMarketplaceIds,
      countryIds: scope.countryIds,
      filterBusinessId: scope.businessIds.length === 1 ? scope.businessIds[0]! : null,
      period: scope.period,
    },
    'l',
  );
  const top = await queryRows<Row>(
    `SELECT l.id, l.uuid, l.title, mp.code AS marketplace,
            COALESCE(SUM(m.views), 0) AS views, COALESCE(SUM(m.leads), 0) AS leads
       FROM listings l
       JOIN marketplaces mp ON mp.id = l.marketplace_id
       LEFT JOIN listing_metrics_daily m ON m.listing_id = l.id AND m.metric_date BETWEEN ? AND ?
      WHERE l.deleted_at IS NULL AND ${listing.sql}
      GROUP BY l.id, l.uuid, l.title, mp.code
      ORDER BY views DESC
      LIMIT 8`,
    [scope.period.from, scope.period.to, ...listing.params],
  );
  return {
    ...overview.cards,
    period: scope.period,
    sales,
    topListings: top.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      title: String(row.title),
      marketplace: String(row.marketplace),
      views: Number(row.views ?? 0),
      leads: Number(row.leads ?? 0),
    })),
  };
}
