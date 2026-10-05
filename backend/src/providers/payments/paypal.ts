import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { hmacSha256, safeEqual, uuid } from '../../core/security/crypto';
import { toNumber } from '../../db/sql';
import { classifyProviderEvent } from '../../modules/payments/payments.rules';
import type { CaptureResult, GatewayOrder, ParsedWebhook, PaymentGateway, PaymentIntentResult, RefundResult } from './types';
import { manualGateway } from './manual';

const log = loggerFor('payments.paypal');

const paypalBase = (): string =>
  env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

async function paypalToken(): Promise<string> {
  const id = env.PAYPAL_CLIENT_ID;
  const secret = env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PayPal is not configured');
  const response = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const json = (await response.json()) as { access_token?: string; error_description?: string };
  if (!response.ok || !json.access_token) throw new Error(json.error_description ?? 'PayPal auth failed');
  return json.access_token;
}

export class PayPalProvider implements PaymentGateway {
  readonly code = 'paypal';
  readonly supportsRecurring = true;

  async createIntent(order: GatewayOrder): Promise<PaymentIntentResult> {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
      if (env.isProduction) {
        log.error({ orderId: order.orderId }, 'paypal credentials missing in production');
        return manualGateway.createIntent(order);
      }
      const intentId = `PAYPAL-${uuid()}`;
      return {
        intentId,
        clientSecret: null,
        redirectUrl: order.returnUrl ?? `${env.WEB_URL}/checkout/${order.orderUuid}`,
        status: 'pending',
        instructions: 'Complete PayPal checkout in the sandbox, then wait for the webhook.',
        raw: { driver: this.code, mode: 'test_local' },
      };
    }

    const token = await paypalToken();
    const response = await fetch(`${paypalBase()}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: order.orderUuid,
            description: order.description,
            amount: { currency_code: order.currency, value: order.amount.toFixed(2) },
          },
        ],
        payment_source: { paypal: { experience_context: { return_url: order.returnUrl ?? env.WEB_URL, cancel_url: order.returnUrl ?? env.WEB_URL } } },
      }),
    });
    const json = (await response.json()) as {
      id?: string;
      status?: string;
      links?: Array<{ rel?: string; href?: string }>;
      message?: string;
    };
    if (!response.ok || !json.id) throw new Error(json.message ?? 'PayPal order create failed');
    const approve = json.links?.find((link) => link.rel === 'approve' || link.rel === 'payer-action');
    return {
      intentId: json.id,
      clientSecret: null,
      redirectUrl: approve?.href ?? null,
      status: json.status === 'COMPLETED' ? 'succeeded' : 'pending',
      instructions: null,
      raw: { id: json.id, status: json.status },
    };
  }

  async capture(paymentId: string): Promise<CaptureResult> {
    if (!env.PAYPAL_CLIENT_ID) {
      return { status: 'pending', gatewayPaymentId: paymentId, gatewayStatus: 'awaiting_driver', fee: null, failureCode: null, failureMessage: 'PayPal is not configured' };
    }
    const token = await paypalToken();
    const response = await fetch(`${paypalBase()}/v2/checkout/orders/${paymentId}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const json = (await response.json()) as { status?: string; id?: string };
    return {
      status: json.status === 'COMPLETED' ? 'succeeded' : 'pending',
      gatewayPaymentId: json.id ?? paymentId,
      gatewayStatus: json.status ?? 'unknown',
      fee: null,
      failureCode: null,
      failureMessage: response.ok ? null : 'PayPal capture failed',
    };
  }

  async refund(paymentId: string, amount: number): Promise<RefundResult> {
    if (!env.PAYPAL_CLIENT_ID) {
      if (env.isProduction) return { status: 'pending', gatewayRefundId: null, failureMessage: 'PayPal is not configured' };
      return { status: 'succeeded', gatewayRefundId: `paypal_rf_${uuid()}`, failureMessage: null };
    }
    log.info({ paymentId, amount }, 'paypal refund requested');
    return { status: 'pending', gatewayRefundId: null, failureMessage: null };
  }

  verifyWebhook(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!signature) return false;
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const secret = env.PAYPAL_WEBHOOK_ID ?? env.PAYMENT_WEBHOOK_SECRET;
    if (!secret) return !env.isProduction;
    return safeEqual(hmacSha256(body, secret).toLowerCase(), signature.trim().toLowerCase());
  }

  parseWebhook(payload: Record<string, unknown>): ParsedWebhook {
    const type = String(payload.event_type ?? payload.type ?? 'unknown');
    const resource = (payload.resource as Record<string, unknown> | undefined) ?? payload;
    const amountObj = (resource.amount as { value?: string; currency_code?: string } | undefined) ?? undefined;
    return {
      eventId: String(payload.id ?? payload.event_id ?? uuid()),
      eventType: type,
      outcome: classifyProviderEvent(type),
      gatewayPaymentId: resource.id ? String(resource.id) : null,
      gatewayIntentId: String(resource.supplementary_data ? (resource as { supplementary_data?: { related_ids?: { order_id?: string } } }).supplementary_data?.related_ids?.order_id ?? resource.id ?? '' : resource.id ?? ''),
      gatewaySubscriptionId: resource.billing_agreement_id ? String(resource.billing_agreement_id) : null,
      gatewayRefundId: type.toLowerCase().includes('refund') && resource.id ? String(resource.id) : null,
      amount: amountObj?.value ? toNumber(amountObj.value) : toNumber(resource.amount),
      currency: amountObj?.currency_code ? String(amountObj.currency_code) : resource.currency_code ? String(resource.currency_code) : null,
      failureMessage: null,
    };
  }
}

export const paypalProvider = new PayPalProvider();
