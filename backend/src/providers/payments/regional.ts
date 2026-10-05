import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { hmacSha256, safeEqual, uuid } from '../../core/security/crypto';
import { toNumber } from '../../db/sql';
import { classifyProviderEvent } from '../../modules/payments/payments.rules';
import type { CaptureResult, GatewayOrder, ParsedWebhook, PaymentGateway, PaymentIntentResult, RefundResult } from './types';

const log = loggerFor('payments.regional');

/** One adapter class, many seeded codes (JazzCash, Mada, Fawry, …). */
export class RegionalProvider implements PaymentGateway {
  readonly supportsRecurring: boolean;

  constructor(
    readonly code: string,
    supportsRecurring = false,
  ) {
    this.supportsRecurring = supportsRecurring;
  }

  async createIntent(order: GatewayOrder): Promise<PaymentIntentResult> {
    const intentId = `${this.code}_${uuid()}`;
    log.info({ gateway: this.code, orderId: order.orderId }, 'regional wallet intent created');
    return {
      intentId,
      clientSecret: null,
      redirectUrl: order.returnUrl ?? `${env.WEB_URL}/checkout/${order.orderUuid}`,
      status: 'pending',
      instructions: `Complete ${this.code} checkout for ${order.amount} ${order.currency}. The backend confirms via webhook.`,
      raw: { driver: this.code, intentId },
    };
  }

  async capture(paymentId: string): Promise<CaptureResult> {
    return {
      status: 'pending',
      gatewayPaymentId: paymentId,
      gatewayStatus: 'awaiting_provider',
      fee: null,
      failureCode: null,
      failureMessage: `No live ${this.code} merchant account is configured`,
    };
  }

  async refund(paymentId: string, amount: number): Promise<RefundResult> {
    if (env.isProduction) {
      return { status: 'pending', gatewayRefundId: null, failureMessage: `No live ${this.code} refund driver` };
    }
    return { status: 'pending', gatewayRefundId: `${this.code}_rf_${uuid()}`, failureMessage: null };
  }

  verifyWebhook(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!signature) return !env.isProduction;
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const secret = env.PAYMENT_WEBHOOK_SECRET ?? env.ENCRYPTION_KEY;
    return safeEqual(hmacSha256(body, secret).toLowerCase(), signature.trim().toLowerCase());
  }

  parseWebhook(payload: Record<string, unknown>): ParsedWebhook {
    const type = String(payload.type ?? payload.event_type ?? `${this.code}.event`);
    return {
      eventId: String(payload.id ?? payload.event_id ?? uuid()),
      eventType: type,
      outcome: classifyProviderEvent(type),
      gatewayPaymentId: payload.paymentId ? String(payload.paymentId) : null,
      gatewayIntentId: payload.intentId ? String(payload.intentId) : null,
      gatewaySubscriptionId: payload.subscriptionId ? String(payload.subscriptionId) : null,
      gatewayRefundId: payload.refundId ? String(payload.refundId) : null,
      amount: toNumber(payload.amount),
      currency: payload.currency ? String(payload.currency) : null,
      failureMessage: payload.failureMessage ? String(payload.failureMessage) : null,
    };
  }
}
