import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeFineGoldWeight, mapMakingChargeType, netGoldWeight, toGrams } from './gold.weights';

describe('gold weights', () => {
  it('converts tola and ounce to grams', () => {
    assert.equal(toGrams('1', 'tola'), '11.664');
    assert.equal(toGrams('1', 'ounce'), '31.104');
    assert.equal(toGrams('2', 'kg'), '2000.000');
  });

  it('nets stone weight from gross', () => {
    assert.equal(netGoldWeight('10.500', '1.250'), '9.250');
    assert.equal(netGoldWeight('1', '2'), '0.000');
  });

  it('computes fine gold from fineness or karat', () => {
    assert.equal(computeFineGoldWeight('10', 916, 22), '9.160');
    assert.equal(computeFineGoldWeight('10', null, 24), '9.990');
  });

  it('maps making charge aliases', () => {
    assert.equal(mapMakingChargeType('FIXED'), 'flat');
    assert.equal(mapMakingChargeType('PER_GRAM'), 'per_gram');
    assert.equal(mapMakingChargeType('PERCENTAGE'), 'percent');
    assert.equal(mapMakingChargeType('nope'), undefined);
  });
});
