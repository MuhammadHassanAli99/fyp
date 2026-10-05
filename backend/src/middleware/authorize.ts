import type { Request, RequestHandler } from 'express';
import { AppError, ErrorCode, forbidden, unauthenticated } from '../core/errors';
import { queryRows, type Row } from '../db/query';
import { remember } from '../config/cache';

/** RBAC: any of the listed roles. */
export const requireRole =
  (...roles: string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) return next(unauthenticated());
    if (!roles.some((role) => req.auth!.roles.includes(role))) {
      return next(forbidden(`Requires one of: ${roles.join(', ')}`));
    }
    next();
  };

/** RBAC: a specific permission, e.g. `listing.moderate`. */
export function hasPermission(granted: readonly string[], needed: string): boolean {
  return (
    granted.includes(needed) ||
    granted.includes('*') ||
    granted.includes(`${needed.split('.')[0]}.*`)
  );
}

export const requirePermission =
  (...permissions: string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) return next(unauthenticated());
    const granted = req.auth.permissions;
    const has = permissions.some((needed) => hasPermission(granted, needed));
    if (!has) return next(forbidden(`Missing permission: ${permissions.join(' or ')}`));
    next();
  };

export const requireStaff: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthenticated());
  if (!req.auth.isStaff) return next(forbidden('Staff access required'));
  next();
};

/** Blocks guests with a clear, actionable code (§1 restrictions). */
export const denyGuest =
  (action = 'perform this action'): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) {
      return next(
        new AppError(`Sign in to ${action}`, { status: 403, code: ErrorCode.GUEST_NOT_ALLOWED }),
      );
    }
    next();
  };

/* -------------------------------------------------------------------------- */
/* ABAC                                                                       */
/* -------------------------------------------------------------------------- */

interface PolicyRow extends Row {
  code: string;
  effect: 'allow' | 'deny';
  condition_json: Record<string, unknown> | string;
  priority: number;
}

export interface PolicySubject {
  userId: number;
  roles: string[];
  permissions: string[];
  isStaff: boolean;
  subscriptionTier?: string | null;
  trustBand?: string | null;
  countryId?: number | null;
  businessIds?: number[];
}

export interface PolicyResource {
  ownerId?: number | null;
  marketplaceId?: number | null;
  status?: string | null;
  countryId?: number | null;
  businessId?: number | null;
  assignedTo?: number | null;
  assignedUserIds?: unknown;
  departmentId?: number | null;
  teamId?: number | null;
  [key: string]: unknown;
}

const loadPolicies = (resource: string, action: string) =>
  remember(`abac:${resource}:${action}`, 300, () =>
    queryRows<PolicyRow>(
      `SELECT code, effect, condition_json, priority
         FROM access_policies
        WHERE resource = ? AND action = ? AND is_active = 1
        ORDER BY priority ASC`,
      [resource, action],
    ),
  );

/**
 * Evaluates a single condition object against subject + resource.
 * Supported keys mirror the seeded policies:
 *   { "owner": true }                    the subject owns the resource
 *   { "roles": ["moderator"] }           subject holds one of these roles
 *   { "permissions": ["listing.edit"] }
 *   { "staff": true }
 *   { "status": ["draft","rejected"] }   resource is in one of these states
 *   { "sameCountry": true }
 *   { "subscriptionTier": ["business"] }
 *   { "trustBand": ["silver","gold"] }
 */
