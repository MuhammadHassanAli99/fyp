import { PAYMENT_METHODS, type PaymentMethod, type PaymentStatus, type WebhookOutcome } from '../../providers/payments/types';

export const TERMINAL_SUCCESS: ReadonlySet<string> = new Set(['succeeded', 'captured']);
export const TERMINAL_FAILURE: ReadonlySet<string> = new Set(['failed', 'cancelled', 'expired', 'chargeback']);
export const OPEN_STATUSES: ReadonlySet<string> = new Set([
  'created',
  'initiated',
  'pending',
  'processing',
  'requires_action',
  'requires_authentication',
  'authorized',
]);

export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

export function defaultMethodForProvider(provider: string): PaymentMethod {
  switch (provider) {
    case 'paypal':
      return 'paypal';
    case 'bank_transfer':
      return 'bank_transfer';
    case 'apple_pay':
      return 'apple_pay';
    case 'google_play':
      return 'google_pay';
    case 'jazzcash':
    case 'easypaisa':
    case 'fawry':
    case 'mercadopago':
      return 'regional_wallet';
    case 'razorpay':
      return 'card';
    default:
      return 'card';
  }
}

/** Store IAP providers are not card-network wallets. */
export function isStoreBillingProvider(provider: string): boolean {
  return provider === 'apple_pay' || provider === 'google_play';
}

export function providerForMethod(method: string, preferredProvider?: string | null): string {
  if (preferredProvider) return preferredProvider;
  switch (method) {
    case 'paypal':
      return 'paypal';
    case 'bank_transfer':
      return 'bank_transfer';
    case 'regional_wallet':
    case 'upi':
      return 'razorpay';
    case 'google_pay':
    case 'apple_pay':
    case 'card':
    default:
      return 'stripe';
  }
}

export function methodAllowedForProvider(method: string, provider: string, providerMethods: string[]): boolean {
  if (providerMethods.length === 0) return true;
  return providerMethods.includes(method);
}

export function mapIntentStatus(status: string): PaymentStatus {
  switch (status) {
    case 'requires_action':
      return 'requires_action';
    case 'requires_authentication':
      return 'requires_authentication';
    case 'processing':
      return 'processing';
    case 'succeeded':
    case 'captured':
      return 'succeeded';
    case 'failed':
      return 'failed';
    default:
      return 'pending';
  }
}

export function statusForWebhookOutcome(outcome: WebhookOutcome): PaymentStatus | null {
  switch (outcome) {
    case 'payment_succeeded':
    case 'subscription_renewed':
    case 'subscription_created':
      return 'succeeded';
    case 'payment_failed':
      return 'failed';
    case 'payment_processing':
      return 'processing';
    case 'requires_action':
      return 'requires_action';
    case 'refund_succeeded':
      return 'refunded';
    case 'partial_refund':
      return 'partially_refunded';
    case 'chargeback':
      return 'chargeback';
    default:
      return null;
  }
}

export function amountsMatch(expected: number, actual: number | null, tolerance = 0.009): boolean {
  if (actual === null || Number.isNaN(actual)) return true;
  return Math.abs(expected - actual) <= tolerance;
}

export function currenciesMatch(expected: string, actual: string | null): boolean {
  if (!actual) return true;
  return expected.toUpperCase() === actual.toUpperCase();
}

export function refundKind(paymentAmount: number, refundAmount: number): 'full' | 'partial' {
  return refundAmount + 0.009 >= paymentAmount ? 'full' : 'partial';
}

export function classifyProviderEvent(rawType: string): WebhookOutcome {
  const type = rawType.toLowerCase();
  if (type.includes('chargeback') || type.includes('dispute')) return 'chargeback';
  if (type.includes('refund') && (type.includes('fail') || type.includes('denied'))) return 'refund_failed';
  if (type.includes('partial') && type.includes('refund')) return 'partial_refund';
  if (type.includes('refund')) return 'refund_succeeded';
  if (type.includes('requires_action') || type.includes('requires_source') || type.includes('authentication')) {
    return 'requires_action';
  }
  if (type.includes('processing') || type.includes('pending')) return 'payment_processing';
  if (type.includes('fail') || type.includes('unpaid') || type.includes('canceled') || type.includes('cancelled')) {
    return 'payment_failed';
  }
  if (type.includes('renew')) return 'subscription_renewed';
  if (type.includes('subscription') && type.includes('creat')) return 'subscription_created';
  if (type.includes('succe') || type.includes('paid') || type.includes('captured') || type.includes('completed')) {
    return 'payment_succeeded';
  }
  return 'unknown';
}

export function publicGatewayConfig(config: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set([
    'secret',
    'secretKey',
    'webhookSecret',
    'clientSecret',
    'privateKey',
    'accessToken',
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (blocked.has(key)) continue;
    if (/secret|private|password|token/i.test(key) && key !== 'clientId' && key !== 'publishableKey') continue;
    out[key] = value;
  }
  return out;
}
