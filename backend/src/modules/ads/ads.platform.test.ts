import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeAdRank, FORBIDDEN_TARGET_KINDS, labelForFormat, qualityFromCreative } from './ads.types';
import { classifyInvalidTraffic, eventCost, isBotUserAgent } from './ads.tracking';
import { isDailyBudgetReached, targetingAllows, type DeliveryContext } from './ads.eligibility';

describe('Advertisement Platform ranking and traffic', () => {
  const ctx: DeliveryContext = {
    marketplaceId: 1,
    countryId: 1,
    cityId: 10,
    platform: 'android',
    language: 'en',
    categoryId: 5,
    keywords: ['gold', 'ring'],
    userId: 9,
  };

  it('does not let the highest bidder win when quality and engagement are poor', () => {
    const highBid = computeAdRank({ bid: 6, quality: 0.1, expectedEngagement: 0.1, floor: 0.2 });
    const better = computeAdRank({ bid: 2, quality: 0.95, expectedEngagement: 0.95, floor: 0.2 });
    assert.ok(better > highBid);
  });

  it('keeps floor bids in the rank so a zero bid cannot sneak in', () => {
    const floored = computeAdRank({ bid: 0, quality: 1, expectedEngagement: 1, floor: 1 });
    const unpaid = computeAdRank({ bid: 0, quality: 1, expectedEngagement: 1, floor: 0 });
    assert.ok(floored > unpaid);
  });

  it('labels sponsored, featured and generic ads distinctly', () => {
    assert.equal(labelForFormat('sponsored_listing'), 'Sponsored');
    assert.equal(labelForFormat('native'), 'Sponsored');
    assert.equal(labelForFormat('featured'), 'Featured');
    assert.equal(labelForFormat('banner'), 'Advertisement');
  });

  it('caps delivery on today billed spend, not lifetime spent_amount', () => {
    assert.equal(isDailyBudgetReached(9.99, 10), false);
    assert.equal(isDailyBudgetReached(10, 10), true);
    assert.equal(isDailyBudgetReached(50, null), false);
  });

  it('ignores age and gender targeting even if stored', () => {
    assert.equal(FORBIDDEN_TARGET_KINDS.has('age'), true);
    assert.equal(FORBIDDEN_TARGET_KINDS.has('gender'), true);
    const allowed = targetingAllows(
      [
        { kind: 'age', operator: 'include', values: ['18-24'] },
        { kind: 'gender', operator: 'include', values: ['female'] },
        { kind: 'marketplace', operator: 'include', values: [1] },
      ],
      ctx,
    );
    assert.equal(allowed, true);
  });

  it('excludes a campaign when contextual marketplace targeting misses', () => {
    assert.equal(targetingAllows([{ kind: 'marketplace', operator: 'include', values: [3] }], ctx), false);
    assert.equal(targetingAllows([{ kind: 'keyword', operator: 'include', values: ['ring'] }], ctx), true);
  });

  it('does not bill self-clicks, bots, duplicates or clicks without an impression', () => {
    assert.equal(
      classifyInvalidTraffic({
        isSelfClick: true,
        hasImpression: true,
        duplicateWithinWindow: false,
        clickCountWindow: 0,
        impressionCountWindow: 0,
        isBotUa: false,
      }).reason,
      'self_click',
    );
    assert.equal(
      classifyInvalidTraffic({
        isSelfClick: false,
        hasImpression: false,
        duplicateWithinWindow: false,
        clickCountWindow: 0,
        impressionCountWindow: 0,
        isBotUa: false,
      }).reason,
      'missing_impression',
    );
    assert.equal(
      classifyInvalidTraffic({
        isSelfClick: false,
        hasImpression: true,
        duplicateWithinWindow: true,
        clickCountWindow: 1,
        impressionCountWindow: 0,
        isBotUa: false,
      }).reason,
      'duplicate',
    );
    assert.equal(isBotUserAgent('curl/8.0'), true);
    assert.equal(eventCost('cpm', 5, 'impression'), 0.005);
    assert.equal(eventCost('cpc', 0.4, 'click'), 0.4);
    assert.equal(eventCost('cpc', 0.4, 'impression'), 0);
    assert.equal(qualityFromCreative({ moderationScore: 90, ctr: 8 }) > qualityFromCreative({ moderationScore: 10, ctr: 0.1 }), true);
  });
});
