import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalPromotionType, PROMOTION_KIND_ALIASES } from './listings.lifecycle';

describe('listing promotions', () => {
  it('maps legacy kind names onto independent promotion types', () => {
    assert.equal(canonicalPromotionType('feature'), 'featured');
    assert.equal(canonicalPromotionType('boost'), 'boosted');
    assert.equal(canonicalPromotionType('top_of_search'), 'top_search');
    assert.equal(canonicalPromotionType('story'), 'boosted');
    assert.equal(canonicalPromotionType('homepage'), 'homepage');
    assert.equal(canonicalPromotionType('premium'), 'premium');
  });

  it('does not treat bump as featured', () => {
    assert.equal(canonicalPromotionType('bump'), 'bump');
    assert.notEqual(canonicalPromotionType('bump'), 'featured');
  });

  it('allows featured and boosted to coexist as aliases, not combo statuses', () => {
    assert.ok(PROMOTION_KIND_ALIASES.feature);
    assert.ok(PROMOTION_KIND_ALIASES.boost);
    assert.notEqual(canonicalPromotionType('feature') + '_' + canonicalPromotionType('boost'), 'FEATURED_BOOSTED');
  });
});
