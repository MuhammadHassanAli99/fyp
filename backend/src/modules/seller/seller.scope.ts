import type { AuthPrincipal } from '../../types/express';
import { queryRows, type Row } from '../../db/query';
import { hasPermission } from '../../middleware/authorize';
import type { DashboardQuery, MarketplaceCode } from './seller.schema';

export type SellerPersona = 'individual' | 'salesman' | 'sales_manager' | 'company_admin';

export interface ScopeSql {
  sql: string;
  params: Array<string | number>;
}

export interface SellerScope {
  userId: number;
  persona: SellerPersona;
  roles: string[];
  businessIds: number[];
  teamIds: number[];
  teamMemberIds: number[];
  /** null = every marketplace the caller is allowed to sell in */
  marketplaceId: number | null;
  allowedMarketplaceIds: number[] | null;
  countryIds: number[] | null;
  filterBusinessId: number | null;
  period: { from: string; to: string; days: number; label: string };
}

const COMPANY_ADMIN_ROLES = new Set(['company_owner', 'company_admin', 'company_manager']);
const SALES_MANAGER_ROLES = new Set(['sales_manager', 'sales_director']);
const SALESMAN_ROLES = new Set(['salesman', 'company_salesman', 'sales_executive']);
const COMPANY_MEMBER_ROLES = new Set(['owner', 'admin', 'manager']);

function inList(ids: number[]): { sql: string; params: number[] } {
  if (ids.length === 0) return { sql: 'NULL', params: [] };
  return { sql: ids.map(() => '?').join(', '), params: ids };
}

/** Invalid marketplace codes never reach here; unknown ids are ignored, not 403. */
export function pickMarketplaceId(requestedId: number | null, allowed: number[] | null): number | null {
  if (!requestedId) return null;
  if (!allowed || allowed.includes(requestedId)) return requestedId;
  return null;
}

/** Invalid company ids are ignored so callers cannot probe authorization with 403s. */
export function pickCompanyFilter(requested: number | undefined, authorized: number[]): number | null {
  if (!requested) return null;
  return authorized.includes(requested) ? requested : null;
}

export function detectPersona(roles: readonly string[], memberRoles: readonly string[]): SellerPersona {
  if (roles.some((role) => COMPANY_ADMIN_ROLES.has(role)) || memberRoles.some((role) => COMPANY_MEMBER_ROLES.has(role))) {
    return 'company_admin';
  }
  if (roles.some((role) => SALES_MANAGER_ROLES.has(role))) return 'sales_manager';
  if (roles.some((role) => SALESMAN_ROLES.has(role))) return 'salesman';
  return 'individual';
}

export function resolvePeriod(query: Pick<DashboardQuery, 'period' | 'from' | 'to'>): SellerScope['period'] {
  const today = new Date();
  const toDate = query.to && query.period === 'custom' ? new Date(`${query.to}T00:00:00Z`) : today;
  const end = Number.isNaN(toDate.getTime()) ? today : toDate;
  const to = end.toISOString().slice(0, 10);

  const daysBack = (days: number) => {
    const from = new Date(end);
    from.setUTCDate(from.getUTCDate() - (days - 1));
    return from.toISOString().slice(0, 10);
  };

  switch (query.period) {
    case 'today':
      return { from: to, to, days: 1, label: 'today' };
    case '7d':
      return { from: daysBack(7), to, days: 7, label: '7d' };
    case '90d':
      return { from: daysBack(90), to, days: 90, label: '90d' };
    case '1y':
      return { from: daysBack(365), to, days: 365, label: '1y' };
    case 'custom': {
      const fromRaw = query.from ? new Date(`${query.from}T00:00:00Z`) : new Date(end);
      const fromDate = Number.isNaN(fromRaw.getTime()) ? end : fromRaw;
      const from = fromDate.toISOString().slice(0, 10);
      const days = Math.max(1, Math.ceil((end.getTime() - fromDate.getTime()) / 86_400_000) + 1);
      return { from, to, days: Math.min(days, 366), label: 'custom' };
    }
    default:
      return { from: daysBack(30), to, days: 30, label: '30d' };
  }
}

/**
 * Builds the listing visibility predicate. Column names are code-controlled.
 * GLOBAL `listing.view` on a seller role is NOT treated as platform-wide access.
 */
