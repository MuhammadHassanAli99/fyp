import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyWebhookType,
  exceedsLimit,
  isDowngrade,
  isUpgrade,
  mergeFeature,
  overLimitMessage,
  rankingBoostFromEntitlement,
} from './subscriptions.rules';

describe('subscription rules', () => {
  it('classifies upgrades and downgrades by tier, never by plan name', () => {
    assert.equal(isUpgrade(0, 2), true);
    assert.equal(isDowngrade(3, 1), true);
    assert.equal(isUpgrade(2, 2), false);
    assert.equal(isDowngrade(1, 4), false);
  });

  it('keeps existing usage when a new limit is smaller', () => {
    assert.equal(exceedsLimit(12, 5, false), true);
    assert.equal(exceedsLimit(12, null, true), false);
    assert.match(overLimitMessage('active_listings', 12, 5), /12 active_listings/);
  });

  it('lets enterprise overrides win over plan features', () => {
    const merged = mergeFeature(
      { enabled: true, limit: 10, unlimited: false },
      { enabled: true, limit: null, unlimited: true },
    );
    assert.deepEqual(merged, { enabled: true, limit: null, unlimited: true });
  });

  it('maps provider webhook types onto outcomes without trusting client amounts', () => {
    assert.equal(classifyWebhookType('invoice.payment_succeeded'), 'payment_succeeded');
    assert.equal(classifyWebhookType('customer.subscription.deleted'), 'subscription_cancelled');
    assert.equal(classifyWebhookType('charge.refunded'), 'refund_succeeded');
    assert.equal(classifyWebhookType('customer.subscription.paused'), 'subscription_paused');
    assert.equal(classifyWebhookType('unknown.event'), 'unknown');
  });

  it('applies ranking boost from entitlement, not from a client flag', () => {
    assert.ok(rankingBoostFromEntitlement(true, false, false) > rankingBoostFromEntitlement(false, false, false));
    assert.ok(rankingBoostFromEntitlement(true, true, true) < 0.2);
  });
});
