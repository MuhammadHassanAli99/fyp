import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveDeepLink, sanitizeDeepLink } from './notifications.deeplink';

describe('deep links', () => {
  it('allows internal listing, chat and security routes', () => {
    assert.equal(sanitizeDeepLink('/listing/42')?.route, '/listing/42');
    assert.equal(sanitizeDeepLink('/chat/11111111-1111-4111-8111-111111111111')?.actionType, 'chat');
    assert.equal(sanitizeDeepLink('/security/devices')?.actionType, 'security');
  });

  it('rejects javascript, protocol-relative and external URLs', () => {
    assert.equal(sanitizeDeepLink('javascript:alert(1)'), null);
    assert.equal(sanitizeDeepLink('https://evil.test/phish'), null);
    assert.equal(sanitizeDeepLink('//evil.test/x'), null);
    assert.equal(sanitizeDeepLink('/listing/../admin'), null);
  });

  it('builds a safe route from action type when no link is supplied', () => {
    const link = resolveDeepLink({ actionType: 'listing', actionTarget: '99' });
    assert.equal(link.route, '/listing/99');
    const fallback = resolveDeepLink({ deepLink: 'https://evil.test' });
    assert.equal(fallback.route, '/home');
  });

  it('routes subscription actions to /subscription', () => {
    assert.equal(sanitizeDeepLink('/subscription')?.actionType, 'subscription');
    assert.equal(resolveDeepLink({ actionType: 'subscription' }).route, '/subscription');
  });

  it('routes payment actions to checkout, never an external URL', () => {
    assert.equal(sanitizeDeepLink('/checkout/11111111-1111-4111-8111-111111111111')?.actionType, 'payment');
    assert.equal(
      resolveDeepLink({ actionType: 'payment', actionTarget: '11111111-1111-4111-8111-111111111111' }).route,
      '/checkout/11111111-1111-4111-8111-111111111111',
    );
  });

  it('routes support tickets to /support', () => {
    assert.equal(sanitizeDeepLink('/support')?.actionType, 'support');
    assert.equal(sanitizeDeepLink('/support/tickets/11111111-1111-4111-8111-111111111111')?.actionType, 'support');
    assert.equal(resolveDeepLink({ actionType: 'support', actionTarget: '11111111-1111-4111-8111-111111111111' }).route, '/support');
  });
});