export function listingScopeSql(scope: SellerScope, alias = 'l'): ScopeSql {
  const parts: string[] = [`${alias}.user_id = ?`];
  const params: Array<string | number> = [scope.userId];

  parts.push(
    `EXISTS (SELECT 1 FROM listing_assignments la WHERE la.listing_id = ${alias}.id AND la.user_id = ? AND la.revoked_at IS NULL)`,
  );
  params.push(scope.userId);

  parts.push(
    `EXISTS (SELECT 1 FROM listing_grants lg WHERE lg.listing_id = ${alias}.id AND lg.user_id = ? AND lg.revoked_at IS NULL)`,
  );
  params.push(scope.userId);

  if (scope.persona === 'company_admin' && scope.businessIds.length > 0) {
    const list = inList(scope.businessIds);
    parts.push(`${alias}.business_id IN (${list.sql})`);
    params.push(...list.params);
  }

  if (scope.persona === 'sales_manager' && scope.teamMemberIds.length > 0) {
    const list = inList(scope.teamMemberIds);
    parts.push(`${alias}.user_id IN (${list.sql})`);
    params.push(...list.params);
    parts.push(
      `EXISTS (SELECT 1 FROM listing_assignments la WHERE la.listing_id = ${alias}.id AND la.user_id IN (${list.sql}) AND la.revoked_at IS NULL)`,
    );
    params.push(...list.params);
  }

  let sql = `(${parts.join(' OR ')})`;

  if (scope.filterBusinessId) {
    sql = `(${sql}) AND ${alias}.business_id = ?`;
    params.push(scope.filterBusinessId);
  }
  if (scope.marketplaceId) {
    sql = `(${sql}) AND ${alias}.marketplace_id = ?`;
    params.push(scope.marketplaceId);
  } else if (scope.allowedMarketplaceIds && scope.allowedMarketplaceIds.length > 0) {
    const list = inList(scope.allowedMarketplaceIds);
    sql = `(${sql}) AND ${alias}.marketplace_id IN (${list.sql})`;
    params.push(...list.params);
  }
  if (scope.countryIds && scope.countryIds.length > 0) {
    const list = inList(scope.countryIds);
    sql = `(${sql}) AND ${alias}.country_id IN (${list.sql})`;
    params.push(...list.params);
  }

  return { sql, params };
}

export function canViewCompanyFinance(scope: SellerScope): boolean {
  return scope.persona === 'company_admin';
}

export function salesLeadScopeSql(scope: SellerScope, alias = 'sl'): ScopeSql {
  if (scope.businessIds.length === 0) return { sql: '1 = 0', params: [] };
  const biz = inList(scope.businessIds);
  const parts = [`${alias}.business_id IN (${biz.sql})`];
  const params: Array<string | number> = [...biz.params];

  if (scope.persona === 'salesman' || scope.persona === 'individual') {
    parts.push(`${alias}.assigned_to = ?`);
    params.push(scope.userId);
  } else if (scope.persona === 'sales_manager') {
    const people = [...new Set([scope.userId, ...scope.teamMemberIds])];
    const list = inList(people);
    parts.push(`${alias}.assigned_to IN (${list.sql})`);
    params.push(...list.params);
  }

  if (scope.marketplaceId) {
    parts.push(`(${alias}.marketplace_id = ? OR ${alias}.marketplace_id IS NULL)`);
    params.push(scope.marketplaceId);
  }
  return { sql: parts.join(' AND '), params };
}

export function vehicleLeadScopeSql(scope: SellerScope, alias = 'vl'): ScopeSql {
  const parts: string[] = [];
  const params: Array<string | number> = [];

  if (scope.persona === 'company_admin' && scope.businessIds.length > 0) {
    const biz = inList(scope.businessIds);
    parts.push(
      `(${alias}.seller_id = ? OR ${alias}.assignee_id = ? OR ${alias}.business_id IN (${biz.sql}))`,
    );
    params.push(scope.userId, scope.userId, ...biz.params);
  } else if (scope.persona === 'sales_manager') {
    const people = [...new Set([scope.userId, ...scope.teamMemberIds])];
    const list = inList(people);
    parts.push(`(${alias}.seller_id IN (${list.sql}) OR ${alias}.assignee_id IN (${list.sql}))`);
    params.push(...list.params, ...list.params);
  } else {
    parts.push(`(${alias}.seller_id = ? OR ${alias}.assignee_id = ?)`);
    params.push(scope.userId, scope.userId);
  }

  return { sql: parts.join(' AND '), params };
}

