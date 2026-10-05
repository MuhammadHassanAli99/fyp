/**
 * Provider-independent payment types.
 *
 * Payment METHOD = how the customer pays (card, Google Pay, Apple Pay, PayPal,
 * bank transfer, regional wallet).
 * Payment PROVIDER = who processes it (Stripe, PayPal, bank, JazzCash, IAP).
 */

export const PAYMENT_METHODS = [
  'card',
  'google_pay',
  'apple_pay',
  'paypal',
  'bank_transfer',
  'regional_wallet',
  'upi',
  'wallet',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_PROVIDERS = [
  'stripe',
  'paypal',
  'bank_transfer',
  'jazzcash',
  'easypaisa',
  'mada',
  'fawry',
  'razorpay',
  'payfast',
  'mercadopago',
  'apple_pay',
  'google_play',
  'manual',
] as const;
export type PaymentProviderCode = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUSES = [
  'created',
  'initiated',
  'pending',
  'processing',
  'requires_action',
  'requires_authentication',
  'authorized',
  'captured',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
  'refunded',
  'partially_refunded',
  'disputed',
  'chargeback',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface GatewayOrder {
  orderId: number;
  orderUuid: string;
  orderNumber: string;
  userId: number;
  amount: number;
  currency: string;
  description: string;
  paymentMethod?: PaymentMethod | string | null;
  paymentMethodToken?: string | null;
  gatewayCustomerId?: string | null;
  returnUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PaymentIntentResult {
  intentId: string;
  clientSecret: string | null;
  redirectUrl: string | null;
  status: Extract<
    PaymentStatus,
    'requires_action' | 'requires_authentication' | 'pending' | 'processing' | 'succeeded' | 'failed'
  >;
  instructions: string | null;
  raw: Record<string, unknown>;
}

export interface CaptureResult {
  status: 'succeeded' | 'failed' | 'pending';
  gatewayPaymentId: string | null;
  gatewayStatus: string;
  fee: number | null;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface RefundResult {
  status: 'succeeded' | 'failed' | 'pending';
  gatewayRefundId: string | null;
  failureMessage: string | null;
}

export type WebhookOutcome =
  | 'payment_succeeded'
  | 'payment_failed'
  | 'payment_processing'
  | 'requires_action'
  | 'refund_succeeded'
  | 'refund_failed'
  | 'partial_refund'
  | 'chargeback'
  | 'subscription_renewed'
  | 'subscription_created'
  | 'unknown';

export interface ParsedWebhook {
  eventId: string;
  eventType: string;
  outcome: WebhookOutcome;
  gatewayPaymentId: string | null;
  gatewayIntentId: string | null;
  gatewaySubscriptionId: string | null;
  gatewayRefundId: string | null;
  amount: number | null;
  currency: string | null;
  failureMessage: string | null;
}

export interface PaymentGateway {
  readonly code: string;
  readonly supportsRecurring: boolean;
  createIntent(order: GatewayOrder): Promise<PaymentIntentResult>;
  capture(paymentId: string): Promise<CaptureResult>;
  refund(paymentId: string, amount: number): Promise<RefundResult>;
  verifyWebhook(rawBody: Buffer | string, signature: string | undefined): boolean;
  parseWebhook(payload: Record<string, unknown>): ParsedWebhook;
}

export interface GatewayDescriptor {
  code: string;
  name: string;
  kind: string;
  supportsRecurring: boolean;
  supportsRefund: boolean;
  feePercent: number;
  feeFixed: number;
  feeCurrency: string | null;
  isTestMode: boolean;
  hasDriver: boolean;
  methods: string[];
  publishableKey: string | null;
  config: Record<string, unknown>;
}
