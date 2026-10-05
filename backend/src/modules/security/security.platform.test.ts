import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signAccessToken, verifyAccessToken } from '../../core/security/tokens';
import { assertPublicHttpUrl } from '../../core/security/ssrf';
import { ErrorCode } from '../../core/errors';
import { GDPR_COUNTRY_CODES } from './security.types';
import { resolvePrivacyKind } from './security.privacy';
import { listingMutationBlocked, resourceInPrincipalScope } from './security.authz';
import type { AuthPrincipal } from '../../types/express';
import { AppError } from '../../core/errors';

describe('platform security layer', () => {
  it('issues access tokens without roles, permissions, or profile claims', () => {
    const issued = signAccessToken({ sub: '9', sid: '44', mfa: false });
    const claims = verifyAccessToken(issued.token);
    assert.equal(claims.sub, '9');
    assert.equal(claims.sid, '44');
    assert.equal(claims.typ, 'access');
    assert.equal(claims.roles, undefined);
    assert.equal(claims.perms, undefined);
    assert.equal('cty' in claims, false);
  });

  it('blocks SSRF to loopback and link-local metadata', () => {
    assert.throws(() => assertPublicHttpUrl('http://127.0.0.1/secret'), (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, ErrorCode.SSRF_BLOCKED);
      return true;
    });
    assert.throws(() => assertPublicHttpUrl('http://169.254.169.254/latest/meta-data'));
    assert.throws(() => assertPublicHttpUrl('http://localhost/admin'));
    const ok = assertPublicHttpUrl('https://example.com/callback');
    assert.equal(ok.hostname, 'example.com');
  });

  it('maps GDPR/CCPA applicability by country and privacy kind aliases', () => {
    assert.equal(GDPR_COUNTRY_CODES.has('DE'), true);
    assert.equal(GDPR_COUNTRY_CODES.has('US'), false);
    assert.equal(resolvePrivacyKind('deletion'), 'erasure');
    assert.equal(resolvePrivacyKind('access'), 'export');
    assert.equal(resolvePrivacyKind('opt_out'), 'restriction');
  });

  it('blocks salesman mutations on sold listings and scopes assigned resources', () => {
    assert.equal(listingMutationBlocked({ transactionStatus: 'sold' }, false), true);
    assert.equal(listingMutationBlocked({ transactionStatus: 'sold' }, true), false);
    assert.equal(listingMutationBlocked({ transactionStatus: 'available' }, false), false);

    const salesman: AuthPrincipal = {
      userId: 8,
      sessionId: 1,
      roles: ['salesman'],
      permissions: ['listing.update'],
      grants: [
        {
          role: 'salesman',
          isStaff: false,
          permissions: ['listing.update'],
          scope: {
            type: 'ASSIGNED',
            countryId: null,
            regionId: null,
            cityId: null,
            marketplaceId: null,
            categoryId: null,
            businessId: 3,
            departmentId: null,
            teamId: null,
          },
        },
      ],
      scopes: [],
      mfaSatisfied: true,
      isStaff: false,
      status: 'active',
      emailVerified: true,
      phoneVerified: true,
    };

    assert.equal(resourceInPrincipalScope(salesman, 'listing.update', { assignedTo: 8, businessId: 3 }), true);
    assert.equal(resourceInPrincipalScope(salesman, 'listing.update', { assignedTo: 99, businessId: 3 }), false);
    assert.equal(
      resourceInPrincipalScope(salesman, 'listing.update', { ownerId: 1, businessId: 9, assignedTo: 1 }),
      false,
    );
  });
});
