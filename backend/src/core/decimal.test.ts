import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDecimal, cmpDecimal, fineGoldWeight, makingChargeAmount, mulDecimal } from './decimal';

describe('decimal money/weight math', () => {
  it('adds without float drift', () => {
    assert.equal(addDecimal('0.1', '0.2', 2), '0.30');
  });

  it('computes fine gold weight as net × fineness/1000', () => {
    assert.equal(fineGoldWeight('10.000', 916), '9.160');
    assert.equal(fineGoldWeight('10', 999), '9.990');
  });

  it('computes making charges by type', () => {
    assert.equal(makingChargeAmount({ type: 'flat', value: '500', netWeightG: '10', metalValue: '1000' }), '500.00');
    assert.equal(makingChargeAmount({ type: 'per_gram', value: '50', netWeightG: '10', metalValue: '1000' }), '500.00');
    assert.equal(makingChargeAmount({ type: 'percent', value: '10', netWeightG: '10', metalValue: '1000' }), '100.00');
  });

  it('compares scaled values', () => {
    assert.equal(cmpDecimal('10.00', '10'), 0);
    assert.ok(cmpDecimal('10.01', '10') > 0);
    assert.equal(mulDecimal('2.5', '4', 2), '10.00');
  });
});
