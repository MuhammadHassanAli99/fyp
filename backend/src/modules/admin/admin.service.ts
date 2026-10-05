import type { Request } from 'express';
import { queryCount, queryRows, type Row } from '../../db/query';
import { hasPermission } from '../../middleware/authorize';
import { principal, scopeSql } from './admin.authz';
import { getSystemHealthSnapshot } from './admin.health';

const can = (req: Request, permission: string) => hasPermission(req.auth?.permissions ?? [], permission);

export async function getAdminSession(req: Request) {
  const auth = principal(req);
  const modules = [
    { id: 'dashboard', permission: 'admin.view' },
    { id: 'users', permission: 'user.view_any' },
    { id: 'companies', permission: 'business.view_any' },
    { id: 'employees', permission: 'employee.view_any' },
    { id: 'roles', permission: 'role.view_any' },
    { id: 'permissions', permission: 'permission.view_any' },
    { id: 'listings', permission: 'listing.view_any' },
    { id: 'categories', permission: 'category.view_any' },
    { id: 'countries', permission: 'country.view_any' },
    { id: 'languages', permission: 'language.view_any' },
    { id: 'currencies', permission: 'currency.view_any' },
    { id: 'subscriptions', permission: 'subscription.view_any' },
    { id: 'payments', permission: 'payment.view_any' },
    { id: 'invoices', permission: 'invoice.view_any' },
    { id: 'refunds', permission: 'refund.view_any' },
    { id: 'reports', permission: 'report.view_any' },
    { id: 'moderation', permission: 'moderation.view_any' },
    { id: 'reviews', permission: 'review.moderate' },
    { id: 'ads', permission: 'ad_campaign.approve' },
    { id: 'fraud', permission: 'risk.view_any' },
    { id: 'kyc', permission: 'kyc.view_any' },
    { id: 'analytics', permission: 'analytics.view_any' },
    { id: 'cms', permission: 'cms_page.view_any' },
    { id: 'notifications', permission: 'notification.view_any' },
    { id: 'support', permission: 'ticket.view_any' },
    { id: 'audit', permission: 'audit.view_any' },
    { id: 'security', permission: 'audit.view_any' },
    { id: 'privacy', permission: 'user.export' },
    { id: 'system_health', permission: 'system_health.view' },
    { id: 'sales', permission: 'sales.view' },
    { id: 'approvals', permission: 'approval.view' },
  ].filter((mod) => hasPermission(auth.permissions, mod.permission) || hasPermission(auth.permissions, 'admin.view'));

  return {
    userId: auth.userId,
    roles: auth.roles,
    permissions: auth.permissions,
    isStaff: auth.isStaff,
    scopes: auth.scopes,
    mfaSatisfied: auth.mfaSatisfied,
    modules: modules.map((mod) => mod.id),
  };
}

