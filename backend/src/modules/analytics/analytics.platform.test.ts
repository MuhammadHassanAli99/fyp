import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickCompanyFilter, pickMarketplaceId } from '../seller/seller.scope';
import { isBlockedKey, parseDeviceKind, parseOs, sanitizeProperties } from './analytics.privacy';
import { isPlatformScope } from './analytics.scope';
import {
  GUEST_EVENTS,
  applyRequestedSellerFilter,
  funnelRates,
  guestMayIngest,
  mapRevenueSource,
  mapTrafficSource,
  normalizeEventName,
} from './analytics.catalog';

describe('analytics platform rules', () => {
  it('allowlists dotted names and spec aliases, and drops unknown events', () => {
    assert.equal(normalizeEventName('listing.viewed'), 'listing.viewed');
    assert.equal(normalizeEventName('listing_viewed'), 'listing.viewed');
    assert.equal(normalizeEventName('user_login'), 'user.logged_in');
    assert.equal(normalizeEventName('payment.completed'), 'payment.succeeded');
    assert.equal(normalizeEventName('listing.price_changed'), null);
    assert.equal(normalizeEventName('password.reset'), null);
  });

  it('lets guests emit only the public catalogue', () => {
    assert.equal(guestMayIngest('listing.viewed', null), true);
    assert.equal(guestMayIngest('search.performed', null), true);
    assert.equal(guestMayIngest('session.started', null), true);
    assert.equal(guestMayIngest('payment.succeeded', null), false);
    assert.equal(guestMayIngest('user.registered', null), false);
    assert.equal(guestMayIngest('lead.created', 42), true);
    assert.equal(GUEST_EVENTS.has('message.sent'), false);
  });

  it('strips credentials, PII, message bodies and precise coordinates', () => {
    assert.equal(isBlockedKey('email'), true);
    assert.equal(isBlockedKey('phone'), true);
    assert.equal(isBlockedKey('password'), true);
    assert.equal(isBlockedKey('access_token'), true);
    assert.equal(isBlockedKey('message'), true);
    assert.equal(isBlockedKey('latitude'), true);
    assert.equal(isBlockedKey('listingId'), false);
    const cleaned = sanitizeProperties({
      listingId: 9,
      email: 'buyer@example.com',
      phone: '+15551212',
      password: 'secret',
      token: 'abc',
      message: 'hi seller',
      lat: 31.52,
      lng: 74.35,
      utm_source: 'google',
    });
    assert.deepEqual(cleaned, { listingId: 9, utm_source: 'google' });
  });

  it('derives coarse device and OS without storing a raw fingerprint', () => {
    assert.equal(parseDeviceKind('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'ios'), 'phone');
    assert.equal(parseDeviceKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows'), 'desktop');
    assert.equal(parseOs('Mozilla/5.0 (Linux; Android 14)', 'android').osName, 'android');
    assert.equal(parseOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 'macos').osName, 'macos');
  });

  it('ignores unauthorized company and seller filters instead of 403', () => {
    assert.equal(pickCompanyFilter(77, [9401]), null);
    assert.equal(pickCompanyFilter(9401, [9401]), 9401);
    assert.equal(pickMarketplaceId(2, [1, 3]), null);
    assert.equal(pickMarketplaceId(1, [1, 3]), 1);
    assert.deepEqual(applyRequestedSellerFilter([100, 101], 999), [100, 101]);
    assert.deepEqual(applyRequestedSellerFilter([100, 101], 101), [101]);
  });

  it('keeps seller/company/team off the platform rollup tables', () => {
    assert.equal(isPlatformScope({ mode: 'global' } as never), true);
    assert.equal(isPlatformScope({ mode: 'marketplace' } as never), true);
    assert.equal(isPlatformScope({ mode: 'company' } as never), false);
    assert.equal(isPlatformScope({ mode: 'team' } as never), false);
    assert.equal(isPlatformScope({ mode: 'own' } as never), false);
  });

  it('computes funnel conversion from previous and from start', () => {
    assert.deepEqual(funnelRates(0, 1000, 0, 1000), { fromPrevious: 100, fromStart: 100 });
    assert.deepEqual(funnelRates(1, 400, 1000, 1000), { fromPrevious: 40, fromStart: 40 });
    assert.deepEqual(funnelRates(2, 50, 400, 1000), { fromPrevious: 12.5, fromStart: 5 });
    assert.deepEqual(funnelRates(1, 10, 0, 0), { fromPrevious: 100, fromStart: 0 });
  });

  it('maps order kinds to platform revenue vs other, and UTM to traffic source', () => {
    assert.equal(mapRevenueSource('subscription'), 'subscription');
    assert.equal(mapRevenueSource('advertisement'), 'advertisement');
    assert.equal(mapRevenueSource('listing_purchase'), 'other');
    assert.equal(mapRevenueSource('escrow'), 'other');
    assert.equal(mapTrafficSource(null, null), 'direct');
    assert.equal(mapTrafficSource('google', null), 'organic');
    assert.equal(mapTrafficSource('cpc', null), 'paid');
    assert.equal(mapTrafficSource('facebook', null), 'social');
    assert.equal(mapTrafficSource('partner-site', 'https://example.com'), 'referral');
  });
});
