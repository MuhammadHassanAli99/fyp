import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { hmacSha256, safeEqual, uuid } from '../../core/security/crypto';
import { toNumber } from '../../db/sql';
import { classifyProviderEvent } from '../../modules/payments/payments.rules';
import type { CaptureResult, GatewayOrder, ParsedWebhook, PaymentGateway, PaymentIntentResult, RefundResult } from './types';

const log = loggerFor('payments.bank');

export class BankTransferProvider implements PaymentGateway {
  readonly code = 'bank_transfer';
  readonly supportsRecurring = false;

  async createIntent(order: GatewayOrder): Promise<PaymentIntentResult> {
    const intentId = `bt_${uuid()}`;
    const reference = `MP-${order.orderNumber.replace(/^ORD-/, '')}`;
    log.info({ orderId: order.orderId, reference }, 'bank transfer instructions issued');
    return {
      intentId,
      clientSecret: null,
      redirectUrl: null,
      status: 'pending',
      instructions: `Transfer ${order.amount} ${order.currency} using reference ${reference}. Upload is evidence only — settlement waits for bank confirmation.`,
      raw: {
        driver: this.code,
        reference,
        bankName: 'Marketplace Clearing Bank',
        accountName: env.APP_NAME,
        accountNumberMasked: '****4219',
        ibanMasked: '****4219',
      },
    };
  }

  async capture(paymentId: string): Promise<CaptureResult> {
    return {
      status: 'pending',
      gatewayPaymentId: paymentId,
      gatewayStatus: 'awaiting_bank',
      fee: 0,
      failureCode: null,
      failureMessage: 'Bank transfers capture only after provider or staff confirmation',
    };
  }

  async refund(paymentId: string, amount: number): Promise<RefundResult> {
    if (env.isProduction) {
      return { status: 'pending', gatewayRefundId: null, failureMessage: 'Bank refunds require operations confirmation' };
    }
    return { status: 'pending', gatewayRefundId: `bt_rf_${uuid()}`, failureMessage: null };
  }

  verifyWebhook(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!signature) return !env.isProduction;
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const secret = env.PAYMENT_WEBHOOK_SECRET ?? env.ENCRYPTION_KEY;
    return safeEqual(hmacSha256(body, secret).toLowerCase(), signature.trim().toLowerCase());
  }

  parseWebhook(payload: Record<string, unknown>): ParsedWebhook {
    const type = String(payload.type ?? payload.event_type ?? 'bank.credit');
    return {
      eventId: String(payload.id ?? payload.event_id ?? uuid()),
      eventType: type,
      outcome: classifyProviderEvent(type),
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

export const bankTransferProvider = new BankTransferProvider();
