import type { Request, RequestHandler } from 'express';
import { AppError, ErrorCode, forbidden, unauthenticated } from '../../core/errors';
import { recordAudit } from '../../middleware/audit';
import { hasPermission } from '../../middleware/authorize';
import { grantHoldsPermission, type GrantScope, type PrincipalGrant } from '../../middleware/grants';
import type { AuthPrincipal } from '../../types/express';

export interface ScopedResource {
  ownerId?: number | null;
  countryId?: number | null;
  regionId?: number | null;
  cityId?: number | null;
  marketplaceId?: number | null;
  categoryId?: number | null;
  businessId?: number | null;
  departmentId?: number | null;
  teamId?: number | null;
  assignedUserIds?: number[];
}

export interface ScopeSql {
  sql: string;
  params: Array<string | number>;
}

const GEO_SCOPES = new Set(['COUNTRY', 'REGION', 'PROVINCE', 'STATE', 'CITY']);

export function matchingGrants(auth: AuthPrincipal, permission: string): PrincipalGrant[] {
  return (auth.grants ?? []).filter((grant) => grantHoldsPermission(grant, permission));
}

export function isUnrestricted(auth: AuthPrincipal, permission: string): boolean {
  if (hasPermission(auth.permissions, '*')) return true;
  return matchingGrants(auth, permission).some((grant) => grant.scope.type === 'GLOBAL');
}

/** Prefer the broadest matching permission so company roles with `listing.view` still scope correctly. */
export function effectivePermission(auth: AuthPrincipal, candidates: string[]): string {
  for (const code of candidates) {
    if (hasPermission(auth.permissions, code)) return code;
  }
  return candidates[0] ?? '';
}

export function scopeIds(auth: AuthPrincipal, permission: string, field: keyof GrantScope): number[] {
  const ids = new Set<number>();
  for (const grant of matchingGrants(auth, permission)) {
    const value = grant.scope[field];
    if (typeof value === 'number') ids.add(value);
  }
  return [...ids];
}

/**
 * SQL fragment restricting a list query to the caller's grants for `permission`.
 * Column names are caller-supplied (code-controlled), never user input.
 */
export function scopeSql(
  auth: AuthPrincipal,
  permission: string,
  columns: {
    ownerId?: string;
    countryId?: string;
    regionId?: string;
    cityId?: string;
    marketplaceId?: string;
    categoryId?: string;
    businessId?: string;
    departmentId?: string;
    teamId?: string;
    assignmentTable?: string;
  },
): ScopeSql {
  if (isUnrestricted(auth, permission)) return { sql: '1 = 1', params: [] };

  const grants = matchingGrants(auth, permission);
  if (grants.length === 0) return { sql: '1 = 0', params: [] };

  const parts: string[] = [];
  const params: Array<string | number> = [];

  for (const grant of grants) {
    const scope = grant.scope;
    switch (scope.type) {
      case 'GLOBAL':
        return { sql: '1 = 1', params: [] };
      case 'COUNTRY':
        if (columns.countryId && scope.countryId) {
          parts.push(`${columns.countryId} = ?`);
          params.push(scope.countryId);
        }
        break;
      case 'REGION':
      case 'PROVINCE':
      case 'STATE':
        if (columns.regionId && scope.regionId) {
          parts.push(`${columns.regionId} = ?`);
          params.push(scope.regionId);
        }
        break;
      case 'CITY':
        if (columns.cityId && scope.cityId) {
          parts.push(`${columns.cityId} = ?`);
          params.push(scope.cityId);
        }
        break;
      case 'MARKETPLACE':
        if (columns.marketplaceId && scope.marketplaceId) {
          parts.push(`${columns.marketplaceId} = ?`);
          params.push(scope.marketplaceId);
        }
        break;
      case 'CATEGORY':
        if (columns.categoryId && scope.categoryId) {
          parts.push(`${columns.categoryId} = ?`);
          params.push(scope.categoryId);
        }
        break;
      case 'COMPANY':
        if (columns.businessId && scope.businessId) {
          parts.push(`${columns.businessId} = ?`);
          params.push(scope.businessId);
        }
        break;
      case 'DEPARTMENT':
        if (columns.departmentId && scope.departmentId) {
          parts.push(`${columns.departmentId} = ?`);
          params.push(scope.departmentId);
        }
        break;
      case 'TEAM':
        if (columns.teamId && scope.teamId) {
          parts.push(`${columns.teamId} = ?`);
          params.push(scope.teamId);
        }
        break;
      case 'OWN':
        if (columns.ownerId) {
          parts.push(`${columns.ownerId} = ?`);
          params.push(auth.userId);
        }
        break;
      case 'ASSIGNED':
        if (columns.assignmentTable) {
          parts.push(
            `${columns.assignmentTable} IN (SELECT listing_id FROM listing_assignments WHERE user_id = ? AND revoked_at IS NULL)`,
          );
          params.push(auth.userId);
        }
        if (columns.ownerId) {
          parts.push(`${columns.ownerId} = ?`);
          params.push(auth.userId);
        }
        break;
      default:
        break;
    }
  }

  if (parts.length === 0) return { sql: '1 = 0', params: [] };
  return { sql: `(${parts.join(' OR ')})`, params };
}

