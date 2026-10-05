import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  VEHICLE_FRAUD_AUTO_BAN,
  isTypeOperationAllowed,
  mapTypeOperation,
  riskBand,
} from './vehicles.rules';

describe('vehicle type vs transaction type', () => {
  it('allows buy sell rent and auction on cars', () => {
    const allowed = ['buy', 'sell', 'rent', 'auction'];
    assert.equal(isTypeOperationAllowed(allowed, 'rent'), true);
    assert.equal(isTypeOperationAllowed(allowed, 'buy'), true);
    assert.equal(isTypeOperationAllowed(allowed, 'auction'), true);
  });

  it('maps auction and exchange onto sell when the catalogue only lists sell', () => {
    assert.equal(mapTypeOperation('auction'), 'sell');
    assert.equal(mapTypeOperation('exchange'), 'sell');
    assert.equal(isTypeOperationAllowed(['buy', 'sell'], 'auction'), true);
  });

  it('does not block every listing when allowed operations failed to parse', () => {
    assert.equal(isTypeOperationAllowed([], 'rent'), true);
  });
});

describe('vehicle fraud scoring', () => {
  it('never auto-bans from a single risk pipeline', () => {
    assert.equal(VEHICLE_FRAUD_AUTO_BAN, false);
  });

  it('bands scores without treating a single medium signal as high', () => {
    assert.equal(riskBand(15), 'low');
    assert.equal(riskBand(40), 'medium');
    assert.equal(riskBand(70), 'high');
  });
});
