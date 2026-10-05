import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canTransitionTransaction,
  compatStatus,
  isPubliclySearchable,
  type ListingDimensions,
} from './listings.lifecycle';

describe('listing concurrency invariants', () => {
  it('prevents a second sale from reserved once sold', () => {
    assert.equal(canTransitionTransaction('reserved', 'sold'), true);
    assert.equal(canTransitionTransaction('sold', 'sold'), true);
    assert.equal(canTransitionTransaction('sold', 'reserved'), false);
    assert.equal(canTransitionTransaction('sold', 'rented'), false);
  });

  it('keeps sold listings out of public search while preserving history', () => {
    const sold: ListingDimensions = {
      lifecycleStatus: 'published',
      transactionStatus: 'sold',
      moderationStatus: 'approved',
      expirationStatus: 'active',
    };
    assert.equal(compatStatus(sold), 'sold');
    assert.equal(isPubliclySearchable(sold), false);
  });

  it('allows two different promotion types conceptually without a combo status', () => {
    const published: ListingDimensions = {
      lifecycleStatus: 'published',
      transactionStatus: 'available',
      moderationStatus: 'approved',
      expirationStatus: 'active',
    };
    assert.equal(compatStatus(published), 'published');
    assert.notEqual(compatStatus(published), 'featured_boosted');
  });
});
