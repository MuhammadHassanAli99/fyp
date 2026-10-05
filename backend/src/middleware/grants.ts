import { queryRows, type Row } from '../db/query';
import { remember, cacheKeys } from '../config/cache';

export const SCOPE_TYPES = [
  'GLOBAL',
  'COUNTRY',
  'REGION',
  'PROVINCE',
  'STATE',
  'CITY',
  'MARKETPLACE',
  'CATEGORY',
  'COMPANY',
  'DEPARTMENT',
  'TEAM',
  'OWN',
  'ASSIGNED',
] as const;

export type ScopeType = (typeof SCOPE_TYPES)[number];

export interface GrantScope {
  type: ScopeType;
  countryId: number | null;
  regionId: number | null;
  cityId: number | null;
  marketplaceId: number | null;
  categoryId: number | null;
  businessId: number | null;
  departmentId: number | null;
  teamId: number | null;
}

export interface PrincipalGrant {
  role: string;
  isStaff: boolean;
  permissions: string[];
  scope: GrantScope;
}

export interface LoadedGrants {
  roles: string[];
  permissions: string[];
  isStaff: boolean;
  grants: PrincipalGrant[];
  scopes: GrantScope[];
}

const GLOBAL_SCOPE: GrantScope = {
  type: 'GLOBAL',
  countryId: null,
  regionId: null,
  cityId: null,
  marketplaceId: null,
  categoryId: null,
  businessId: null,
  departmentId: null,
  teamId: null,
};

function scopeKey(scope: GrantScope): string {
  return [
    scope.type,
    scope.countryId,
    scope.regionId,
    scope.cityId,
    scope.marketplaceId,
    scope.categoryId,
    scope.businessId,
    scope.departmentId,
    scope.teamId,
  ].join(':');
}

function collapseGrants(rows: Array<{ role: string; isStaff: boolean; permission: string | null; scope: GrantScope }>): PrincipalGrant[] {
  const map = new Map<string, PrincipalGrant>();
  for (const row of rows) {
    const key = `${row.role}|${scopeKey(row.scope)}`;
    let grant = map.get(key);
    if (!grant) {
      grant = { role: row.role, isStaff: row.isStaff, permissions: [], scope: row.scope };
      map.set(key, grant);
    }
    if (row.permission && !grant.permissions.includes(row.permission)) {
      grant.permissions.push(row.permission);
    }
  }
  return [...map.values()];
}

/**
 * Union of legacy `user_roles` (GLOBAL, or MARKETPLACE when marketplace_id is set)
 * and `user_role_assignments` (explicit scopes). Never trust client-supplied
 * role/permission/scope — this is the only source of grants.
 */
export async function loadPrincipalGrants(userId: number): Promise<LoadedGrants> {
  return remember(cacheKeys.permissions(userId), 120, async () => {
    const [legacy, assigned] = await Promise.all([
      queryRows<Row>(
        `SELECT r.code AS role_code, r.is_staff, ur.marketplace_id, p.code AS permission_code
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           LEFT JOIN role_permissions rp ON rp.role_id = r.id
           LEFT JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = ?
            AND (ur.expires_at IS NULL OR ur.expires_at > CURRENT_TIMESTAMP)`,
        [userId],
      ),
      queryRows<Row>(
        `SELECT r.code AS role_code, r.is_staff, p.code AS permission_code,
                ura.scope_type, ura.country_id, ura.region_id, ura.city_id,
                ura.marketplace_id, ura.category_id, ura.business_id, ura.department_id, ura.team_id
           FROM user_role_assignments ura
           JOIN roles r ON r.id = ura.role_id
           LEFT JOIN role_permissions rp ON rp.role_id = r.id
           LEFT JOIN permissions p ON p.id = rp.permission_id
          WHERE ura.user_id = ?
            AND ura.revoked_at IS NULL
            AND (ura.expires_at IS NULL OR ura.expires_at > CURRENT_TIMESTAMP)`,
        [userId],
      ),
    ]);

    const flattened: Array<{ role: string; isStaff: boolean; permission: string | null; scope: GrantScope }> = [];

    for (const row of legacy) {
      const marketplaceId = row.marketplace_id === null ? null : Number(row.marketplace_id);
      flattened.push({
        role: String(row.role_code),
        isStaff: Number(row.is_staff) === 1,
        permission: row.permission_code ? String(row.permission_code) : null,
        scope: marketplaceId
          ? { ...GLOBAL_SCOPE, type: 'MARKETPLACE', marketplaceId }
          : GLOBAL_SCOPE,
      });
    }

    for (const row of assigned) {
      flattened.push({
        role: String(row.role_code),
        isStaff: Number(row.is_staff) === 1,
        permission: row.permission_code ? String(row.permission_code) : null,
        scope: {
          type: String(row.scope_type) as ScopeType,
          countryId: row.country_id === null ? null : Number(row.country_id),
          regionId: row.region_id === null ? null : Number(row.region_id),
          cityId: row.city_id === null ? null : Number(row.city_id),
          marketplaceId: row.marketplace_id === null ? null : Number(row.marketplace_id),
          categoryId: row.category_id === null ? null : Number(row.category_id),
          businessId: row.business_id === null ? null : Number(row.business_id),
          departmentId: row.department_id === null ? null : Number(row.department_id),
          teamId: row.team_id === null ? null : Number(row.team_id),
        },
      });
    }

    const grants = collapseGrants(flattened);
    const roles = [...new Set(grants.map((grant) => grant.role))];
    const permissions = [...new Set(grants.flatMap((grant) => grant.permissions))];
    const isStaff = grants.some((grant) => grant.isStaff);
    const scopes = grants.map((grant) => grant.scope);

    return { roles, permissions, isStaff, grants, scopes };
  });
}

export function permissionHeld(permissions: readonly string[], needed: string): boolean {
  return (
    permissions.includes(needed) ||
    permissions.includes('*') ||
    permissions.includes(`${needed.split('.')[0]}.*`)
  );
}

export function grantHoldsPermission(grant: PrincipalGrant, needed: string): boolean {
  return permissionHeld(grant.permissions, needed);
}
