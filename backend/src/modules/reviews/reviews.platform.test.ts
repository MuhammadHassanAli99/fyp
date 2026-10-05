import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  inferEntityType,
  inferReviewType,
  publicStatusFromRow,
  verificationLabel,
  windowExpired,
} from './reviews.types';

describe('Review Platform', () => {
  it('maps published rows to ACTIVE and flagged rows to UNDER_REVIEW', () => {
    assert.equal(publicStatusFromRow('published', null), 'ACTIVE');
    assert.equal(publicStatusFromRow('flagged', null), 'UNDER_REVIEW');
    assert.equal(publicStatusFromRow('published', new Date()), 'HIDDEN');
    assert.equal(publicStatusFromRow('restored', null), 'RESTORED');
  });

  it('uses verification labels the client can show without inventing them', () => {
    assert.equal(verificationLabel('purchase'), 'Verified Purchase');
    assert.equal(verificationLabel('rental'), 'Verified Rental');
    assert.equal(verificationLabel('none'), null);
  });

  it('expires the review window after 90 days', () => {
    const completed = new Date('2026-01-01T00:00:00Z');
    assert.equal(windowExpired(completed, new Date('2026-03-01T00:00:00Z')), false);
    assert.equal(windowExpired(completed, new Date('2026-05-02T00:00:00Z')), true);
  });

  it('picks Gold / Property / Vehicle entity types from marketplace context', () => {
    assert.equal(inferEntityType({ subjectKind: 'listing', businessKind: null, marketplaceCode: 'gold' }), 'listing');
    assert.equal(inferEntityType({ subjectKind: 'listing', businessKind: null, marketplaceCode: 'property' }), 'property');
    assert.equal(inferEntityType({ subjectKind: 'listing', businessKind: null, marketplaceCode: 'vehicles' }), 'vehicle');
    assert.equal(inferEntityType({ subjectKind: 'business', businessKind: 'dealer', marketplaceCode: 'vehicles' }), 'dealer');
    assert.equal(inferEntityType({ subjectKind: 'business', businessKind: 'agency', marketplaceCode: 'property' }), 'agency');
    assert.equal(inferEntityType({ subjectKind: 'business', businessKind: 'gold_shop', marketplaceCode: 'gold' }), 'gold_shop');
  });

  it('maps dealer and agency review types without Gold/Property/Vehicle silos', () => {
    assert.equal(inferReviewType({ reviewerIsBuyer: true, businessKind: null }), 'buyer_to_seller');
    assert.equal(inferReviewType({ reviewerIsBuyer: true, businessKind: 'dealer' }), 'buyer_to_dealer');
    assert.equal(inferReviewType({ reviewerIsBuyer: true, businessKind: 'agency' }), 'customer_to_agency');
    assert.equal(inferReviewType({ reviewerIsBuyer: true, businessKind: 'gold_shop' }), 'customer_to_gold_shop');
    assert.equal(inferReviewType({ reviewerIsBuyer: false, businessKind: 'dealer' }), 'seller_to_buyer');
  });
});
