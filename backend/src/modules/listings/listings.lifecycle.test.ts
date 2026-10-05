import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canTransitionLifecycle,
  canTransitionTransaction,
  canonicalPromotionType,
  compatStatus,
  dimensionsFromLegacyStatus,
  expirationStatusFor,
  isPubliclySearchable,
  isPubliclyViewable,
  LIFECYCLE_STATUSES,
  STAFF_ONLY_LIFECYCLE,
  type ListingDimensions,
} from './listings.lifecycle';

const publishedAvailable: ListingDimensions = {
  lifecycleStatus: 'published',
  transactionStatus: 'available',
  moderationStatus: 'approved',
  expirationStatus: 'active',
};

describe('listing lifecycle dimensions', () => {
  it('keeps lifecycle independent of sold/featured/boosted', () => {
    assert.deepEqual([...LIFECYCLE_STATUSES], [
      'draft',
      'pending_review',
      'published',
      'rejected',
      'expired',
      'archived',
    ]);
    assert.equal(LIFECYCLE_STATUSES.includes('sold' as never), false);
    assert.equal(LIFECYCLE_STATUSES.includes('featured' as never), false);
    assert.equal(LIFECYCLE_STATUSES.includes('rented' as never), false);
  });

  it('maps sold onto transaction while staying published', () => {
    const sold = { ...publishedAvailable, transactionStatus: 'sold' as const };
    assert.equal(compatStatus(sold), 'sold');
    assert.equal(sold.lifecycleStatus, 'published');
    assert.equal(isPubliclySearchable(sold), false);
    assert.equal(isPubliclyViewable(sold), true);
  });

  it('never invents combo statuses such as FEATURED_SOLD', () => {
    const featuredSold = { ...publishedAvailable, transactionStatus: 'sold' as const };
    assert.notEqual(compatStatus(featuredSold), 'featured_sold');
    assert.equal(canonicalPromotionType('feature'), 'featured');
    assert.equal(canonicalPromotionType('boost'), 'boosted');
    assert.equal(canonicalPromotionType('top_of_search'), 'top_search');
  });

  it('allows draft → pending_review → published and rejects owner shortcuts', () => {
    assert.equal(canTransitionLifecycle('draft', 'pending_review'), true);
    assert.equal(canTransitionLifecycle('pending_review', 'published'), true);
    assert.equal(canTransitionLifecycle('draft', 'published'), false);
    assert.equal(STAFF_ONLY_LIFECYCLE.has('published'), true);
    assert.equal(STAFF_ONLY_LIFECYCLE.has('rejected'), true);
  });

  it('models reservation then sale without changing lifecycle', () => {
    assert.equal(canTransitionTransaction('available', 'reserved'), true);
    assert.equal(canTransitionTransaction('reserved', 'sold'), true);
    assert.equal(canTransitionTransaction('sold', 'reserved'), false);
    assert.equal(canTransitionTransaction('sold', 'available'), true);
  });

  it('treats rental occupancy as transaction, not lifecycle', () => {
    const rented = { ...publishedAvailable, transactionStatus: 'rented' as const };
    assert.equal(compatStatus(rented), 'rented');
    assert.equal(rented.lifecycleStatus, 'published');
    assert.equal(isPubliclySearchable(rented), true);
  });

  it('computes expiration independently of publication', () => {
    const now = new Date('2026-08-16T00:00:00Z');
    assert.equal(expirationStatusFor(new Date('2026-08-20T00:00:00Z'), now), 'active');
    assert.equal(expirationStatusFor(new Date('2026-08-17T00:00:00Z'), now), 'expiring');
    assert.equal(expirationStatusFor(new Date('2026-08-15T00:00:00Z'), now), 'expired');
    const expired = { ...publishedAvailable, lifecycleStatus: 'expired' as const, expirationStatus: 'expired' as const };
    assert.equal(isPubliclySearchable(expired), false);
  });

  it('backfills mixed legacy status values into dimensions', () => {
    assert.equal(dimensionsFromLegacyStatus('sold').lifecycleStatus, 'published');
    assert.equal(dimensionsFromLegacyStatus('sold').transactionStatus, 'sold');
    assert.equal(dimensionsFromLegacyStatus('featured' as string).lifecycleStatus, 'draft');
    assert.equal(dimensionsFromLegacyStatus('validating').lifecycleStatus, 'pending_review');
  });
});
