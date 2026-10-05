import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { uuid } from '../../core/security/crypto';
import { toNumber } from '../../db/sql';
import type { CaptureResult, GatewayOrder, ParsedWebhook, PaymentGateway, PaymentIntentResult, RefundResult } from './types';

const log = loggerFor('payments.manual');

/**
 * Development settlement. Completes only through simulate / signed webhooks,
 * never because Flutter reported success. Disabled as an offered gateway in
 * production by listGatewaysFor.
 */
export class ManualGateway implements PaymentGateway {
  readonly code = 'manual';
  readonly supportsRecurring = false;

  async createIntent(order: GatewayOrder): Promise<PaymentIntentResult> {
    const intentId = `manual_${uuid()}`;
    log.info({ orderId: order.orderId, amount: order.amount, currency: order.currency }, 'manual payment intent created');
    return {
      intentId,
      clientSecret: null,
      redirectUrl: null,
      status: 'pending',
      instructions: `No live payment provider is configured. Order ${order.orderNumber} awaits a test settlement of ${order.amount} ${order.currency}.`,
      raw: { driver: this.code, intentId },
    };
  }

  async capture(paymentId: string): Promise<CaptureResult> {
    return {
      status: 'succeeded',
      gatewayPaymentId: paymentId,
      gatewayStatus: 'manual_captured',
      fee: 0,
      failureCode: null,
      failureMessage: null,
    };
  }

  async refund(paymentId: string, amount: number): Promise<RefundResult> {
    log.info({ paymentId, amount }, 'manual refund recorded');
    return { status: 'succeeded', gatewayRefundId: `manual_rf_${uuid()}`, failureMessage: null };
  }

  verifyWebhook(): boolean {
    return !env.isProduction;
  }

  parseWebhook(payload: Record<string, unknown>): ParsedWebhook {
    const type = String(payload.type ?? 'manual.event');
    return {
      eventId: String(payload.id ?? uuid()),
      eventType: type,
      outcome:
        type.includes('fail')
          ? 'payment_failed'
          : type.includes('refund')
            ? 'refund_succeeded'
            : 'payment_succeeded',
      gatewayPaymentId: payload.paymentId ? String(payload.paymentId) : null,
      gatewayIntentId: payload.intentId ? String(payload.intentId) : null,
      gatewaySubscriptionId: null,
      gatewayRefundId: payload.refundId ? String(payload.refundId) : null,
      amount: toNumber(payload.amount),
      currency: payload.currency ? String(payload.currency) : null,
      failureMessage: payload.failureMessage ? String(payload.failureMessage) : null,
    };
  }
}

export const manualGateway = new ManualGateway();
