import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scoreCompleteness, validateListingPayload } from './listings.validation';

describe('listing validation', () => {
  it('rejects incomplete drafts that try to submit', () => {
    const result = validateListingPayload({
      title: 'Gold',
      requireMedia: true,
      mediaCount: 0,
    });
    assert.equal(result.ok, false);
    assert.ok(result.missingFields.includes('title'));
    assert.ok(result.missingFields.includes('category'));
    assert.ok(result.missingFields.includes('media'));
  });

  it('accepts a complete sell listing', () => {
    const result = validateListingPayload({
      title: '22K gold necklace',
      description: 'Hallmarked jewellery with certificate, photographed in natural light.',
      price: 185000,
      currency: 'PKR',
      priceType: 'fixed',
      categoryId: 12,
      countryId: 1,
      cityId: 5,
      mediaCount: 4,
      operation: 'sell',
      requireMedia: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.missingFields.length, 0);
    assert.ok(result.completenessScore >= 50);
  });

  it('rejects negative and zero fixed sale prices', () => {
    const negative = validateListingPayload({
      title: 'Valid title here',
      price: -1,
      currency: 'USD',
      categoryId: 1,
      countryId: 1,
    });
    assert.equal(negative.ok, false);

    const zero = validateListingPayload({
      title: 'Valid title here',
      price: 0,
      priceType: 'fixed',
      operation: 'sell',
      categoryId: 1,
      countryId: 1,
    });
    assert.equal(zero.ok, false);
  });

  it('requires latitude and longitude together', () => {
    const result = validateListingPayload({
      title: 'Valid title here',
      price: 10,
      currency: 'USD',
      categoryId: 1,
      countryId: 1,
      latitude: 31.52,
    });
    assert.equal(result.ok, false);
  });

  it('scores completeness without blocking drafts', () => {
    assert.ok(scoreCompleteness({ title: 'Draft item' }) < 40);
    assert.ok(
      scoreCompleteness({
        title: 'Draft item with a name',
        description: 'x'.repeat(90),
        price: 100,
        mediaCount: 5,
        cityId: 1,
        latitude: 1,
        detailsPresent: true,
      }) >= 80,
    );
  });
});
