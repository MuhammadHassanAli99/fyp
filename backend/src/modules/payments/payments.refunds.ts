import { execute, insertAndGetId, queryOne, queryRows, transaction, type Row } from '../../db/query';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { uuid } from '../../core/security/crypto';
import { toNumber } from '../../db/sql';
import { eventBus } from '../../core/events/event-bus';
import { emitToUser } from '../../realtime/socket';
import { resolveGateway } from '../../providers/payments';
import { applyPaymentOutcome } from './payments.lifecycle';
import { refundKind } from './payments.rules';

export async function requestRefund(input: {
  userId: number;
  isStaff: boolean;
  paymentUuid: string;
  amount?: number | null;
  reason?: string;
}): Promise<{ refundUuid: string; status: string; kind: 'full' | 'partial' }> {
  const payment = await queryOne<Row>(
    `SELECT id, uuid, order_id, user_id, amount, currency, gateway_code, gateway_intent_id, status, payment_intent_id
       FROM payments WHERE uuid = ?`,
    [input.paymentUuid],
  );
  if (!payment) throw notFound('Payment');
  if (!input.isStaff && Number(payment.user_id) !== input.userId) throw forbidden('Payment does not belong to you');
  if (!['succeeded', 'captured', 'partially_refunded'].includes(String(payment.status))) {
    throw badRequest('Only captured payments can be refunded');
  }

  const already = await queryRows<Row>(
    `SELECT amount, status FROM refunds WHERE payment_id = ? AND status IN ('pending','processing','succeeded')`,
    [payment.id],
  );
  const refundedSoFar = already.reduce((sum, row) => sum + (toNumber(row.amount) ?? 0), 0);
  const captured = toNumber(payment.amount) ?? 0;
  const remaining = Number((captured - refundedSoFar).toFixed(2));
  const amount = input.amount && input.amount > 0 ? Number(input.amount.toFixed(2)) : remaining;
  if (amount <= 0 || amount > remaining + 0.009) throw badRequest('Refund amount exceeds the captured balance');

  const allowedReasons = new Set([
    'requested_by_customer',
    'duplicate',
    'fraudulent',
    'service_not_provided',
    'downgrade',
    'chargeback',
    'other',
  ]);
  const reasonCode = input.reason && allowedReasons.has(input.reason) ? input.reason : 'requested_by_customer';
  const description = input.reason && !allowedReasons.has(input.reason) ? input.reason.slice(0, 500) : null;
  const kind = refundKind(captured, refundedSoFar + amount);
  const refundId = await insertAndGetId(
    `INSERT INTO refunds (uuid, payment_id, order_id, user_id, amount, kind, currency, reason, description, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      uuid(),
      payment.id,
      payment.order_id,
      payment.user_id,
      amount,
      kind,
      payment.currency,
      reasonCode,
      description,
    ],
  );
  const refund = await queryOne<Row>('SELECT uuid FROM refunds WHERE id = ?', [refundId]);

  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'refund.started', 'refund', refundId, {
      refundId,
      paymentId: Number(payment.id),
      userId: Number(payment.user_id),
      amount: String(amount),
      currency: String(payment.currency),
    });
    void eventBus.publishAfterCommit(event);
  });
  emitToUser(Number(payment.user_id), 'payment:updated', { orderId: Number(payment.order_id), status: 'refund_pending' });

  const gateway = await resolveGateway(String(payment.gateway_code));
  const result = await gateway.refund(String(payment.gateway_intent_id ?? payment.uuid), amount);

  if (result.status === 'succeeded') {
    await execute(
      `UPDATE refunds SET status = 'succeeded', gateway_refund_id = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [result.gatewayRefundId, refundId],
    );
    await applyPaymentOutcome({
      paymentId: Number(payment.id),
      outcome: kind === 'full' ? 'refund_succeeded' : 'partial_refund',
      gatewayPaymentId: result.gatewayRefundId,
      refundId,
      refundAmount: amount,
    });
  } else if (result.status === 'failed') {
    await execute(`UPDATE refunds SET status = 'failed' WHERE id = ?`, [refundId]);
    await transaction(async (connection) => {
      const event = await eventBus.enqueue(connection, 'refund.failed', 'refund', refundId, {
        refundId,
        paymentId: Number(payment.id),
        userId: Number(payment.user_id),
        reason: result.failureMessage ?? 'provider_failed',
      });
      void eventBus.publishAfterCommit(event);
    });
  } else {
    await execute(
      `UPDATE refunds SET status = 'processing', gateway_refund_id = ? WHERE id = ?`,
      [result.gatewayRefundId, refundId],
    );
  }

  return { refundUuid: String(refund?.uuid), status: result.status, kind };
}