function conditionHolds(condition: Record<string, unknown>, subject: PolicySubject, resource: PolicyResource): boolean {
  for (const [key, expected] of Object.entries(condition)) {
    switch (key) {
      case 'owner':
        if (Boolean(expected) !== (resource.ownerId != null && resource.ownerId === subject.userId)) return false;
        break;
      case 'staff':
        if (Boolean(expected) !== subject.isStaff) return false;
        break;
      case 'roles':
        if (!asArray(expected).some((role) => subject.roles.includes(role))) return false;
        break;
      case 'permissions':
        if (!asArray(expected).some((permission) => subject.permissions.includes(permission))) return false;
        break;
      case 'status':
        if (!resource.status || !asArray(expected).includes(resource.status)) return false;
        break;
      case 'marketplaceId':
        if (resource.marketplaceId == null || !asArray(expected).map(Number).includes(resource.marketplaceId)) return false;
        break;
      case 'sameCountry':
        if (Boolean(expected) && (subject.countryId == null || subject.countryId !== resource.countryId)) return false;
        break;
      case 'subscriptionTier':
        if (!subject.subscriptionTier || !asArray(expected).includes(subject.subscriptionTier)) return false;
        break;
      case 'trustBand':
        if (!subject.trustBand || !asArray(expected).includes(subject.trustBand)) return false;
        break;
      case 'sameCompany':
      case 'businessId': {
        const companyId = Number(resource.businessId ?? resource.companyId ?? NaN);
        if (!Number.isFinite(companyId) || !(subject.businessIds ?? []).includes(companyId)) return false;
        break;
      }
      case 'assignedTo': {
        if (resource.assignedTo === subject.userId) break;
        const assigned = Array.isArray(resource.assignedUserIds) ? resource.assignedUserIds.map(Number) : [];
        if (!assigned.includes(subject.userId)) return false;
        break;
      }
      case 'notStatus':
        if (resource.status && asArray(expected).includes(resource.status)) return false;
        break;
      case 'transactionStatus':
        if (!resource.status || !asArray(expected).includes(String(resource.status))) return false;
        break;
      default:
        // An unknown key must not silently grant access.
        return false;
    }
  }
  return true;
}

const asArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)];

/**
 * Deny-overrides evaluation: the first matching `deny` wins, otherwise any
 * matching `allow` grants. No matching policy means denied.
 */
export async function evaluatePolicy(
  resourceType: string,
  action: string,
  subject: PolicySubject,
  resource: PolicyResource,
): Promise<{ allowed: boolean; matched: string | null }> {
  const policies = await loadPolicies(resourceType, action);
  let allowedBy: string | null = null;

  for (const policy of policies) {
    const condition =
      typeof policy.condition_json === 'string'
        ? (JSON.parse(policy.condition_json) as Record<string, unknown>)
        : policy.condition_json;
    if (!conditionHolds(condition, subject, resource)) continue;
    if (policy.effect === 'deny') return { allowed: false, matched: policy.code };
    allowedBy ??= policy.code;
  }

  return { allowed: allowedBy !== null, matched: allowedBy };
}

export const subjectFromRequest = (req: Request): PolicySubject => {
  if (!req.auth) throw unauthenticated();
  return {
    userId: req.auth.userId,
    roles: req.auth.roles,
    permissions: req.auth.permissions,
    isStaff: req.auth.isStaff,
    countryId: req.context.countryId,
    businessIds: [...new Set((req.auth.grants ?? []).map((grant) => grant.scope.businessId).filter((id): id is number => typeof id === 'number'))],
  };
};

/**
 * Resource-level guard. `load` fetches just enough of the resource to decide;
 * services should reuse the loaded value rather than fetching twice.
 */
export const authorizeResource = (
  resourceType: string,
  action: string,
  load: (req: Request) => Promise<PolicyResource | null>,
): RequestHandler =>
  (req, _res, next) => {
    void (async () => {
      if (!req.auth) throw unauthenticated();
      const resource = await load(req);
      if (!resource) throw new AppError(`${resourceType} not found`, { status: 404, code: ErrorCode.NOT_FOUND });

      const policies = await loadPolicies(resourceType, action);
      if (policies.length === 0) {
        if (resource.ownerId != null && resource.ownerId === req.auth.userId) return next();
        if (req.auth.isStaff) return next();
        throw forbidden(`Not allowed to ${action} this ${resourceType}`);
      }

      const decision = await evaluatePolicy(resourceType, action, subjectFromRequest(req), resource);
      if (!decision.allowed) throw forbidden(`Not allowed to ${action} this ${resourceType}`);
      next();
    })().catch(next);
  };

/** In-code ownership assertion for use inside services. */
export function assertOwner(ownerId: number | null | undefined, userId: number | null | undefined, isStaff = false): void {
  if (isStaff) return;
  if (ownerId == null || userId == null || ownerId !== userId) {
    throw forbidden('You can only modify your own records');
  }
}
