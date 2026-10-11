import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GOLD_STORE_MAX_MIN_LISTINGS, GOLD_STORE_MIN_LISTINGS } from './gold.stores';

describe('gold stores constants', () => {
  it('requires three to four properly posted ads for a brand storefront', () => {
    assert.equal(GOLD_STORE_MIN_LISTINGS, 3);
    assert.equal(GOLD_STORE_MAX_MIN_LISTINGS, 4);
    assert.ok(GOLD_STORE_MIN_LISTINGS >= 3);
    assert.ok(GOLD_STORE_MAX_MIN_LISTINGS <= 4);
  });
});
