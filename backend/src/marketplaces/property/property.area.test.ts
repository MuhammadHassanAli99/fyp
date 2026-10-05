import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { convertArea, fromSqmDecimal, knownAreaUnit, toSqmDecimal } from './property.area';

describe('property area conversion', () => {
  it('keeps square metres identity', () => {
    assert.equal(toSqmDecimal('5', 'sqm'), '5.0000');
    assert.equal(fromSqmDecimal('5', 'sqm'), '5.0000');
  });

  it('converts marla without destroying the original unit', () => {
    const sqm = toSqmDecimal('5', 'marla');
    assert.equal(sqm, '126.4643');
    assert.equal(convertArea('5', 'marla', 'marla'), '5.0000');
  });

  it('converts kanal to square metres', () => {
    assert.equal(toSqmDecimal('1', 'kanal'), '505.8571');
  });

  it('preserves original acre and hectare values through round-trip conversion', () => {
    assert.equal(convertArea('2', 'acre', 'acre'), '2.0000');
    assert.equal(convertArea('1', 'hectare', 'hectare'), '1.0000');
    assert.equal(toSqmDecimal('1', 'hectare'), '10000.0000');
  });

  it('rejects unknown units', () => {
    assert.equal(knownAreaUnit('furlong'), false);
    assert.throws(() => toSqmDecimal('1', 'furlong'));
  });
});
