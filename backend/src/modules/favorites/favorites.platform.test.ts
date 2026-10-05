import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_FOLDER_DEPTH,
  availabilityFromListing,
  availabilityFromPart,
  childDepthIfMoved,
  compareCompatible,
  depthOf,
  isFavoriteEntityType,
  wouldCreateCycle,
} from './favorites.rules';

describe('favorites entity identity', () => {
  it('accepts listing and vehicle_part only', () => {
    assert.equal(isFavoriteEntityType('listing'), true);
    assert.equal(isFavoriteEntityType('vehicle_part'), true);
    assert.equal(isFavoriteEntityType('gold_listing'), false);
  });
});

describe('favorite availability policy', () => {
  it('keeps sold/expired/archived favorites visible as unavailable states', () => {
    assert.equal(availabilityFromListing('published', null), 'available');
    assert.equal(availabilityFromListing('sold', null), 'sold');
    assert.equal(availabilityFromListing('rented', null), 'rented');
    assert.equal(availabilityFromListing('expired', null), 'expired');
    assert.equal(availabilityFromListing('archived', null), 'archived');
    assert.equal(availabilityFromListing('published', new Date()), 'unavailable');
    assert.equal(availabilityFromPart('active', null), 'available');
    assert.equal(availabilityFromPart('sold', null), 'sold');
  });
});

describe('collection folder tree', () => {
  it('rejects circular parent moves', () => {
    const tree = new Map<number, number | null>([
      [1, null],
      [2, 1],
      [3, 2],
    ]);
    assert.equal(wouldCreateCycle(1, 3, tree), true);
    assert.equal(wouldCreateCycle(3, 1, tree), false);
    assert.equal(wouldCreateCycle(2, 2, tree), true);
    assert.equal(wouldCreateCycle(3, null, tree), false);
  });

  it('limits hierarchy depth to 4', () => {
    const tree = new Map<number, number | null>([
      [1, null],
      [2, 1],
      [3, 2],
      [4, 3],
    ]);
    assert.equal(depthOf(1, tree), 1);
    assert.equal(depthOf(4, tree), 4);
    assert.ok(childDepthIfMoved(5, 4, tree) > MAX_FOLDER_DEPTH);
    assert.equal(childDepthIfMoved(5, 3, tree), 4);
  });
});

describe('compare compatibility', () => {
  it('allows same marketplace and entity type only', () => {
    assert.equal(
      compareCompatible({ marketplaceA: 3, marketplaceB: 3, entityTypeA: 'listing', entityTypeB: 'listing' }),
      true,
    );
    assert.equal(
      compareCompatible({ marketplaceA: 1, marketplaceB: 2, entityTypeA: 'listing', entityTypeB: 'listing' }),
      false,
    );
    assert.equal(
      compareCompatible({ marketplaceA: 3, marketplaceB: 3, entityTypeA: 'listing', entityTypeB: 'vehicle_part' }),
      false,
    );
  });
});
