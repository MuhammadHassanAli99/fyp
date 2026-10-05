import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import {
  amountsMatch,
  classifyProviderEvent,
  currenciesMatch,
  defaultMethodForProvider,
  isStoreBillingProvider,
  publicGatewayConfig,
  refundKind,
  statusForWebhookOutcome,
} from './payments.rules';
import { verifyStripeSignature } from '../../providers/payments/stripe';

describe('payment platform rules', () => {
  it('treats Stripe and PayPal as providers and card/wallets as methods', () => {
    assert.equal(defaultMethodForProvider('stripe'), 'card');
    assert.equal(defaultMethodForProvider('paypal'), 'paypal');
    assert.equal(defaultMethodForProvider('bank_transfer'), 'bank_transfer');
    assert.equal(isStoreBillingProvider('apple_pay'), true);
    assert.equal(isStoreBillingProvider('stripe'), false);
  });

  it('rejects amount and currency mismatches from the provider', () => {
    assert.equal(amountsMatch(10, 10), true);
    assert.equal(amountsMatch(10, 10.001), true);
    assert.equal(amountsMatch(10, 11), false);
    assert.equal(amountsMatch(10, null), true);
    assert.equal(currenciesMatch('USD', 'usd'), true);
    assert.equal(currenciesMatch('USD', 'EUR'), false);
  });

  it('classifies refunds as full or partial without a client flag', () => {
    assert.equal(refundKind(20, 20), 'full');
    assert.equal(refundKind(20, 5), 'partial');
  });

  it('maps webhook types without trusting a client success flag', () => {
    assert.equal(classifyProviderEvent('payment_intent.succeeded'), 'payment_succeeded');
    assert.equal(classifyProviderEvent('charge.refunded'), 'refund_succeeded');
    assert.equal(classifyProviderEvent('charge.dispute.created'), 'chargeback');
    assert.equal(statusForWebhookOutcome('payment_succeeded'), 'succeeded');
    assert.equal(statusForWebhookOutcome('unknown'), null);
    assert.equal(statusForWebhookOutcome('refund_failed'), null);
  });

  it('strips provider secrets from public gateway config', () => {
    const publicConfig = publicGatewayConfig({
      methods: ['card'],
      secretKey: 'sk_live_secret',
      webhookSecret: 'whsec',
      publishableKey: 'pk_test_123',
      clientId: 'paypal-client',
    });
    assert.deepEqual(publicConfig.methods, ['card']);
    assert.equal(publicConfig.publishableKey, 'pk_test_123');
    assert.equal(publicConfig.clientId, 'paypal-client');
    assert.equal('secretKey' in publicConfig, false);
    assert.equal('webhookSecret' in publicConfig, false);
  });
});

describe('stripe webhook signatures', () => {
  it('accepts a Stripe-Signature t,v1 payload', () => {
    const body = '{"id":"evt_1","type":"payment_intent.succeeded"}';
    const secret = 'whsec_test';
    const timestamp = '1700000000';
    const v1 = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    assert.equal(verifyStripeSignature(body, `t=${timestamp},v1=${v1}`, secret), true);
    assert.equal(verifyStripeSignature(body, `t=${timestamp},v1=deadbeef`, secret), false);
    assert.equal(verifyStripeSignature(body, undefined, secret), false);
  });
});