export function resourceInScope(auth: AuthPrincipal, permission: string, resource: ScopedResource): boolean {
  if (isUnrestricted(auth, permission)) return true;
  const grants = matchingGrants(auth, permission);
  if (grants.length === 0) return false;

  return grants.some((grant) => {
    const scope = grant.scope;
    switch (scope.type) {
      case 'GLOBAL':
        return true;
      case 'COUNTRY':
        return scope.countryId != null && scope.countryId === resource.countryId;
      case 'REGION':
      case 'PROVINCE':
      case 'STATE':
        return scope.regionId != null && scope.regionId === resource.regionId;
      case 'CITY':
        return scope.cityId != null && scope.cityId === resource.cityId;
      case 'MARKETPLACE':
        return scope.marketplaceId != null && scope.marketplaceId === resource.marketplaceId;
      case 'CATEGORY':
        return scope.categoryId != null && scope.categoryId === resource.categoryId;
      case 'COMPANY':
        return scope.businessId != null && scope.businessId === resource.businessId;
      case 'DEPARTMENT':
        return scope.departmentId != null && scope.departmentId === resource.departmentId;
      case 'TEAM':
        return scope.teamId != null && scope.teamId === resource.teamId;
      case 'OWN':
        return resource.ownerId != null && resource.ownerId === auth.userId;
      case 'ASSIGNED':
        return (
          (resource.ownerId != null && resource.ownerId === auth.userId) ||
          (resource.assignedUserIds ?? []).includes(auth.userId)
        );
      default:
        return false;
    }
  });
}

export function assertResourceInScope(auth: AuthPrincipal, permission: string, resource: ScopedResource): void {
  if (!resourceInScope(auth, permission, resource)) {
    throw forbidden('This resource is outside your authorised scope');
  }
}

export function principal(req: Request): AuthPrincipal {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}

/** Admin Control Plane entry: permission-based, not a role-name or isAdmin flag. */
export const requireAdminAccess: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthenticated());
  if (hasPermission(req.auth.permissions, 'admin.access') || hasPermission(req.auth.permissions, '*')) {
    return next();
  }
  return next(forbidden('Admin Control Plane access required'));
};

export const requireMfaIf =
  (needed: boolean): RequestHandler =>
  (req, _res, next) => {
    if (!needed) return next();
    if (!req.auth) return next(unauthenticated());
    if (!req.auth.mfaSatisfied) {
      return next(
        new AppError('Additional verification required', { status: 401, code: ErrorCode.MFA_REQUIRED }),
      );
    }
    next();
  };

export async function writeAdminAudit(params: {
  req: Request;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  permission: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  organizationId?: number | null;
}): Promise<void> {
  const auth = params.req.auth;
  await recordAudit({
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    actorType: 'admin',
    actorId: auth?.userId ?? null,
    permissionCode: params.permission,
    roleCode: auth?.roles[0] ?? null,
    reason: params.reason ?? null,
    before: params.before,
    after: params.after,
    organizationId: params.organizationId ?? null,
  });
}

export { GEO_SCOPES };
