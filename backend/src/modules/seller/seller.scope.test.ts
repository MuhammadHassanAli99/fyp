import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectPersona,
  listingScopeSql,
  pickCompanyFilter,
  pickMarketplaceId,
  resolvePeriod,
  salesLeadScopeSql,
  spendScopeSql,
  vehicleLeadScopeSql,
  type SellerScope,
} from './seller.scope';

function scope(partial: Partial<SellerScope> & Pick<SellerScope, 'persona'>): SellerScope {
  return {
    userId: 100,
    roles: [],
    businessIds: [],
    teamIds: [],
    teamMemberIds: [],
    marketplaceId: null,
    allowedMarketplaceIds: null,
    countryIds: null,
    filterBusinessId: null,
    period: { from: '2026-08-01', to: '2026-08-19', days: 19, label: '30d' },
    ...partial,
  };
}

describe('seller dashboard scope', () => {
  it('detects company admin from role packs and membership, not from listing.view', () => {
    assert.equal(detectPersona(['seller'], []), 'individual');
    assert.equal(detectPersona(['company_salesman'], []), 'salesman');
    assert.equal(detectPersona(['sales_manager'], []), 'sales_manager');
    assert.equal(detectPersona(['company_admin'], []), 'company_admin');
    assert.equal(detectPersona(['seller'], ['admin']), 'company_admin');
    assert.equal(detectPersona(['seller'], ['viewer']), 'individual');
  });

  it('never expands GLOBAL listing.view into 1 = 1', () => {
    const sql = listingScopeSql(scope({ persona: 'individual', roles: ['seller'] }));
    assert.equal(sql.sql.includes('1 = 1'), false);
    assert.match(sql.sql, /l\.user_id = \?/);
    assert.match(sql.sql, /listing_assignments/);
    assert.match(sql.sql, /listing_grants/);
    assert.equal(sql.sql.includes('business_id IN'), false);
  });

  it('keeps a salesman off other company listings', () => {
    const sql = listingScopeSql(
      scope({
        persona: 'salesman',
        businessIds: [9401, 77],
        userId: 9308,
      }),
    );
    assert.equal(sql.sql.includes('l.business_id IN'), false);
    assert.deepEqual(sql.params.slice(0, 3), [9308, 9308, 9308]);
  });

  it('lets a company admin see authorized company listings and not a foreign company', () => {
    const sql = listingScopeSql(
      scope({
        persona: 'company_admin',
        businessIds: [9401],
        filterBusinessId: 9401,
      }),
    );
    assert.match(sql.sql, /l\.business_id IN \(\?\)/);
    assert.match(sql.sql, /l\.business_id = \?/);
    assert.equal(sql.params.includes(9401), true);
    assert.equal(sql.params.includes(77), false);
  });

  it('ignores a client marketplace or company that is not authorized', () => {
    assert.equal(pickMarketplaceId(2, [1, 3]), null);
    assert.equal(pickMarketplaceId(1, [1, 3]), 1);
    assert.equal(pickMarketplaceId(2, null), 2);
    assert.equal(pickCompanyFilter(77, [9401]), null);
    assert.equal(pickCompanyFilter(9401, [9401]), 9401);
  });

  it('scopes sales leads so a salesman only sees assigned rows', () => {
    const salesman = salesLeadScopeSql(scope({ persona: 'salesman', userId: 9308, businessIds: [9401] }));
    assert.match(salesman.sql, /assigned_to = \?/);
    assert.deepEqual(salesman.params, [9401, 9308]);

    const admin = salesLeadScopeSql(scope({ persona: 'company_admin', businessIds: [9401] }));
    assert.equal(admin.sql.includes('assigned_to'), false);

    const outsider = salesLeadScopeSql(scope({ persona: 'individual', businessIds: [] }));
    assert.equal(outsider.sql, '1 = 0');
  });

  it('does not give a salesman every vehicle lead in the company', () => {
    const salesman = vehicleLeadScopeSql(scope({ persona: 'salesman', userId: 9308, businessIds: [9401] }));
    assert.equal(salesman.sql.includes('business_id IN'), false);
    assert.match(salesman.sql, /seller_id = \?/);

    const admin = vehicleLeadScopeSql(scope({ persona: 'company_admin', userId: 1, businessIds: [9401] }));
    assert.match(admin.sql, /business_id IN/);
  });

  it('limits spend to the caller unless they are a company admin', () => {
    const salesman = spendScopeSql(scope({ persona: 'salesman', userId: 9308, businessIds: [9401] }));
    assert.equal(salesman.sql, 'o.user_id = ?');
    assert.deepEqual(salesman.params, [9308]);

    const admin = spendScopeSql(scope({ persona: 'company_admin', userId: 1, businessIds: [9401] }));
    assert.match(admin.sql, /business_id IN/);
  });

  it('resolves period windows without trusting an open-ended custom range', () => {
    const month = resolvePeriod({ period: '30d' });
    assert.equal(month.days, 30);
    const custom = resolvePeriod({ period: 'custom', from: '2026-01-01', to: '2026-01-03' });
    assert.equal(custom.from, '2026-01-01');
    assert.equal(custom.to, '2026-01-03');
    assert.equal(custom.days, 3);
  });
});
