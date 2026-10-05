import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PROPERTY_FRAUD_AUTO_BAN,
  canReviewApplication,
  canTransitionLease,
  isTypeOperationAllowed,
  mapTypeOperation,
  riskBand,
} from './property.rules';

describe('property type vs transaction type', () => {
  it('allows buy and rent on apartments', () => {
    assert.equal(isTypeOperationAllowed(['buy', 'sell', 'rent'], 'rent'), true);
    assert.equal(isTypeOperationAllowed(['buy', 'sell', 'rent'], 'buy'), true);
  });

  it('rejects rent on land plots', () => {
    assert.equal(isTypeOperationAllowed(['buy', 'sell'], 'rent'), false);
  });

  it('maps auction and exchange onto sell', () => {
    assert.equal(mapTypeOperation('auction'), 'sell');
    assert.equal(mapTypeOperation('exchange'), 'sell');
    assert.equal(isTypeOperationAllowed(['buy', 'sell'], 'auction'), true);
  });

  it('does not block every listing when allowed operations failed to parse', () => {
    assert.equal(isTypeOperationAllowed([], 'rent'), true);
  });
});

describe('rental application and lease lifecycle', () => {
  it('allows landlord review only while submitted or under review', () => {
    assert.equal(canReviewApplication('submitted'), true);
    assert.equal(canReviewApplication('under_review'), true);
    assert.equal(canReviewApplication('accepted'), false);
    assert.equal(canReviewApplication('rejected'), false);
  });

  it('activates a lease only from pending signature', () => {
    assert.equal(canTransitionLease('pending_signature', 'active'), true);
    assert.equal(canTransitionLease('active', 'terminated'), true);
    assert.equal(canTransitionLease('cancelled', 'active'), false);
    assert.equal(canTransitionLease('expired', 'active'), false);
  });
});

describe('property fraud scoring', () => {
  it('never auto-bans from a single risk pipeline', () => {
    assert.equal(PROPERTY_FRAUD_AUTO_BAN, false);
  });

  it('bands scores without treating a single medium signal as high', () => {
    assert.equal(riskBand(15), 'low');
    assert.equal(riskBand(40), 'medium');
    assert.equal(riskBand(70), 'high');
  });
});