export async function getAdminSummary(req: Request) {
  const auth = principal(req);
  const tiles: Record<string, unknown> = { checkedAt: new Date().toISOString() };

  if (can(req, 'user.view_any') || can(req, 'admin.view')) {
    const scoped = scopeSql(auth, 'user.view_any', { countryId: 'country_id', ownerId: 'id' });
    const [users, recentUsers] = await Promise.all([
      queryCount(
        `SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND status <> 'deleted' AND ${scoped.sql}`,
        scoped.params,
      ),
      queryCount(
        `SELECT COUNT(*) FROM users WHERE created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 24 HOUR) AND deleted_at IS NULL AND ${scoped.sql}`,
        scoped.params,
      ),
    ]);
    tiles.users = { total: users, last24h: recentUsers };
  }

  if (can(req, 'listing.view_any') || can(req, 'listing.view') || can(req, 'admin.view')) {
    const listingPerm = can(req, 'listing.view_any') ? 'listing.view_any' : 'listing.view';
    const scoped = scopeSql(auth, listingPerm, {
      ownerId: 'user_id',
      countryId: 'country_id',
      marketplaceId: 'marketplace_id',
      categoryId: 'category_id',
      businessId: 'business_id',
      assignmentTable: 'id',
    });
    const [listings, recentListings, pendingListings] = await Promise.all([
      queryCount(`SELECT COUNT(*) FROM listings WHERE deleted_at IS NULL AND ${scoped.sql}`, scoped.params),
      queryCount(
        `SELECT COUNT(*) FROM listings WHERE created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 24 HOUR) AND deleted_at IS NULL AND ${scoped.sql}`,
        scoped.params,
      ),
      queryCount(
        `SELECT COUNT(*) FROM listings WHERE deleted_at IS NULL AND (lifecycle_status = 'pending_review' OR status = 'pending_review') AND ${scoped.sql}`,
        scoped.params,
      ),
    ]);
    tiles.listings = { total: listings, last24h: recentListings, pendingReview: pendingListings };
  }

  if (can(req, 'moderation.view_any') || can(req, 'moderation.view')) {
    tiles.moderation = {
      pending: await queryCount(`SELECT COUNT(*) FROM moderation_queue WHERE status IN ('pending','claimed','in_review')`),
    };
  }

  if (can(req, 'ticket.view_any')) {
    tiles.support = {
      openTickets: await queryCount(
        `SELECT COUNT(*) FROM support_tickets WHERE status IN ('new','open','pending_customer','pending_internal','on_hold','reopened')`,
      ),
    };
  }

  if (can(req, 'risk.view_any') || can(req, 'fraud_case.view_any')) {
    tiles.fraud = {
      openCases: await queryCount(`SELECT COUNT(*) FROM fraud_cases WHERE status IN ('open','investigating','pending_info','escalated','appealed')`),
    };
  }

  if (can(req, 'kyc.view_any')) {
    tiles.kyc = {
      pending: await queryCount(`SELECT COUNT(*) FROM kyc_records WHERE status IN ('pending','in_review','requires_update')`),
    };
  }

  if (can(req, 'payment.view_any') || can(req, 'subscription.view_any')) {
    const [payments, subscriptions] = await Promise.all([
      queryCount(`SELECT COUNT(*) FROM payments WHERE created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 24 HOUR)`),
      queryCount(`SELECT COUNT(*) FROM user_subscriptions WHERE status IN ('active','trialing','grace')`),
    ]);
    tiles.finance = { paymentsLast24h: payments, activeSubscriptions: subscriptions };
  }

  if (can(req, 'sales.view') || can(req, 'sales.view_any')) {
    tiles.sales = {
      openLeads: await queryCount(
        `SELECT COUNT(*) FROM sales_leads WHERE status NOT IN ('won','lost') ${can(req, 'sales.view_any') ? '' : 'AND assigned_to = ?'}`,
        can(req, 'sales.view_any') ? [] : [req.auth!.userId],
      ),
    };
  }

  if (can(req, 'system_health.view') || can(req, 'admin.view')) {
    tiles.outbox = { pending: await queryCount(`SELECT COUNT(*) FROM outbox_events WHERE status = 'pending'`) };
    tiles.health = await getSystemHealthSnapshot();
  }

  const listingScope = scopeSql(auth, can(req, 'listing.view_any') ? 'listing.view_any' : 'listing.view', {
    ownerId: 'l.user_id',
    countryId: 'l.country_id',
    marketplaceId: 'l.marketplace_id',
    businessId: 'l.business_id',
    assignmentTable: 'l.id',
  });
  const byMarketplace =
    can(req, 'listing.view_any') || can(req, 'listing.view')
      ? await queryRows<Row>(
          `SELECT m.code, COUNT(*) AS c
             FROM listings l JOIN marketplaces m ON m.id = l.marketplace_id
            WHERE l.deleted_at IS NULL AND ${listingScope.sql}
            GROUP BY m.code`,
          listingScope.params,
        )
      : [];

  tiles.marketplaces = Object.fromEntries(byMarketplace.map((row) => [String(row.code), Number(row.c)]));
  return tiles;
}

