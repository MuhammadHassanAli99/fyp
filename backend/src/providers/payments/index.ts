import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { queryRows, type Row } from '../../db/query';
import { remember } from '../../config/cache';
import { toJson, toNumber } from '../../db/sql';
import { hmacSha256, safeEqual, uuid } from '../../core/security/crypto';
import { classifyProviderEvent, publicGatewayConfig } from '../../modules/payments/payments.rules';
import type {
  CaptureResult,
  GatewayDescriptor,
  GatewayOrder,
  ParsedWebhook,
  PaymentGateway,
  PaymentIntentResult,
  RefundResult,
} from './types';
import { manualGateway } from './manual';
import { stripeProvider } from './stripe';
import { paypalProvider } from './paypal';
import { bankTransferProvider } from './bank-transfer';
import { RegionalProvider } from './regional';
import { appleIapProvider, googlePlayProvider } from './platform-billing';

export type {
  CaptureResult,
  GatewayDescriptor,
  GatewayOrder,
  ParsedWebhook,
  PaymentGateway,
  PaymentIntentResult,
  RefundResult,
  PaymentMethod,
  PaymentStatus,
  WebhookOutcome,
} from './types';

const log = loggerFor('payments.provider');

class UnconfiguredGateway implements PaymentGateway {
  constructor(
    readonly code: string,
    readonly supportsRecurring: boolean,
  ) {}

  async createIntent(order: GatewayOrder): Promise<PaymentIntentResult> {
    log.warn({ gateway: this.code, orderId: order.orderId }, 'gateway has no driver; falling back to manual settlement');
    return manualGateway.createIntent(order);
  }

  capture(paymentId: string): Promise<CaptureResult> {
    return Promise.resolve({
      status: 'pending' as const,
      gatewayPaymentId: paymentId,
      gatewayStatus: 'awaiting_driver',
      fee: null,
      failureCode: null,
      failureMessage: `No ${this.code} driver is installed`,
    });
  }

  refund(paymentId: string, amount: number): Promise<RefundResult> {
    log.warn({ gateway: this.code, paymentId, amount }, 'refund requested on a gateway without a driver');
    return Promise.resolve({ status: 'pending' as const, gatewayRefundId: null, failureMessage: `No ${this.code} driver is installed` });
  }

