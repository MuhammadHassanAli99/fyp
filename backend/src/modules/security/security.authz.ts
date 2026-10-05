import type { Request } from 'express';
import { forbidden, unauthenticated } from '../../core/errors';
import { evaluatePolicy, hasPermission, type PolicyResource, type PolicySubject } from '../../middleware/authorize';
import { grantHoldsPermission, type GrantScope, type PrincipalGrant } from '../../middleware/grants';
import type { AuthPrincipal } from '../../types/express';
import type { SecurityResource } from './security.types';

const TERMINAL_STATUSES = new Set(['sold', 'rented', 'archived', 'deleted', 'removed']);

/**
 * Central authorization: permission → scope → ABAC.
 *
 * Controllers must not hard-code role names. Call `assertAccess` or
 * `evaluateAccess` with a permission code and the resource attributes.
 */
export async function evaluateAccess(params: {
  auth: AuthPrincipal | null;
  permission: string;
  action?: string;
  resourceType?: string;
  resource?: SecurityResource;
}): Promise<{ allowed: boolean; reason: string; matched: string | null }> {
  if (!params.auth) return { allowed: false, reason: 'unauthenticated', matched: null };

  const resource = params.resource ?? {};
  if (!hasPermission(params.auth.permissions, params.permission) && !hasPermission(params.auth.permissions, '*')) {
    return { allowed: false, reason: `missing_permission:${params.permission}`, matched: null };
  }

  if (params.resource && !resourceInPrincipalScope(params.auth, params.permission, resource)) {
    return { allowed: false, reason: 'out_of_scope', matched: null };
  }

  const resourceType = params.resourceType;
  const action = params.action;
  if (resourceType && action) {
    const decision = await evaluatePolicy(resourceType, action, subjectFromAuth(params.auth), toPolicyResource(resource));
    if (!decision.allowed) {
      return { allowed: false, reason: `abac:${decision.matched ?? 'deny'}`, matched: decision.matched };
    }
    return { allowed: true, reason: 'abac', matched: decision.matched };
  }

  return { allowed: true, reason: 'rbac_scope', matched: null };
}

export async function assertAccess(params: Parameters<typeof evaluateAccess>[0]): Promise<void> {
  if (!params.auth) throw unauthenticated();
  const decision = await evaluateAccess(params);
  if (!decision.allowed) throw forbidden('You are not allowed to perform this action');
}

export function listingMutationBlocked(resource: SecurityResource, isStaff: boolean): boolean {
  const status = String(resource.transactionStatus ?? resource.status ?? '').toLowerCase();
  if (!TERMINAL_STATUSES.has(status)) return false;
  return !isStaff;
}

export function resourceInPrincipalScope(auth: AuthPrincipal, permission: string, resource: SecurityResource): boolean {
  if (hasPermission(auth.permissions, '*')) return true;
  const grants = (auth.grants ?? []).filter((grant) => grantHoldsPermission(grant, permission));
  if (grants.length === 0) {
    return resource.ownerId == null || resource.ownerId === auth.userId;
  }
  return grants.some((grant) => scopeCovers(grant, auth.userId, resource));
}

function scopeCovers(grant: PrincipalGrant, userId: number, resource: SecurityResource): boolean {
  const scope = grant.scope;
  const type = normalizeScope(scope.type);
  switch (type) {
    case 'GLOBAL':
      return true;
    case 'COUNTRY':
      return resource.countryId != null && resource.countryId === scope.countryId;
    case 'REGION':
    case 'PROVINCE':
    case 'STATE':
      return resource.regionId != null && resource.regionId === scope.regionId;
    case 'CITY':
      return resource.cityId != null && resource.cityId === scope.cityId;
    case 'MARKETPLACE':
      return resource.marketplaceId != null && resource.marketplaceId === scope.marketplaceId;
    case 'CATEGORY':
      return resource.categoryId != null && resource.categoryId === scope.categoryId;
    case 'COMPANY': {
      const companyId = resource.businessId ?? resource.companyId ?? resource.organizationId ?? null;
      return companyId != null && companyId === scope.businessId;
    }
    case 'DEPARTMENT':
      return resource.departmentId != null && resource.departmentId === scope.departmentId;
    case 'TEAM':
      return resource.teamId != null && resource.teamId === scope.teamId;
    case 'ASSIGNED': {
      if (resource.assignedTo != null && resource.assignedTo === userId) return true;
      return Array.isArray(resource.assignedUserIds) && resource.assignedUserIds.includes(userId);
    }
    case 'OWN':
      return resource.ownerId != null && resource.ownerId === userId;
    default:
      return false;
  }
}

function normalizeScope(type: GrantScope['type'] | string): string {
  return type === 'ORGANIZATION' ? 'COMPANY' : type;
}

function subjectFromAuth(auth: AuthPrincipal): PolicySubject {
  return {
    userId: auth.userId,
    roles: auth.roles,
    permissions: auth.permissions,
    isStaff: auth.isStaff,
  };
}

function toPolicyResource(resource: SecurityResource): PolicyResource {
  return {
    ownerId: resource.ownerId ?? null,
    marketplaceId: resource.marketplaceId ?? null,
    status: resource.transactionStatus ?? resource.status ?? null,
    countryId: resource.countryId ?? null,
    businessId: resource.businessId ?? resource.companyId ?? resource.organizationId ?? null,
    assignedTo: resource.assignedTo ?? null,
    assignedUserIds: resource.assignedUserIds,
    departmentId: resource.departmentId ?? null,
    teamId: resource.teamId ?? null,
  };
}

export function authFromRequest(req: Request): AuthPrincipal {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}
