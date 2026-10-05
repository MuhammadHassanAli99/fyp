import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuthPrincipal } from '../../types/express';
import type { PrincipalGrant } from '../../middleware/grants';
import { assertResourceInScope, effectivePermission, isUnrestricted, resourceInScope, scopeSql } from './admin.authz';
import { HIGH_RISK_REFUND, needsFourEyes, needsMfa } from './admin.approvals';

function grant(partial: Partial<PrincipalGrant> & Pick<PrincipalGrant, 'permissions' | 'scope'>): PrincipalGrant {
  return {
    role: partial.role ?? 'operator',
    isStaff: partial.isStaff ?? true,
    permissions: partial.permissions,
    scope: partial.scope,
  };
}

function auth(input: Partial<AuthPrincipal> & Pick<AuthPrincipal, 'permissions' | 'grants'>): AuthPrincipal {
  return {
    userId: input.userId ?? 10,
    sessionId: 1,
    roles: input.roles ?? ['country_admin'],
    permissions: input.permissions,
    grants: input.grants,
    scopes: input.grants.map((item) => item.scope),
    mfaSatisfied: input.mfaSatisfied ?? true,
    isStaff: input.isStaff ?? true,
    status: 'active',
    emailVerified: true,
    phoneVerified: true,
  };
}

describe('Admin Control Plane authorization', () => {
  it('does not treat a role name as authority', () => {
    const principal = auth({
      roles: ['super_admin'],
      permissions: ['admin.access'],
      grants: [grant({ role: 'super_admin', permissions: ['admin.access'], scope: { type: 'GLOBAL', countryId: null, regionId: null, cityId: null, marketplaceId: null, categoryId: null, businessId: null, departmentId: null, teamId: null } })],
    });
    assert.equal(isUnrestricted(principal, 'payment.view_any'), false);
    assert.equal(resourceInScope(principal, 'payment.view_any', { ownerId: 1 }), false);
  });

  it('keeps a country admin inside Pakistan and blocks other countries', () => {
    const principal = auth({
      permissions: ['user.view_any'],
      grants: [
        grant({
          permissions: ['user.view_any'],
          scope: {
            type: 'COUNTRY',
            countryId: 1,
            regionId: null,
            cityId: null,
            marketplaceId: null,
            categoryId: null,
            businessId: null,
            departmentId: null,
            teamId: null,
          },
        }),
      ],
    });
    assert.equal(resourceInScope(principal, 'user.view_any', { countryId: 1 }), true);
    assert.equal(resourceInScope(principal, 'user.view_any', { countryId: 2 }), false);
    const sql = scopeSql(principal, 'user.view_any', { countryId: 'u.country_id' });
    assert.match(sql.sql, /u\.country_id = \?/);
    assert.deepEqual(sql.params, [1]);
    assert.throws(() => assertResourceInScope(principal, 'user.view_any', { countryId: 99 }));
  });

  it('scopes a company salesman to assigned/company listings and not global payments', () => {
    const principal = auth({
      userId: 9308,
      isStaff: false,
      roles: ['company_salesman'],
      permissions: ['listing.view', 'sales.view', 'admin.access'],
      grants: [
        grant({
          role: 'company_salesman',
          isStaff: false,
          permissions: ['listing.view', 'sales.view', 'admin.access'],
          scope: {
            type: 'COMPANY',
            countryId: null,
            regionId: null,
            cityId: null,
            marketplaceId: null,
            categoryId: null,
            businessId: 9401,
            departmentId: 9501,
            teamId: 9601,
          },
        }),
        grant({
          role: 'company_salesman',
          isStaff: false,
          permissions: ['listing.view', 'sales.view', 'admin.access'],
          scope: {
            type: 'ASSIGNED',
            countryId: null,
            regionId: null,
            cityId: null,
            marketplaceId: null,
            categoryId: null,
            businessId: 9401,
            departmentId: 9501,
            teamId: 9601,
          },
        }),
      ],
    });
    assert.equal(resourceInScope(principal, 'listing.view', { businessId: 9401 }), true);
    assert.equal(resourceInScope(principal, 'listing.view', { businessId: 77 }), false);
    assert.equal(resourceInScope(principal, 'listing.view', { ownerId: 9308, assignedUserIds: [9308] }), true);
    assert.equal(isUnrestricted(principal, 'payment.view_any'), false);
    const payments = scopeSql(principal, 'payment.view_any', { ownerId: 'p.user_id' });
    assert.equal(payments.sql, '1 = 0');
  });

  it('uses listing.view when listing.view_any is absent', () => {
    const principal = auth({
      permissions: ['listing.view'],
      grants: [
        grant({
          permissions: ['listing.view'],
          scope: {
            type: 'OWN',
            countryId: null,
            regionId: null,
            cityId: null,
            marketplaceId: null,
            categoryId: null,
            businessId: null,
            departmentId: null,
            teamId: null,
          },
        }),
      ],
    });
    assert.equal(effectivePermission(principal, ['listing.view_any', 'listing.view']), 'listing.view');
  });

  it('requires four-eyes and MFA for bans and high-value refunds', () => {
    assert.equal(needsFourEyes('user.ban'), true);
    assert.equal(needsFourEyes('refund.create', HIGH_RISK_REFUND), true);
    assert.equal(needsFourEyes('refund.create', 10), false);
    assert.equal(needsMfa('role.assign'), true);
    assert.equal(needsFourEyes('listing.approve'), false);
  });

  it('does not let client-supplied company or country override grants', () => {
    const principal = auth({
      permissions: ['user.view_any'],
      grants: [
        grant({
          permissions: ['user.view_any'],
          scope: {
            type: 'COUNTRY',
            countryId: 1,
            regionId: null,
            cityId: null,
            marketplaceId: null,
            categoryId: null,
            businessId: null,
            departmentId: null,
            teamId: null,
          },
        }),
      ],
    });
    assert.equal(resourceInScope(principal, 'user.view_any', { countryId: 1, businessId: 9401 }), true);
    assert.equal(resourceInScope(principal, 'user.view_any', { countryId: 4, businessId: 9401 }), false);
  });
});