  verifyWebhook(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!signature) return !env.isProduction;
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const secret = env.PAYMENT_WEBHOOK_SECRET ?? env.ENCRYPTION_KEY;
    return safeEqual(hmacSha256(body, secret).toLowerCase(), signature.trim().toLowerCase());
  }

  parseWebhook(payload: Record<string, unknown>): ParsedWebhook {
    const type = String(payload.type ?? payload.event_type ?? 'unknown');
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

const drivers = new Map<string, PaymentGateway>([
  [manualGateway.code, manualGateway],
  [stripeProvider.code, stripeProvider],
  [paypalProvider.code, paypalProvider],
  [bankTransferProvider.code, bankTransferProvider],
  [appleIapProvider.code, appleIapProvider],
  [googlePlayProvider.code, googlePlayProvider],
  ['jazzcash', new RegionalProvider('jazzcash')],
  ['easypaisa', new RegionalProvider('easypaisa')],
  ['mada', new RegionalProvider('mada', true)],
  ['fawry', new RegionalProvider('fawry')],
  ['razorpay', new RegionalProvider('razorpay', true)],
  ['payfast', new RegionalProvider('payfast', true)],
  ['mercadopago', new RegionalProvider('mercadopago', true)],
]);

export function registerGateway(gateway: PaymentGateway): void {
  drivers.set(gateway.code, gateway);
  log.info({ gateway: gateway.code }, 'payment gateway driver registered');
}

interface GatewayRow extends Row {
  code: string;
  name: string;
  kind: string;
  supports_recurring: number;
  supports_refund: number;
  supported_countries: unknown;
  supported_currencies: unknown;
  config: unknown;
  fee_percent: string;
  fee_fixed: string;
  fee_currency: string | null;
  is_test_mode: number;
}

const loadGatewayRows = () =>
  remember('payments:gateways', 60, () =>
    queryRows<GatewayRow>(
      `SELECT code, name, kind, supports_recurring, supports_refund, supported_countries,
              supported_currencies, config, fee_percent, fee_fixed, fee_currency, is_test_mode
         FROM payment_gateways
        WHERE is_active = 1
        ORDER BY sort_order, code`,
    ),
  );

function publishableFor(code: string): string | null {
  if (code === 'stripe') return env.STRIPE_PUBLISHABLE_KEY ?? null;
  if (code === 'paypal') return env.PAYPAL_CLIENT_ID ?? null;
  return null;
}

export async function listGatewaysFor(countryIso2: string | null, currency: string | null): Promise<GatewayDescriptor[]> {
  const rows = await loadGatewayRows();
  const available: GatewayDescriptor[] = [];

  for (const row of rows) {
    if (env.isProduction && (row.is_test_mode === 1 || row.code === 'manual')) continue;
    const countries = toJson<string[] | null>(row.supported_countries, null);
    const currencies = toJson<string[] | null>(row.supported_currencies, null);
    if (countries && countries.length > 0 && countryIso2 && !countries.includes(countryIso2.toUpperCase())) continue;
    if (currencies && currencies.length > 0 && currency && !currencies.includes(currency.toUpperCase())) continue;

    const config = publicGatewayConfig(toJson<Record<string, unknown>>(row.config, {}));
    const methods = Array.isArray(config.methods) ? (config.methods as string[]) : [];

    available.push({
      code: row.code,
      name: row.name,
      kind: row.kind,
      supportsRecurring: row.supports_recurring === 1,
      supportsRefund: row.supports_refund === 1,
      feePercent: toNumber(row.fee_percent) ?? 0,
      feeFixed: toNumber(row.fee_fixed) ?? 0,
      feeCurrency: row.fee_currency,
      isTestMode: row.is_test_mode === 1,
      hasDriver: drivers.has(row.code),
      methods,
      publishableKey: publishableFor(row.code),
      config,
    });
  }

  if (available.length === 0) {
    available.push({
      code: manualGateway.code,
      name: 'Manual settlement',
      kind: 'cash',
      supportsRecurring: false,
      supportsRefund: true,
      feePercent: 0,
      feeFixed: 0,
      feeCurrency: null,
      isTestMode: true,
      hasDriver: true,
      methods: ['card'],
      publishableKey: null,
      config: {},
    });
  }

  return available;
}

export async function resolveGateway(code: string): Promise<PaymentGateway> {
  const driver = drivers.get(code);
  if (driver) return driver;

  const rows = await loadGatewayRows();
  const configured = rows.find((row) => row.code === code);
  if (!configured) return manualGateway;

  const stub = new UnconfiguredGateway(configured.code, configured.supports_recurring === 1);
  drivers.set(code, stub);
  return stub;
}

export async function estimateFee(code: string, amount: number): Promise<number> {
  const rows = await loadGatewayRows();
  const row = rows.find((entry) => entry.code === code);
  if (!row) return 0;
  const percent = toNumber(row.fee_percent) ?? 0;
  const fixed = toNumber(row.fee_fixed) ?? 0;
  return Number(((amount * percent) / 100 + fixed).toFixed(2));
}

export const isManualGateway = (code: string): boolean => code === manualGateway.code || !drivers.get(code);

export async function providerMethods(code: string): Promise<string[]> {
  const rows = await loadGatewayRows();
  const row = rows.find((entry) => entry.code === code);
  const config = publicGatewayConfig(toJson<Record<string, unknown>>(row?.config, {}));
  return Array.isArray(config.methods) ? (config.methods as string[]) : [];
}
