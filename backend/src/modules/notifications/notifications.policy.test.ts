import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluatePolicy, isCriticalOverride, channelAllowedBySubscription } from './notifications.policy';
import { groupedFavoriteCopy } from './notifications.grouping';
import { buildIdempotencyKey } from './notifications.idempotency';
import { backoffSeconds, isPermanentProviderError } from './notifications.queue';
import { marketplaceFromGroup, toStoredPriority } from './notifications.types';

const user = {
  userId: 1,
  language: 'en',
  timezone: 'Asia/Karachi',
  email: 'a@example.test',
  phoneE164: '+923001234567',
  planCode: 'free',
  planTier: 0,
};

const marketplaceCategory = {
  code: 'vehicle.search',
  groupCode: 'vehicles',
  policyGroup: 'MARKETPLACE' as const,
  marketplaceScope: 'VEHICLE',
  defaultPush: true,
  defaultEmail: false,
  defaultSms: false,
  defaultInApp: true,
  isTransactional: false,
  isActive: true,
};

const securityCategory = {
  ...marketplaceCategory,
  code: 'security.new_device',
  groupCode: 'security',
  policyGroup: 'SECURITY' as const,
  marketplaceScope: 'GENERAL',
  defaultSms: true,
  defaultEmail: true,
  isTransactional: true,
};

describe('notification domain mapping', () => {
  it('maps spec priorities onto stored enums', () => {
    assert.equal(toStoredPriority('CRITICAL'), 'urgent');
    assert.equal(toStoredPriority('HIGH'), 'high');
    assert.equal(toStoredPriority('LOW'), 'low');
    assert.equal(toStoredPriority('normal'), 'normal');
  });

  it('derives marketplace from group codes', () => {
    assert.equal(marketplaceFromGroup('gold'), 'GOLD');
    assert.equal(marketplaceFromGroup('property'), 'PROPERTY');
    assert.equal(marketplaceFromGroup('vehicles'), 'VEHICLE');
    assert.equal(marketplaceFromGroup('chat'), 'GENERAL');
  });
});

describe('policy engine', () => {
  it('never withholds security channels for a free plan', () => {
    const decisions = evaluatePolicy({
      category: securityCategory,
      preference: { push: false, email: false, sms: false, inApp: false, whatsapp: false },
      quietHours: {
        isEnabled: true,
        startTime: '23:00',
        endTime: '07:00',
        timezone: 'Asia/Karachi',
        allowUrgent: true,
        daysOfWeek: null,
      },
      user,
      priority: 'urgent',
      now: new Date('2026-08-17T18:30:00.000Z'),
      isSilent: false,
      hasInstantAlerts: false,
    });
    const byChannel = Object.fromEntries(decisions.map((item) => [item.channel, item]));
    assert.equal(isCriticalOverride('SECURITY', 'urgent'), true);
    assert.equal(byChannel.push?.allowed, true);
    assert.equal(byChannel.email?.allowed, true);
    assert.equal(byChannel.sms?.allowed, true);
    assert.equal(byChannel.push?.delayUntil, null);
  });

  it('does not send marketing SMS and can digest marketplace push on free plans', () => {
    assert.equal(channelAllowedBySubscription('sms', 'MARKETING', true).allowed, false);
    assert.equal(channelAllowedBySubscription('push', 'MARKETPLACE', false).digestInstead, true);
    assert.equal(channelAllowedBySubscription('push', 'TRANSACTIONAL', false).allowed, true);
  });

  it('honours preference off for marketplace push', () => {
    const decisions = evaluatePolicy({
      category: marketplaceCategory,
      preference: { push: false, email: false, sms: false, inApp: true, whatsapp: false },
      quietHours: null,
      user,
      priority: 'normal',
      now: new Date(),
      isSilent: false,
      hasInstantAlerts: true,
    });
    const push = decisions.find((item) => item.channel === 'push');
    const inApp = decisions.find((item) => item.channel === 'in_app');
    assert.equal(push?.allowed, false);
    assert.equal(inApp?.allowed, true);
  });
});

describe('grouping and reliability', () => {
  it('collapses many favorites into one sentence', () => {
    assert.equal(groupedFavoriteCopy(1).title.includes('Someone'), true);
    assert.equal(groupedFavoriteCopy(12).title, '12 people saved your listing');
  });

  it('builds deterministic idempotency keys', () => {
    const a = buildIdempotencyKey({ eventId: 'evt-1', userId: 9, categoryCode: 'payment.succeeded', channel: 'sms' });
    const b = buildIdempotencyKey({ eventId: 'evt-1', userId: 9, categoryCode: 'payment.succeeded', channel: 'sms' });
    const c = buildIdempotencyKey({ eventId: 'evt-1', userId: 9, categoryCode: 'payment.succeeded', channel: 'email' });
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it('uses exponential backoff and does not retry permanent provider errors', () => {
    assert.equal(backoffSeconds(1), 60);
    assert.equal(backoffSeconds(2), 300);
    assert.equal(backoffSeconds(4), 3600);
    assert.equal(isPermanentProviderError('INVALID_TOKEN'), true);
    assert.equal(isPermanentProviderError('TIMEOUT'), false);
  });
});
