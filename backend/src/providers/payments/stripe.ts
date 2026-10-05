import crypto from 'node:crypto';
import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { hmacSha256, safeEqual, uuid } from '../../core/security/crypto';
import { toNumber } from '../../db/sql';
import { classifyProviderEvent } from '../../modules/payments/payments.rules';
import type { CaptureResult, GatewayOrder, ParsedWebhook, PaymentGateway, PaymentIntentResult, RefundResult } from './types';
import { manualGateway } from './manual';

const log = loggerFor('payments.stripe');

function stripeSecret(): string | undefined {
  return env.STRIPE_SECRET_KEY;
}

function stripeWebhookSecret(): string | undefined {
  return env.STRIPE_WEBHOOK_SECRET;
}

export function verifyStripeSignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const parts = Object.fromEntries(
    signature.split(',').map((part) => {
      const idx = part.indexOf('=');
      return idx === -1 ? [part, ''] : [part.slice(0, idx).trim(), part.slice(idx + 1).trim()];
    }),
  );
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) {
    return safeEqual(hmacSha256(rawBody, secret).toLowerCase(), signature.trim().toLowerCase());
  }
  if (env.isProduction) {
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(age) || age > 300) return false;
  }
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return safeEqual(expected, v1);
}

async function stripeForm(
  path: string,
  params: Record<string, string>,
  method: 'POST' | 'GET' = 'POST',
): Promise<Record<string, unknown>> {
  const secret = stripeSecret();
  if (!secret) throw new Error('Stripe is not configured');
  const body = new URLSearchParams(params);
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : body,
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const err = json.error as { message?: string } | undefined;
    throw new Error(err?.message ?? `Stripe ${path} failed`);
  }
  return json;
}

export class StripeProvider implements PaymentGateway {
  readonly code = 'stripe';
  readonly supportsRecurring = true;

  async createIntent(order: GatewayOrder): Promise<PaymentIntentResult> {
    if (!stripeSecret()) {
      if (env.isProduction) {
        log.error({ orderId: order.orderId }, 'stripe secret missing in production');
        return manualGateway.createIntent(order);
      }
      const intentId = `pi_test_${uuid().replace(/-/g, '')}`;
      return {
        intentId,
        clientSecret: `cs_test_${uuid()}`,
        redirectUrl: null,
        status: order.paymentMethod === 'card' ? 'requires_action' : 'pending',
        instructions: null,
        raw: { driver: this.code, mode: 'test_local', method: order.paymentMethod ?? 'card' },
      };
    }

    const methodTypes = ['card'];
    const json = await stripeForm('payment_intents', {
      amount: String(Math.round(order.amount * 100)),
      currency: order.currency.toLowerCase(),
      description: order.description,
      'metadata[orderId]': String(order.orderId),
      'metadata[orderUuid]': order.orderUuid,
      'metadata[paymentMethod]': String(order.paymentMethod ?? 'card'),
      'payment_method_types[0]': methodTypes[0]!,
      ...(order.returnUrl ? { return_url: order.returnUrl } : {}),
    });

    const status = String(json.status ?? 'requires_payment_method');
    return {
      intentId: String(json.id),
      clientSecret: json.client_secret ? String(json.client_secret) : null,
      redirectUrl: null,
      status:
        status === 'succeeded'
          ? 'succeeded'
          : status.includes('requires_action') || status.includes('requires_source')
            ? 'requires_action'
            : 'pending',
      instructions: null,
      raw: { id: json.id, status },
    };
  }

  async capture(paymentId: string): Promise<CaptureResult> {
    if (!stripeSecret()) {
      return { status: 'pending', gatewayPaymentId: paymentId, gatewayStatus: 'awaiting_driver', fee: null, failureCode: null, failureMessage: 'Stripe is not configured' };
    }
    const json = await stripeForm(`payment_intents/${paymentId}/capture`, {});
    return {
      status: String(json.status) === 'succeeded' ? 'succeeded' : 'pending',
      gatewayPaymentId: String(json.id),
      gatewayStatus: String(json.status ?? ''),
      fee: null,
      failureCode: null,
      failureMessage: null,
    };
  }

  async refund(paymentId: string, amount: number): Promise<RefundResult> {
    if (!stripeSecret()) {
      if (env.isProduction) {
        return { status: 'pending', gatewayRefundId: null, failureMessage: 'Stripe is not configured' };
      }
      return { status: 'succeeded', gatewayRefundId: `re_test_${uuid()}`, failureMessage: null };
    }
    const json = await stripeForm('refunds', {
      payment_intent: paymentId,
      amount: String(Math.round(amount * 100)),
    });
    const status = String(json.status ?? '');
    return {
      status: status === 'succeeded' || status === 'pending' ? (status === 'succeeded' ? 'succeeded' : 'pending') : 'failed',
      gatewayRefundId: String(json.id ?? ''),
      failureMessage: status === 'failed' ? 'Stripe refund failed' : null,
    };
  }

  verifyWebhook(rawBody: Buffer | string, signature: string | undefined): boolean {
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const secret = stripeWebhookSecret();
    if (secret) return verifyStripeSignature(body, signature, secret);
    if (env.isProduction) return false;
    return Boolean(signature);
  }

  parseWebhook(payload: Record<string, unknown>): ParsedWebhook {
    const type = String(payload.type ?? payload.event_type ?? 'unknown');
    const data = (payload.data as { object?: Record<string, unknown> } | undefined)?.object ?? payload;
    const amountMinor = toNumber(data.amount_received ?? data.amount);
    return {
      eventId: String(payload.id ?? payload.event_id ?? uuid()),
      eventType: type,
      outcome: classifyProviderEvent(type),
      gatewayPaymentId: data.id && String(data.object ?? '') === 'charge' ? String(data.id) : data.latest_charge ? String(data.latest_charge) : null,
      gatewayIntentId: String(data.payment_intent ?? data.id ?? ''),
      gatewaySubscriptionId: data.subscription ? String(data.subscription) : null,
      gatewayRefundId: String(data.object ?? '') === 'refund' ? String(data.id ?? '') : null,
      amount: amountMinor === null ? null : amountMinor / 100,
      currency: data.currency ? String(data.currency).toUpperCase() : null,
      failureMessage: data.last_payment_error
        ? String((data.last_payment_error as { message?: string }).message ?? 'failed')
        : null,
    };
  }
}

export const stripeProvider = new StripeProvider();
