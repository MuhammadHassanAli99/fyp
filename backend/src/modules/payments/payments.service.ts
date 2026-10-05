import { insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { notFound, badRequest } from '../../core/errors';
import { uuid, randomHex } from '../../core/security/crypto';
import { listGatewaysFor } from '../../providers/payments';
import { env } from '../../config/env';
import { toNumber } from '../../db/sql';
import { eventBus } from '../../core/events/event-bus';
import { transaction } from '../../db/query';
import {
  confirmBankTransfer,
  getCheckout,
  handleProviderWebhook,
  listAvailableMethods,
  reviewBankProof,
  startPaymentForOrder,
  submitBankProof,
} from './payments.orchestrator';
import { applyPaymentOutcome } from './payments.lifecycle';
import { requestRefund } from './payments.refunds';

export async function listGateways(countryIso2: string | null, currency: string | null) {
  return listGatewaysFor(countryIso2, currency);
}

export async function listMethods(countryIso2: string | null, currency: string | null, countryId: number | null) {
  return listAvailableMethods(countryIso2, currency, countryId);
}

export async function createOrder(
  userId: number,
  input: {
    kind:
      | 'subscription'
      | 'promotion'
      | 'advertisement'
      | 'verification'
      | 'wallet_topup'
      | 'listing_purchase'
      | 'escrow'
      | 'auction_deposit'
      | 'rental_deposit'
      | 'rental_payment'
      | 'booking_payment'
      | 'parts_purchase';
    amount: number;
    currency: string;
    countryId: number;
    gatewayCode: string;
    paymentMethod?: string | null;
    description?: string;
    referenceType?: string | null;
    referenceId?: number | null;
    returnUrl?: string | null;
    metadata?: Record<string, unknown>;
    displayCurrency?: string | null;
    requestScore?: number;
  },
) {
  if (input.amount <= 0) throw badRequest('Amount must be positive');
  if (input.kind === 'subscription') {
    throw badRequest('Subscription checkout is priced on the server. Use POST /subscriptions/checkout.');
  }

  const currency = await queryOne<Row>('SELECT code FROM currencies WHERE code = ? AND is_active = 1', [input.currency]);
  if (!currency) throw badRequest('Unsupported currency');

  const orderNumber = `ORD-${randomHex(3).toUpperCase()}`;
  const orderUuid = uuid();
  const orderId = await insertAndGetId(
    `INSERT INTO orders
       (uuid, order_number, user_id, kind, reference_type, reference_id, subtotal, total_amount,
        currency, status, gateway_code, country_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_payment', ?, ?, ?)`,
    [
      orderUuid,
      orderNumber,
      userId,
      input.kind,
      input.referenceType ?? null,
      input.referenceId ?? null,
      input.amount,
      input.amount,
      input.currency,
      input.gatewayCode,
      input.countryId,
      JSON.stringify({ description: input.description ?? null, ...(input.metadata ?? {}) }),
    ],
  );

  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'order.created', 'order', orderId, {
      orderId,
      userId,
      kind: input.kind,
      total: String(input.amount),
      currency: input.currency,
    });
    void eventBus.publishAfterCommit(event);
  });

  const started = await startPaymentForOrder({
    orderId,
    userId,
    gatewayCode: input.gatewayCode,
    paymentMethod: input.paymentMethod,
    returnUrl: input.returnUrl,
    displayCurrency: input.displayCurrency,
    requestScore: input.requestScore,
  });

  return started;
}

export async function listOrders(userId: number, limit = 20) {
  const rows = await queryRows<Row>(
    `SELECT id, uuid, order_number, kind, total_amount, currency, status, paid_at, created_at
       FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    uuid: String(row.uuid),
    orderNumber: String(row.order_number),
    kind: String(row.kind),
    totalAmount: toNumber(row.total_amount) ?? 0,
    currency: String(row.currency),
    status: String(row.status),
    paidAt: row.paid_at ? (row.paid_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}

export async function getOrder(orderUuid: string, userId: number, isStaff = false) {
  return getCheckout(orderUuid, userId, isStaff);
}

export async function handleWebhook(gatewayCode: string, rawBody: Buffer | string, signature: string | undefined) {
  return handleProviderWebhook(gatewayCode, rawBody, signature);
}

export async function simulatePayment(orderUuid: string, userId: number) {
  if (env.isProduction) throw badRequest('Simulate is not available in production');

  const order = await queryOne<Row>('SELECT id, user_id FROM orders WHERE uuid = ?', [orderUuid]);
  if (!order) throw notFound('Order');
  if (Number(order.user_id) !== userId) throw badRequest('Order does not belong to you');

  const payment = await queryOne<Row>('SELECT id FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1', [order.id]);
  if (!payment) throw notFound('Payment');
  await applyPaymentOutcome({
    paymentId: Number(payment.id),
    outcome: 'payment_succeeded',
    gatewayPaymentId: `sim_${orderUuid}`,
  });
  return { paid: true };
}

export { requestRefund, submitBankProof, reviewBankProof, confirmBankTransfer };