export function spendScopeSql(scope: SellerScope, alias = 'o'): ScopeSql {
  if (canViewCompanyFinance(scope) && scope.businessIds.length > 0) {
    const list = inList(scope.businessIds);
    return {
      sql: `(${alias}.user_id = ? OR ${alias}.business_id IN (${list.sql}))`,
      params: [scope.userId, ...list.params],
    };
  }
  return { sql: `${alias}.user_id = ?`, params: [scope.userId] };
}

function jsonCodes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function resolveSellerScope(
  auth: AuthPrincipal,
  query: DashboardQuery = { period: '30d', page: 1, perPage: 20 },
): Promise<SellerScope> {
  const memberships = await queryRows<Row>(
    `SELECT business_id, member_role, department_id, team_id
       FROM business_members
      WHERE user_id = ? AND removed_at IS NULL AND accepted_at IS NOT NULL`,
    [auth.userId],
  );

  const businessIds = new Set<number>();
  const teamIds = new Set<number>();
  const memberRoles: string[] = [];
  for (const row of memberships) {
    businessIds.add(Number(row.business_id));
    memberRoles.push(String(row.member_role));
    if (row.team_id != null) teamIds.add(Number(row.team_id));
  }

  const countryIds = new Set<number>();
  const grantMarketplaces = new Set<number>();
  let sawMarketplaceGrant = false;
  let sawCountryGrant = false;

  for (const grant of auth.grants ?? []) {
    if (grant.scope.businessId) businessIds.add(grant.scope.businessId);
    if (grant.scope.teamId) teamIds.add(grant.scope.teamId);
    if (grant.scope.type === 'MARKETPLACE' && grant.scope.marketplaceId) {
      sawMarketplaceGrant = true;
      grantMarketplaces.add(grant.scope.marketplaceId);
    }
    if (grant.scope.type === 'COUNTRY' && grant.scope.countryId) {
      sawCountryGrant = true;
      countryIds.add(grant.scope.countryId);
    }
  }

  const persona = detectPersona(auth.roles, memberRoles);

  let teamMemberIds: number[] = [];
  if (persona === 'sales_manager' && teamIds.size > 0) {
    const list = inList([...teamIds]);
    const members = await queryRows<Row>(
      `SELECT user_id FROM business_team_members WHERE team_id IN (${list.sql})
       UNION
       SELECT user_id FROM business_members WHERE team_id IN (${list.sql}) AND removed_at IS NULL`,
      [...list.params, ...list.params],
    );
    teamMemberIds = [...new Set(members.map((row) => Number(row.user_id)))];
  }

  const marketplaces = await queryRows<Row>(`SELECT id, code FROM marketplaces WHERE is_active = 1`);
  const codeToId = new Map(marketplaces.map((row) => [String(row.code), Number(row.id)]));

  let allowedMarketplaceIds: number[] | null = sawMarketplaceGrant ? [...grantMarketplaces] : null;
  if (businessIds.size > 0) {
    const list = inList([...businessIds]);
    const businesses = await queryRows<Row>(`SELECT id, marketplaces FROM business_profiles WHERE id IN (${list.sql})`, list.params);
    const fromBusiness = new Set<number>();
    for (const row of businesses) {
      for (const code of jsonCodes(row.marketplaces)) {
        const id = codeToId.get(code);
        if (id) fromBusiness.add(id);
      }
    }
    if (fromBusiness.size > 0) {
      allowedMarketplaceIds = allowedMarketplaceIds
        ? allowedMarketplaceIds.filter((id) => fromBusiness.has(id))
        : [...fromBusiness];
    }
  }

  const requested = query.marketplace as MarketplaceCode | undefined;
  const requestedId = requested ? codeToId.get(requested) ?? null : null;
  const authorizedCompanies = [...businessIds];

  return {
    userId: auth.userId,
    persona,
    roles: [...auth.roles],
    businessIds: authorizedCompanies,
    teamIds: [...teamIds],
    teamMemberIds,
    marketplaceId: pickMarketplaceId(requestedId, allowedMarketplaceIds),
    allowedMarketplaceIds,
    countryIds: sawCountryGrant ? [...countryIds] : null,
    filterBusinessId: pickCompanyFilter(query.companyId, authorizedCompanies),
    period: resolvePeriod(query),
  };
}

export function sellerCanAccessDashboard(auth: AuthPrincipal): boolean {
  return (
    hasPermission(auth.permissions, 'analytics.view') ||
    hasPermission(auth.permissions, 'listing.view') ||
    hasPermission(auth.permissions, 'sales.view') ||
    hasPermission(auth.permissions, '*')
  );
}
