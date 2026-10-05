import { forbidden } from '../../core/errors';
import { hasPermission } from '../../middleware/authorize';
import { remember } from '../../config/cache';
import { queryRows, type Row } from '../../db/query';
import type { AuthPrincipal } from '../../types/express';
import { isUnrestricted, matchingGrants } from '../admin/admin.authz';
import {
  pickCompanyFilter,
  pickMarketplaceId,
  resolvePeriod,
  resolveSellerScope,
  sellerCanAccessDashboard,
  type SellerScope,
} from '../seller/seller.scope';
import { applyRequestedSellerFilter } from './analytics.catalog';
import type { AnalyticsQuery } from './analytics.schema';

export type AnalyticsMode = 'global' | 'marketplace' | 'company' | 'team' | 'own';

export interface AnalyticsScope {
  userId: number;
  mode: AnalyticsMode;
  permission: string;
  canExport: boolean;
  marketplaceId: number | null;
  allowedMarketplaceIds: number[] | null;
  countryIds: number[] | null;
  cityId: number | null;
  categoryId: number | null;
  businessIds: number[];
  ownerUserIds: number[] | null;
  period: { from: string; to: string; days: number; label: string };
  os: string | null;
  device: string | null;
  source: string | null;
  funnel: string | null;
  heatmap: AnalyticsQuery['heatmap'];
  persona: SellerScope['persona'] | 'admin';
}

function inList(ids: number[]): { sql: string; params: number[] } {
  if (ids.length === 0) return { sql: 'NULL', params: [] };
  return { sql: ids.map(() => '?').join(', '), params: ids };
}

export function isPlatformScope(scope: AnalyticsScope): boolean {
  return scope.mode === 'global' || scope.mode === 'marketplace';
}

export async function resolveAnalyticsScope(auth: AuthPrincipal, query: AnalyticsQuery): Promise<AnalyticsScope> {
  const canAny = hasPermission(auth.permissions, 'analytics.view_any') || hasPermission(auth.permissions, '*');
  const canOwn = sellerCanAccessDashboard(auth);
  if (!canAny && !canOwn) throw forbidden('Missing permission: analytics.view');

  const period = resolvePeriod({
    period: query.period,
    from: query.from,
    to: query.to,
  });
  const canExport = hasPermission(auth.permissions, 'analytics.export') || hasPermission(auth.permissions, '*');

  const marketplaces = await remember('ref:marketplaces:idcode', 3600, () =>
    queryRows<Row>(`SELECT id, code FROM marketplaces WHERE is_active = 1`),
  );
  const codeToId = new Map(marketplaces.map((row) => [String(row.code), Number(row.id)]));
  const requestedMarketplace = query.marketplace ? codeToId.get(query.marketplace) ?? null : null;

  if (canAny) {
    const permission = hasPermission(auth.permissions, 'analytics.view_any') ? 'analytics.view_any' : 'analytics.view';
    const grants = matchingGrants(auth, permission);
    const marketplaceIds = new Set<number>();
    const countryIds = new Set<number>();
    let sawMarketplace = false;
    let sawCountry = false;
    for (const grant of grants) {
      if (grant.scope.type === 'MARKETPLACE' && grant.scope.marketplaceId) {
        sawMarketplace = true;
        marketplaceIds.add(grant.scope.marketplaceId);
      }
      if (grant.scope.type === 'COUNTRY' && grant.scope.countryId) {
        sawCountry = true;
        countryIds.add(grant.scope.countryId);
      }
    }

    const unrestricted = isUnrestricted(auth, permission);
    const allowed = unrestricted || !sawMarketplace ? null : [...marketplaceIds];
    const marketplaceId = pickMarketplaceId(requestedMarketplace, allowed);
    const requestedCountry = query.countryId ?? null;
    const allowedCountries = unrestricted || !sawCountry ? null : [...countryIds];
    const countryFilter =
      requestedCountry && (!allowedCountries || allowedCountries.includes(requestedCountry))
        ? [requestedCountry]
        : allowedCountries;

    return {
      userId: auth.userId,
      mode: unrestricted ? 'global' : sawMarketplace ? 'marketplace' : sawCountry ? 'marketplace' : 'global',
      permission,
      canExport,
      marketplaceId,
      allowedMarketplaceIds: allowed,
      countryIds: countryFilter,
      cityId: query.cityId ?? null,
      categoryId: query.categoryId ?? null,
      businessIds: [],
      ownerUserIds: null,
      period,
      os: query.os ?? null,
      device: query.device ?? null,
      source: query.source ?? null,
      funnel: query.funnel ?? null,
      heatmap: query.heatmap,
      persona: 'admin',
    };
  }

  const seller = await resolveSellerScope(auth, {
    marketplace: query.marketplace,
    companyId: query.companyId,
    period: query.period,
    from: query.from,
    to: query.to,
    page: 1,
    perPage: 20,
  });

  let ownerUserIds = [auth.userId];
  let mode: AnalyticsMode = 'own';
  if (seller.persona === 'company_admin' && seller.businessIds.length > 0) {
    mode = 'company';
    const list = inList(seller.businessIds);
    const members = await queryRows<Row>(
      `SELECT user_id FROM business_members WHERE business_id IN (${list.sql}) AND removed_at IS NULL`,
      list.params,
    );
    ownerUserIds = [...new Set([auth.userId, ...members.map((row) => Number(row.user_id))])];
  } else if (seller.persona === 'sales_manager') {
    mode = 'team';
    ownerUserIds = [...new Set([auth.userId, ...seller.teamMemberIds])];
  }

  ownerUserIds = applyRequestedSellerFilter(ownerUserIds, query.sellerId);

  return {
    userId: auth.userId,
    mode,
    permission: 'analytics.view',
    canExport,
    marketplaceId: seller.marketplaceId,
    allowedMarketplaceIds: seller.allowedMarketplaceIds,
    countryIds: seller.countryIds,
    cityId: query.cityId ?? null,
    categoryId: query.categoryId ?? null,
    businessIds: seller.filterBusinessId ? [seller.filterBusinessId] : seller.businessIds,
    ownerUserIds,
    period,
    os: query.os ?? null,
    device: query.device ?? null,
    source: query.source ?? null,
    funnel: query.funnel ?? null,
    heatmap: query.heatmap,
    persona: seller.persona,
  };
}

export function dimSql(
  scope: AnalyticsScope,
  columns: { marketplace?: string; country?: string; city?: string },
): { sql: string; params: Array<string | number> } {
  const parts: string[] = ['1 = 1'];
  const params: Array<string | number> = [];
  if (scope.marketplaceId && columns.marketplace) {
    parts.push(`(${columns.marketplace} = ? OR ${columns.marketplace} = 0)`);
    params.push(scope.marketplaceId);
  } else if (scope.allowedMarketplaceIds && scope.allowedMarketplaceIds.length > 0 && columns.marketplace) {
    const list = inList(scope.allowedMarketplaceIds);
    parts.push(`(${columns.marketplace} IN (${list.sql}) OR ${columns.marketplace} = 0)`);
    params.push(...list.params);
  }
  if (scope.countryIds && scope.countryIds.length > 0 && columns.country) {
    const list = inList(scope.countryIds);
    parts.push(`(${columns.country} IN (${list.sql}) OR ${columns.country} = 0)`);
    params.push(...list.params);
  }
  if (scope.cityId && columns.city) {
    parts.push(`(${columns.city} = ? OR ${columns.city} = 0)`);
    params.push(scope.cityId);
  }
  return { sql: parts.join(' AND '), params };
}

export { pickCompanyFilter };
