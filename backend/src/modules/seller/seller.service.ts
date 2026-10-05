import { queryCount, queryOne, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { remember, cacheKeys } from '../../config/cache';
import { recordAudit } from '../../middleware/audit';
import { listConversations } from '../chat/chat.service';
import { listCampaigns } from '../ads/ads.service';
import { getCurrentSubscription, listInvoices } from '../subscriptions/subscriptions.service';
import type { AuthPrincipal } from '../../types/express';
import type { DashboardQuery } from './seller.schema';
import {
  canViewCompanyFinance,
  listingScopeSql,
  resolveSellerScope,
  salesLeadScopeSql,
  spendScopeSql,
  vehicleLeadScopeSql,
  type SellerScope,
} from './seller.scope';

function money(value: unknown): number {
  return toNumber(value) ?? 0;
}

function isoDay(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? '');
  return text.length >= 10 ? text.slice(0, 10) : text;
}

function isoStamp(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function scopedListings(scope: SellerScope, alias = 'l') {
  return listingScopeSql(scope, alias);
}

async function header(auth: AuthPrincipal, scope: SellerScope) {
  const profile = await queryOne<Row>(
    `SELECT p.display_name, p.avatar_url, u.account_type, ts.band AS trust_band, ts.score AS trust_score
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN trust_scores ts ON ts.user_id = u.id
      WHERE u.id = ?
      LIMIT 1`,
    [auth.userId],
  );
  const verification = await queryOne<Row>(
    `SELECT status, doc_type FROM verification_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    [auth.userId],
  );

  const businesses = scope.businessIds.length
    ? await queryRows<Row>(
        `SELECT id, kind, legal_name, trade_name, status, verified_at
           FROM business_profiles WHERE id IN (${scope.businessIds.map(() => '?').join(', ')})`,
        scope.businessIds,
      )
    : [];

  const subscription = await getCurrentSubscription(auth.userId).catch(() => null);

  return {
    displayName: (profile?.display_name as string | null) ?? null,
    avatarUrl: (profile?.avatar_url as string | null) ?? null,
    accountType: (profile?.account_type as string | null) ?? null,
    persona: scope.persona,
    roles: scope.roles,
    trustBand: (profile?.trust_band as string | null) ?? null,
    trustScore: profile?.trust_score == null ? null : Number(profile.trust_score),
    verificationStatus: (verification?.status as string | null) ?? null,
    verificationKind: (verification?.doc_type as string | null) ?? null,
    subscription: subscription?.subscription
      ? {
          planCode: subscription.subscription.planCode,
          planName: subscription.subscription.planName,
          status: subscription.subscription.status,
        }
      : null,
    companies: businesses.map((row) => ({
      id: Number(row.id),
      kind: String(row.kind),
      name: (row.trade_name as string | null) ?? String(row.legal_name),
      status: String(row.status),
      verified: row.verified_at != null,
    })),
    marketplaceId: scope.marketplaceId,
    period: scope.period,
  };
}

async function gmvTotals(scope: SellerScope) {
  const listing = scopedListings(scope);
  const period = scope.period;
  return queryOne<Row>(
    `SELECT COALESCE(SUM(o.total_amount), 0) AS gross,
            COALESCE(SUM(o.tax_amount), 0) AS tax,
            COUNT(*) AS transactions,
            MAX(o.currency) AS currency
       FROM orders o
       JOIN listings l ON o.reference_type = 'listing' AND o.reference_id = l.id
      WHERE o.status IN ('paid','partially_refunded')
        AND o.kind IN ('listing_purchase','rental_payment','booking_payment','parts_purchase','escrow')
        AND DATE(COALESCE(o.paid_at, o.created_at)) BETWEEN ? AND ?
        AND ${listing.sql}`,
    [period.from, period.to, ...listing.params],
  );
}

async function spendTotals(scope: SellerScope) {
  const spend = spendScopeSql(scope);
  const period = scope.period;
  const rows = await queryRows<Row>(
    `SELECT o.kind, COALESCE(SUM(o.total_amount), 0) AS amount
       FROM orders o
      WHERE o.status IN ('paid','partially_refunded')
        AND o.kind IN ('subscription','promotion','advertisement')
        AND ${spend.sql}
        AND DATE(COALESCE(o.paid_at, o.created_at)) BETWEEN ? AND ?
      GROUP BY o.kind`,
    [...spend.params, period.from, period.to],
  );
  const amount = (kind: string) => money(rows.find((row) => String(row.kind) === kind)?.amount);
  return {
    advertisement: amount('advertisement'),
    subscription: amount('subscription'),
    promotion: amount('promotion'),
    rows,
  };
}

async function countLeads(scope: SellerScope): Promise<number> {
  const listing = scopedListings(scope);
  const period = scope.period;
  const listingLeads = await queryCount(
    `SELECT COUNT(*) FROM listing_leads ll
       JOIN listings l ON l.id = ll.listing_id
      WHERE ${listing.sql}
        AND ll.created_at >= ? AND ll.created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [...listing.params, period.from, period.to],
  );
  const vehicle = vehicleLeadScopeSql(scope);
  const vehicleLeads = await queryCount(
    `SELECT COUNT(*) FROM vehicle_leads vl
       LEFT JOIN listings l ON l.id = vl.listing_id
      WHERE ${vehicle.sql}
        AND vl.created_at >= ? AND vl.created_at < DATE_ADD(?, INTERVAL 1 DAY)
        AND (? IS NULL OR l.marketplace_id = ?)`,
    [...vehicle.params, period.from, period.to, scope.marketplaceId, scope.marketplaceId],
  );
  const sales = salesLeadScopeSql(scope);
  const salesLeads = await queryCount(
    `SELECT COUNT(*) FROM sales_leads sl
      WHERE ${sales.sql}
        AND sl.created_at >= ? AND sl.created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [...sales.params, period.from, period.to],
  );
  return listingLeads + vehicleLeads + salesLeads;
}

export async function getDashboardSummary(auth: AuthPrincipal, query: DashboardQuery) {
  const scope = await resolveSellerScope(auth, query);
  const cacheKey = cacheKeys.sellerDashboard(
    auth.userId,
    `${scope.persona}:${scope.marketplaceId ?? 'all'}:${scope.filterBusinessId ?? 'co'}:${scope.period.from}:${scope.period.to}`,
  );
  return remember(cacheKey, 30, async () => {
    const listing = scopedListings(scope);
    const period = scope.period;

    const listingStats = await queryOne<Row>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft,
              SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
              SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) AS pendingReview,
              SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
              SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired,
              SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) AS sold,
              SUM(CASE WHEN status = 'rented' THEN 1 ELSE 0 END) AS rented,
              SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived,
              SUM(CASE WHEN is_featured = 1 THEN 1 ELSE 0 END) AS featured,
              SUM(CASE WHEN is_boosted = 1 THEN 1 ELSE 0 END) AS boosted,
              COALESCE(SUM(view_count), 0) AS lifetimeViews,
              COALESCE(SUM(favorite_count), 0) AS favorites,
              COALESCE(SUM(renewal_count), 0) AS renewed
         FROM listings l
        WHERE l.deleted_at IS NULL AND ${listing.sql}`,
      listing.params,
    );

    const metrics = await queryOne<Row>(
      `SELECT COALESCE(SUM(m.views), 0) AS views,
              COALESCE(SUM(m.unique_views), 0) AS uniqueViews,
              COALESCE(SUM(m.impressions), 0) AS impressions,
              COALESCE(SUM(m.leads), 0) AS metricLeads,
              COALESCE(SUM(m.chats), 0) AS chats,
              COALESCE(SUM(m.calls), 0) AS calls,
              COALESCE(SUM(m.shares), 0) AS shares
         FROM listing_metrics_daily m
         JOIN listings l ON l.id = m.listing_id
        WHERE l.deleted_at IS NULL AND ${listing.sql}
          AND m.metric_date BETWEEN ? AND ?`,
      [...listing.params, period.from, period.to],
    );

    const gmv = await gmvTotals(scope);
    const spend = await spendTotals(scope);
    const leads = await countLeads(scope);
    const unread = await queryCount(
      `SELECT COALESCE(SUM(unread_count), 0) FROM conversation_participants WHERE user_id = ? AND is_archived = 0`,
      [auth.userId],
    );
    const followers = await queryCount(`SELECT COUNT(*) FROM user_follows WHERE followee_id = ?`, [auth.userId]);
    const newFollowers = await queryCount(
      `SELECT COUNT(*) FROM user_follows WHERE followee_id = ? AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
      [auth.userId, period.from, period.to],
    );

    const periodViews = Number(metrics?.views ?? 0);

    return {
      header: await header(auth, scope),
      cards: {
        revenue: money(gmv?.gross),
        spend: spend.advertisement + spend.subscription + spend.promotion,
        views: periodViews || Number(listingStats?.lifetimeViews ?? 0),
        uniqueViews: Number(metrics?.uniqueViews ?? 0),
        leads,
        messages: unread,
        followers,
        newFollowers,
        listings: Number(listingStats?.total ?? 0),
      },
      listings: {
        total: Number(listingStats?.total ?? 0),
        draft: Number(listingStats?.draft ?? 0),
        published: Number(listingStats?.published ?? 0),
        pendingReview: Number(listingStats?.pendingReview ?? 0),
        rejected: Number(listingStats?.rejected ?? 0),
        expired: Number(listingStats?.expired ?? 0),
        sold: Number(listingStats?.sold ?? 0),
        rented: Number(listingStats?.rented ?? 0),
        archived: Number(listingStats?.archived ?? 0),
        featured: Number(listingStats?.featured ?? 0),
        boosted: Number(listingStats?.boosted ?? 0),
        renewed: Number(listingStats?.renewed ?? 0),
      },
      engagement: {
        impressions: Number(metrics?.impressions ?? 0),
        chats: Number(metrics?.chats ?? 0),
        calls: Number(metrics?.calls ?? 0),
        shares: Number(metrics?.shares ?? 0),
        favorites: Number(listingStats?.favorites ?? 0),
      },
    };
  });
}

export async function getDashboardRevenue(auth: AuthPrincipal, query: DashboardQuery) {
  const scope = await resolveSellerScope(auth, query);
  const listing = scopedListings(scope);
  const period = scope.period;
  const gmvWhere = `o.status IN ('paid','partially_refunded')
      AND o.kind IN ('listing_purchase','rental_payment','booking_payment','parts_purchase','escrow')
      AND DATE(COALESCE(o.paid_at, o.created_at)) BETWEEN ? AND ?
      AND ${listing.sql}`;

  const gmv = await gmvTotals(scope);
  const byKind = await queryRows<Row>(
    `SELECT o.kind, COALESCE(SUM(o.total_amount), 0) AS amount, COUNT(*) AS n
       FROM orders o
       JOIN listings l ON o.reference_type = 'listing' AND o.reference_id = l.id
      WHERE ${gmvWhere}
      GROUP BY o.kind`,
    [period.from, period.to, ...listing.params],
  );
  const byMarketplace = await queryRows<Row>(
    `SELECT mp.code AS marketplace, COALESCE(SUM(o.total_amount), 0) AS amount
       FROM orders o
       JOIN listings l ON o.reference_type = 'listing' AND o.reference_id = l.id
       JOIN marketplaces mp ON mp.id = l.marketplace_id
      WHERE ${gmvWhere}
      GROUP BY mp.code`,
    [period.from, period.to, ...listing.params],
  );
  const refunds = await queryOne<Row>(
    `SELECT COALESCE(SUM(r.amount), 0) AS amount
       FROM refunds r
       JOIN orders o ON o.id = r.order_id
       JOIN listings l ON o.reference_type = 'listing' AND o.reference_id = l.id
      WHERE r.status = 'succeeded' AND ${listing.sql}
        AND DATE(COALESCE(r.processed_at, r.created_at)) BETWEEN ? AND ?`,
    [...listing.params, period.from, period.to],
  );
  const spend = await spendTotals(scope);
  const gross = money(gmv?.gross);
  const refundAmount = money(refunds?.amount);
  const fees = spend.advertisement + spend.subscription + spend.promotion;

  const payload = {
    period,
    currency: (gmv?.currency as string | null) ?? 'USD',
    grossSales: gross,
    netSales: gross - refundAmount,
    taxes: money(gmv?.tax),
    refunds: refundAmount,
    advertisingSpend: spend.advertisement,
    subscriptionCost: spend.subscription,
    promotionCost: spend.promotion,
    platformFees: fees,
    commission: 0,
    netRevenue: gross - refundAmount - fees,
    transactions: Number(gmv?.transactions ?? 0),
    byKind: byKind.map((row) => ({
      kind: String(row.kind),
      amount: money(row.amount),
      count: Number(row.n ?? 0),
    })),
    byMarketplace: byMarketplace.map((row) => ({
      marketplace: String(row.marketplace),
      amount: money(row.amount),
    })),
    rental: {
      rentalRevenue: money(byKind.find((row) => String(row.kind) === 'rental_payment')?.amount),
      bookingRevenue: money(byKind.find((row) => String(row.kind) === 'booking_payment')?.amount),
    },
  };

  if (query.export) {
    await recordAudit({
      action: 'seller.revenue.export',
      entityType: 'seller_dashboard',
      entityId: auth.userId,
      actorType: 'user',
      actorId: auth.userId,
      permissionCode: 'analytics.export',
      after: { period, marketplaceId: scope.marketplaceId },
    });
  }
  return payload;
}

export async function getDashboardViews(auth: AuthPrincipal, query: DashboardQuery) {
  const scope = await resolveSellerScope(auth, query);
  const listing = scopedListings(scope);
  const period = scope.period;
  const totals = await queryOne<Row>(
    `SELECT COALESCE(SUM(m.views), 0) AS views,
            COALESCE(SUM(m.unique_views), 0) AS uniqueViews,
            COALESCE(SUM(m.impressions), 0) AS impressions,
            COALESCE(SUM(m.search_appearances), 0) AS searchImpressions,
            COALESCE(SUM(m.shares), 0) AS shares
       FROM listing_metrics_daily m
       JOIN listings l ON l.id = m.listing_id
      WHERE l.deleted_at IS NULL AND ${listing.sql}
        AND m.metric_date BETWEEN ? AND ?`,
    [...listing.params, period.from, period.to],
  );
  const series = await queryRows<Row>(
    `SELECT m.metric_date AS day, COALESCE(SUM(m.views), 0) AS views, COALESCE(SUM(m.unique_views), 0) AS uniqueViews
       FROM listing_metrics_daily m
       JOIN listings l ON l.id = m.listing_id
      WHERE l.deleted_at IS NULL AND ${listing.sql}
        AND m.metric_date BETWEEN ? AND ?
      GROUP BY m.metric_date
      ORDER BY m.metric_date`,
    [...listing.params, period.from, period.to],
  );
  return {
    period,
    totalViews: Number(totals?.views ?? 0),
    uniqueVisitors: Number(totals?.uniqueViews ?? 0),
    listingViews: Number(totals?.views ?? 0),
    searchImpressions: Number(totals?.searchImpressions ?? 0),
    impressions: Number(totals?.impressions ?? 0),
    profileViews: 0,
    companyViews: 0,
    mapViews: 0,
    imageViews: 0,
    videoViews: 0,
    series: series.map((row) => ({
      date: isoDay(row.day),
      views: Number(row.views ?? 0),
      uniqueViews: Number(row.uniqueViews ?? 0),
    })),
  };
}

function mapLeadStatus(engine: string, status: string): string {
  if (engine === 'listing') return status === 'won' ? 'converted' : status;
  if (engine === 'sales') {
    return (
      {
        qualified: 'interested',
        appointment: 'negotiating',
        quoted: 'offer',
        won: 'converted',
      }[status] ?? status
    );
  }
  return status;
}

export async function getDashboardLeads(auth: AuthPrincipal, query: DashboardQuery) {
  const scope = await resolveSellerScope(auth, query);
  const listing = scopedListings(scope);
  const period = scope.period;
  const listingRows = await queryRows<Row>(
    `SELECT ll.id, ll.listing_id, ll.channel, ll.status, ll.created_at, l.title, mp.code AS marketplace
       FROM listing_leads ll
       JOIN listings l ON l.id = ll.listing_id
       JOIN marketplaces mp ON mp.id = l.marketplace_id
      WHERE ${listing.sql}
        AND ll.created_at >= ? AND ll.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      ORDER BY ll.created_at DESC
      LIMIT 200`,
    [...listing.params, period.from, period.to],
  );
  const offerRows = await queryRows<Row>(
    `SELECT o.id, o.listing_id, o.status, o.amount, o.currency, o.created_at, l.title, mp.code AS marketplace
       FROM listing_offers o
       JOIN listings l ON l.id = o.listing_id
       JOIN marketplaces mp ON mp.id = l.marketplace_id
      WHERE ${listing.sql}
        AND o.created_at >= ? AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      ORDER BY o.created_at DESC
      LIMIT 50`,
    [...listing.params, period.from, period.to],
  );
  const vehicle = vehicleLeadScopeSql(scope);
  const vehicleRows = await queryRows<Row>(
    `SELECT vl.id, vl.uuid, vl.listing_id, vl.status, vl.source, vl.created_at, l.title, mp.code AS marketplace
       FROM vehicle_leads vl
       LEFT JOIN listings l ON l.id = vl.listing_id
       LEFT JOIN marketplaces mp ON mp.id = l.marketplace_id
      WHERE ${vehicle.sql}
        AND vl.created_at >= ? AND vl.created_at < DATE_ADD(?, INTERVAL 1 DAY)
        AND (? IS NULL OR l.marketplace_id = ?)
      ORDER BY vl.created_at DESC
      LIMIT 100`,
    [...vehicle.params, period.from, period.to, scope.marketplaceId, scope.marketplaceId],
  );
  const sales = salesLeadScopeSql(scope);
  const salesRows = await queryRows<Row>(
    `SELECT sl.id, sl.uuid, sl.listing_id, sl.status, sl.title, sl.source, sl.assigned_to, sl.created_at
       FROM sales_leads sl
      WHERE ${sales.sql}
        AND sl.created_at >= ? AND sl.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      ORDER BY sl.updated_at DESC
      LIMIT 100`,
    [...sales.params, period.from, period.to],
  );

  const items = [
    ...listingRows.map((row) => ({
      id: Number(row.id),
      engine: 'listing' as const,
      listingId: Number(row.listing_id),
      title: String(row.title),
      marketplace: String(row.marketplace),
      source: String(row.channel),
      status: mapLeadStatus('listing', String(row.status)),
      createdAt: isoStamp(row.created_at) ?? '',
    })),
    ...offerRows.map((row) => ({
      id: Number(row.id),
      engine: 'offer' as const,
      listingId: Number(row.listing_id),
      title: String(row.title),
      marketplace: String(row.marketplace),
      source: 'offer',
      status: 'offer',
      amount: money(row.amount),
      currency: (row.currency as string | null) ?? null,
      createdAt: isoStamp(row.created_at) ?? '',
    })),
    ...vehicleRows.map((row) => ({
      id: Number(row.id),
      engine: 'vehicle' as const,
      uuid: String(row.uuid),
      listingId: row.listing_id == null ? null : Number(row.listing_id),
      title: (row.title as string | null) ?? 'Vehicle lead',
      marketplace: (row.marketplace as string | null) ?? 'vehicles',
      source: (row.source as string | null) ?? 'form',
      status: mapLeadStatus('vehicle', String(row.status)),
      createdAt: isoStamp(row.created_at) ?? '',
    })),
    ...salesRows.map((row) => ({
      id: Number(row.id),
      engine: 'sales' as const,
      uuid: String(row.uuid),
      listingId: row.listing_id == null ? null : Number(row.listing_id),
      title: String(row.title),
      marketplace: null as string | null,
      source: (row.source as string | null) ?? 'manual',
      status: mapLeadStatus('sales', String(row.status)),
      assignedTo: row.assigned_to == null ? null : Number(row.assigned_to),
      createdAt: isoStamp(row.created_at) ?? '',
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const pipeline: Record<string, number> = {};
  for (const item of items) {
    pipeline[item.status] = (pipeline[item.status] ?? 0) + 1;
  }

  const offset = (query.page - 1) * query.perPage;
  return {
    period,
    total: items.length,
    pipeline,
    items: items.slice(offset, offset + query.perPage),
  };
}

export async function getDashboardMessages(auth: AuthPrincipal, query: DashboardQuery) {
  const scope = await resolveSellerScope(auth, query);
  const inbox = await listConversations(auth.userId, 40, false);
  const unread = inbox.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0);
  const listing = scopedListings(scope);
  const listingThreads = await queryCount(
    `SELECT COUNT(*) FROM conversations c
       JOIN listings l ON l.id = c.listing_id
      WHERE c.kind = 'listing' AND ${listing.sql}`,
    listing.params,
  );
  return {
    unread,
    all: inbox.length,
    listingThreads,
    customers: inbox.filter((item) => item.kind === 'listing' || item.kind === 'direct').length,
    items: inbox.slice(0, 20).map((item) => ({
      uuid: item.uuid,
      kind: item.kind,
      subject: item.subject,
      preview: item.lastMessagePreview,
      unreadCount: item.unreadCount,
      lastMessageAt: item.lastMessageAt,
      peerName: item.peerName,
      listingTitle: item.listingTitle,
    })),
  };
}

export async function getDashboardFollowers(auth: AuthPrincipal, query: DashboardQuery) {
  const scope = await resolveSellerScope(auth, query);
  const period = scope.period;
  const followeeIds = new Set<number>([auth.userId]);
  if (scope.persona === 'company_admin' && scope.businessIds.length > 0) {
    const owners = await queryRows<Row>(
      `SELECT user_id FROM business_profiles WHERE id IN (${scope.businessIds.map(() => '?').join(', ')})`,
      scope.businessIds,
    );
    for (const row of owners) followeeIds.add(Number(row.user_id));
  }
  const ids = [...followeeIds];
  const total = await queryCount(
    `SELECT COUNT(*) FROM user_follows WHERE followee_id IN (${ids.map(() => '?').join(', ')})`,
    ids,
  );
  const neu = await queryCount(
    `SELECT COUNT(*) FROM user_follows
      WHERE followee_id IN (${ids.map(() => '?').join(', ')})
        AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [...ids, period.from, period.to],
  );
  const listing = scopedListings(scope);
  const listingFollowers = await queryOne<Row>(
    `SELECT COALESCE(SUM(favorite_count), 0) AS n FROM listings l WHERE l.deleted_at IS NULL AND ${listing.sql}`,
    listing.params,
  );
  return {
    period,
    totalFollowers: total,
    newFollowers: neu,
    unfollowed: 0,
    growth: neu,
    listingFollowers: Number(listingFollowers?.n ?? 0),
    companyFollowers: scope.persona === 'company_admin' ? total : 0,
  };
}

export async function getDashboardListings(auth: AuthPrincipal, query: DashboardQuery) {
  const scope = await resolveSellerScope(auth, query);
  const listing = scopedListings(scope);
  const page = query.page;
  const perPage = query.perPage;
  const statusFilter = query.status ? 'AND l.status = ?' : '';
  const params = statusFilter ? [...listing.params, query.status!] : listing.params;
  const total = await queryCount(
    `SELECT COUNT(*) FROM listings l WHERE l.deleted_at IS NULL AND ${listing.sql} ${statusFilter}`,
    params,
  );
  const rows = await queryRows<Row>(
    `SELECT l.id, l.uuid, l.title, l.status, l.lifecycle_status, l.transaction_status,
            l.operation, l.price, l.currency, l.view_count, l.favorite_count, l.lead_count,
            l.is_featured, l.is_boosted, l.published_at, l.expires_at, l.created_at,
            mp.code AS marketplace, c.name AS category
       FROM listings l
       JOIN marketplaces mp ON mp.id = l.marketplace_id
       JOIN categories c ON c.id = l.category_id
      WHERE l.deleted_at IS NULL AND ${listing.sql} ${statusFilter}
      ORDER BY COALESCE(l.published_at, l.created_at) DESC
      LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage],
  );

  const gold = await queryRows<Row>(
    `SELECT l.id, g.karat, g.net_weight_g, g.purity_percent, g.metal_type, l.price, l.view_count
       FROM listings l
       JOIN gold_listing_details g ON g.listing_id = l.id
       JOIN marketplaces mp ON mp.id = l.marketplace_id AND mp.code = 'gold'
      WHERE l.deleted_at IS NULL AND ${listing.sql}
      ORDER BY l.view_count DESC LIMIT 20`,
    listing.params,
  );
  const property = await queryRows<Row>(
    `SELECT l.id, p.area_value, p.area_unit, p.bedrooms, l.operation, l.price, l.view_count, l.lead_count
       FROM listings l
       JOIN property_listing_details p ON p.listing_id = l.id
       JOIN marketplaces mp ON mp.id = l.marketplace_id AND mp.code = 'property'
      WHERE l.deleted_at IS NULL AND ${listing.sql}
      ORDER BY l.view_count DESC LIMIT 20`,
    listing.params,
  );
  const vehicles = await queryRows<Row>(
    `SELECT l.id, v.vehicle_type, v.make_name AS make, v.model_name AS model, v.year, l.price, l.view_count, l.lead_count
       FROM listings l
       JOIN vehicle_listing_details v ON v.listing_id = l.id
       JOIN marketplaces mp ON mp.id = l.marketplace_id AND mp.code = 'vehicles'
      WHERE l.deleted_at IS NULL AND ${listing.sql}
      ORDER BY l.view_count DESC LIMIT 20`,
    listing.params,
  );

  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      title: String(row.title),
      status: String(row.status),
      lifecycleStatus: (row.lifecycle_status as string | null) ?? null,
      transactionStatus: (row.transaction_status as string | null) ?? null,
      marketplace: String(row.marketplace),
      category: String(row.category),
      operation: String(row.operation),
      price: money(row.price),
      currency: (row.currency as string | null) ?? null,
      viewCount: Number(row.view_count ?? 0),
      favoriteCount: Number(row.favorite_count ?? 0),
      leadCount: Number(row.lead_count ?? 0),
      featured: Number(row.is_featured ?? 0) === 1,
      boosted: Number(row.is_boosted ?? 0) === 1,
      publishedAt: isoStamp(row.published_at),
      expiresAt: isoStamp(row.expires_at),
      createdAt: isoStamp(row.created_at),
      actions: ['edit', 'renew', 'feature', 'boost', 'archive'],
    })),
    total,
    page,
    perPage,
    gold: gold.map((row) => ({
      listingId: Number(row.id),
      karat: toNumber(row.karat),
      weight: toNumber(row.net_weight_g),
      purity: toNumber(row.purity_percent),
      metalType: (row.metal_type as string | null) ?? null,
      price: money(row.price),
      views: Number(row.view_count ?? 0),
    })),
    property: property.map((row) => ({
      listingId: Number(row.id),
      area: toNumber(row.area_value),
      areaUnit: (row.area_unit as string | null) ?? null,
      bedrooms: row.bedrooms == null ? null : Number(row.bedrooms),
      operation: String(row.operation),
      price: money(row.price),
      views: Number(row.view_count ?? 0),
      leads: Number(row.lead_count ?? 0),
    })),
    vehicles: vehicles.map((row) => ({
      listingId: Number(row.id),
      type: (row.vehicle_type as string | null) ?? null,
      make: (row.make as string | null) ?? null,
      model: (row.model as string | null) ?? null,
      year: row.year == null ? null : Number(row.year),
      price: money(row.price),
      views: Number(row.view_count ?? 0),
      leads: Number(row.lead_count ?? 0),
    })),
  };
}

export async function getDashboardAnalytics(auth: AuthPrincipal, query: DashboardQuery) {
  const scope = await resolveSellerScope(auth, query);
  const listing = scopedListings(scope);
  const period = scope.period;
  const totals = await queryOne<Row>(
    `SELECT COALESCE(SUM(m.views), 0) AS views,
            COALESCE(SUM(m.leads), 0) AS leads,
            COALESCE(SUM(m.favorites), 0) AS favorites,
            COALESCE(SUM(m.shares), 0) AS shares,
            COALESCE(SUM(m.chats), 0) AS messages,
            COALESCE(SUM(m.calls), 0) AS calls,
            COALESCE(SUM(m.impressions), 0) AS impressions
       FROM listing_metrics_daily m
       JOIN listings l ON l.id = m.listing_id
      WHERE l.deleted_at IS NULL AND ${listing.sql} AND m.metric_date BETWEEN ? AND ?`,
    [...listing.params, period.from, period.to],
  );
  const views = Number(totals?.views ?? 0);
  const leads = Number(totals?.leads ?? 0);
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
    [period.from, period.to, ...listing.params],
  );
  const worst = await queryRows<Row>(
    `SELECT l.id, l.uuid, l.title, COALESCE(SUM(m.views), 0) AS views, COALESCE(SUM(m.leads), 0) AS leads
       FROM listings l
       LEFT JOIN listing_metrics_daily m ON m.listing_id = l.id AND m.metric_date BETWEEN ? AND ?
      WHERE l.deleted_at IS NULL AND ${listing.sql}
      GROUP BY l.id, l.uuid, l.title
      ORDER BY views ASC, leads ASC
      LIMIT 5`,
    [period.from, period.to, ...listing.params],
  );
  const categories = await queryRows<Row>(
    `SELECT c.name AS category, COALESCE(SUM(m.views), 0) AS views
       FROM listings l
       JOIN categories c ON c.id = l.category_id
       LEFT JOIN listing_metrics_daily m ON m.listing_id = l.id AND m.metric_date BETWEEN ? AND ?
      WHERE l.deleted_at IS NULL AND ${listing.sql}
      GROUP BY c.id, c.name
      ORDER BY views DESC
      LIMIT 8`,
    [period.from, period.to, ...listing.params],
  );
  const locations = await queryRows<Row>(
    `SELECT COALESCE(city.name, 'Unknown') AS location, COALESCE(SUM(m.views), 0) AS views
       FROM listings l
       LEFT JOIN cities city ON city.id = l.city_id
       LEFT JOIN listing_metrics_daily m ON m.listing_id = l.id AND m.metric_date BETWEEN ? AND ?
      WHERE l.deleted_at IS NULL AND ${listing.sql}
      GROUP BY l.city_id, city.name
      ORDER BY views DESC
      LIMIT 8`,
    [period.from, period.to, ...listing.params],
  );
  return {
    period,
    views,
    leads,
    conversionRate: views > 0 ? Number((leads / views).toFixed(4)) : 0,
    favorites: Number(totals?.favorites ?? 0),
    shares: Number(totals?.shares ?? 0),
    messages: Number(totals?.messages ?? 0),
    calls: Number(totals?.calls ?? 0),
    impressions: Number(totals?.impressions ?? 0),
    topListings: top.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      title: String(row.title),
      marketplace: String(row.marketplace),
      views: Number(row.views ?? 0),
      leads: Number(row.leads ?? 0),
    })),
    worstListings: worst.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      title: String(row.title),
      views: Number(row.views ?? 0),
      leads: Number(row.leads ?? 0),
    })),
    bestCategories: categories.map((row) => ({ category: String(row.category), views: Number(row.views ?? 0) })),
    bestLocations: locations.map((row) => ({ location: String(row.location), views: Number(row.views ?? 0) })),
  };
}

export async function getDashboardPromotions(auth: AuthPrincipal, query: DashboardQuery) {
  const scope = await resolveSellerScope(auth, query);
  const listing = scopedListings(scope);
  const promotions = await queryRows<Row>(
    `SELECT p.id, p.kind, p.status, p.amount, p.currency, p.starts_at, p.ends_at, p.impressions, p.clicks,
            l.uuid AS listingUuid, l.title
       FROM listing_promotions p
       JOIN listings l ON l.id = p.listing_id
      WHERE ${listing.sql}
      ORDER BY p.created_at DESC
      LIMIT 50`,
    listing.params,
  );
  const campaigns = await listCampaigns(auth.userId).catch(() => []);
  return {
    listingPromotions: promotions.map((row) => ({
      id: Number(row.id),
      kind: String(row.kind),
      status: String(row.status),
      amount: money(row.amount),
      currency: (row.currency as string | null) ?? null,
      startsAt: isoStamp(row.starts_at),
      endsAt: isoStamp(row.ends_at),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      listingUuid: String(row.listingUuid),
      title: String(row.title),
    })),
    campaigns: campaigns.map((campaign) => ({
      uuid: campaign.uuid,
      name: campaign.name,
      status: campaign.status,
      format: campaign.objective,
      totalBudget: campaign.totalBudget,
      spentAmount: campaign.spentAmount,
      impressions: 0,
      clicks: 0,
    })),
  };
}

export async function getDashboardInvoices(auth: AuthPrincipal, query: DashboardQuery) {
  const scope = await resolveSellerScope(auth, query);
  const own = await listInvoices(auth.userId, 50);
  let company: typeof own = [];
  if (canViewCompanyFinance(scope) && scope.businessIds.length > 0) {
    const rows = await queryRows<Row>(
      `SELECT uuid, invoice_number, total_amount, tax_amount, currency, status, issued_at, paid_at, pdf_url
         FROM invoices
        WHERE business_id IN (${scope.businessIds.map(() => '?').join(', ')})
          AND user_id <> ?
        ORDER BY id DESC LIMIT 50`,
      [...scope.businessIds, auth.userId],
    );
    company = rows.map((row) => ({
      uuid: String(row.uuid),
      invoiceNumber: String(row.invoice_number),
      totalAmount: money(row.total_amount),
      taxAmount: money(row.tax_amount),
      currency: String(row.currency),
      status: String(row.status),
      issuedAt: isoStamp(row.issued_at),
      paidAt: isoStamp(row.paid_at),
      pdfUrl: (row.pdf_url as string | null) ?? null,
    }));
  }
  return { items: [...own, ...company] };
}

export async function getDashboardSubscription(auth: AuthPrincipal) {
  return getCurrentSubscription(auth.userId);
}

/** GET /seller/dashboard — same payload as summary. */
export async function getSellerDashboard(auth: AuthPrincipal, query: DashboardQuery) {
  return getDashboardSummary(auth, query);
}
