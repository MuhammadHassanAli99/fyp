import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePropertyQuery } from './property.search';

describe('property query parser', () => {
  it('parses house for sale in a city', () => {
    const parsed = parsePropertyQuery('house for sale in Lahore');
    assert.equal(parsed.operation, 'sell');
    assert.equal(parsed.propertyKind, 'house');
    assert.equal(parsed.cityHint, 'Lahore');
  });

  it('parses bedroom rental apartments', () => {
    const parsed = parsePropertyQuery('3 bedroom apartment for rent');
    assert.equal(parsed.operation, 'rent');
    assert.equal(parsed.propertyKind, 'apartment');
    assert.equal(parsed.bedroomsMin, 3);
  });

  it('parses commercial plots', () => {
    const parsed = parsePropertyQuery('commercial plot');
    assert.equal(parsed.propertyKind, 'commercial_plot');
    assert.equal(parsed.usageType, 'land');
  });

  it('parses hospitality stays separately from long-term houses', () => {
    const parsed = parsePropertyQuery('hotel in Karachi');
    assert.equal(parsed.propertyKind, 'hotel');
    assert.equal(parsed.cityHint, 'Karachi');
  });
});
