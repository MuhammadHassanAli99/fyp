import { env } from '../../config/env';
import { AppError, ErrorCode } from '../../core/errors';
import { hmacSha256, safeEqual, uuid } from '../../core/security/crypto';
import { toNumber } from '../../db/sql';
import { classifyProviderEvent } from '../../modules/payments/payments.rules';
import type { CaptureResult, GatewayOrder, ParsedWebhook, PaymentGateway, PaymentIntentResult, RefundResult } from './types';

/**
 * Apple IAP / Google Play Billing. Receipt verification is a dedicated driver;
 * production refuses to invent a successful charge from a client receipt.
 */
export class PlatformBillingProvider implements PaymentGateway {
  readonly supportsRecurring = true;

  constructor(readonly code: 'apple_pay' | 'google_play') {}

  async createIntent(order: GatewayOrder): Promise<PaymentIntentResult> {
    if (env.isProduction) {
      throw new AppError('Store billing verification is not configured', {
        status: 503,
        code: ErrorCode.NOT_IMPLEMENTED,
      });
    }
    return {
      intentId: `${this.code}_${uuid()}`,
      clientSecret: null,
      redirectUrl: null,
      status: 'pending',
      instructions: `Complete the ${this.code === 'apple_pay' ? 'App Store' : 'Play'} purchase. The server verifies the receipt; the client cannot mark the order paid.`,
      raw: { driver: this.code, billing: 'store' },
    };
  }

  async capture(paymentId: string): Promise<CaptureResult> {
    return {
      status: 'pending',
      gatewayPaymentId: paymentId,
      gatewayStatus: 'awaiting_receipt',
      fee: null,
      failureCode: null,
      failureMessage: 'Store capture requires a verified receipt',
    };
  }

  async refund(_paymentId: string, _amount: number): Promise<RefundResult> {
    return { status: 'pending', gatewayRefundId: null, failureMessage: 'Store refunds are processed by Apple/Google' };
  }

  verifyWebhook(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!signature) return !env.isProduction;
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    return safeEqual(hmacSha256(body).toLowerCase(), signature.trim().toLowerCase());
  }

  parseWebhook(payload: Record<string, unknown>): ParsedWebhook {
    const type = String(payload.type ?? payload.notificationType ?? `${this.code}.event`);
    return {
      eventId: String(payload.id ?? payload.notificationUUID ?? uuid()),
      eventType: type,
      outcome: classifyProviderEvent(type),
      gatewayPaymentId: payload.transactionId ? String(payload.transactionId) : null,
      gatewayIntentId: payload.intentId ? String(payload.intentId) : String(payload.originalTransactionId ?? ''),
      gatewaySubscriptionId: payload.originalTransactionId ? String(payload.originalTransactionId) : null,
      gatewayRefundId: null,
      amount: toNumber(payload.amount),
      currency: payload.currency ? String(payload.currency) : null,
      failureMessage: payload.failureMessage ? String(payload.failureMessage) : null,
    };
  }
}

export const appleIapProvider = new PlatformBillingProvider('apple_pay');
export const googlePlayProvider = new PlatformBillingProvider('google_play');
