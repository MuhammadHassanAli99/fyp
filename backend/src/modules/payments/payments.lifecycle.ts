import { execute, queryOne, queryRows, transaction, type Row } from '../../db/query';
import { eventBus } from '../../core/events/event-bus';
import { toNumber } from '../../db/sql';
import { emitToUser } from '../../realtime/socket';
import { postLedger, type LedgerType } from './payments.ledger';
import { adjustInvoiceForRefund, issueOrderInvoice } from './payments.invoices';
import { statusForWebhookOutcome } from './payments.rules';
import type { WebhookOutcome } from '../../providers/payments/types';
import { loggerFor } from '../../config/logger';

const log = loggerFor('payments.lifecycle');

export async function applyPaymentOutcome(input: {
  paymentId: number;
  outcome: WebhookOutcome;
  gatewayPaymentId?: string | null;
  gatewayStatus?: string | null;
  failureMessage?: string | null;
  refundId?: number | null;
  refundAmount?: number | null;
}): Promise<void> {
  const payment = await queryOne<Row>(
    `SELECT id, uuid, order_id, user_id, amount, currency, gateway_code, gateway_fee, status, payment_intent_id
       FROM payments WHERE id = ?`,
    [input.paymentId],
  );
  if (!payment) return;

  const nextStatus = statusForWebhookOutcome(input.outcome);
  if (!nextStatus) return;

  const alreadyPaid = ['succeeded', 'captured'].includes(String(payment.status));
  await execute(
    `UPDATE payments
        SET status = ?, gateway_payment_id = COALESCE(?, gateway_payment_id),
            gateway_status = COALESCE(?, gateway_status), failure_message = ?,
            captured_at = CASE WHEN ? IN ('succeeded','captured') THEN COALESCE(captured_at, CURRENT_TIMESTAMP) ELSE captured_at END,
            failed_at = CASE WHEN ? IN ('failed','chargeback') THEN CURRENT_TIMESTAMP ELSE failed_at END
      WHERE id = ?`,
    [
      nextStatus === 'created' ? 'pending' : nextStatus,
      input.gatewayPaymentId ?? null,
      input.gatewayStatus ?? input.outcome,
      input.failureMessage ?? null,
      nextStatus,
      nextStatus,
      payment.id,
    ],
  );

  if (payment.payment_intent_id) {
    await execute(`UPDATE payment_intents SET status = ? WHERE id = ?`, [
      nextStatus === 'initiated' ? 'pending' : nextStatus,
      payment.payment_intent_id,
    ]);
  }

  const orderId = Number(payment.order_id);
  const userId = Number(payment.user_id);
  const amount = toNumber(payment.amount) ?? 0;
  const currency = String(payment.currency);
  const gateway = String(payment.gateway_code);

  if (input.outcome === 'payment_succeeded' || input.outcome === 'subscription_renewed' || input.outcome === 'subscription_created') {
    if (!alreadyPaid) {
      await execute(
        `UPDATE orders SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = ? AND status <> 'paid'`,
        [orderId],
      );
      await postLedger({
        userId,
        orderId,
        paymentId: Number(payment.id),
        paymentIntentId: payment.payment_intent_id ? Number(payment.payment_intent_id) : null,
        provider: gateway,
        providerTransactionId: input.gatewayPaymentId ?? `pay_${payment.id}`,
        type: 'payment',
        amount,
        currency,
      });
      const fee = toNumber(payment.gateway_fee) ?? 0;
      if (fee > 0) {
        await postLedger({
          userId,
          orderId,
          paymentId: Number(payment.id),
          paymentIntentId: payment.payment_intent_id ? Number(payment.payment_intent_id) : null,
          provider: gateway,
          providerTransactionId: `fee_${payment.id}`,
          type: 'fee',
          amount: fee,
          currency,
        });
      }
      await emitDomain('payment.succeeded', 'order', orderId, {
        paymentId: Number(payment.id),
        orderId,
        userId,
        amount: String(amount),
        currency,
        gateway,
      });
      try {
        const { applyPaidSubscriptionOrder } = await import('../subscriptions/subscriptions.service');
        await applyPaidSubscriptionOrder(orderId);
      } catch (error) {
        log.warn({ err: error, orderId }, 'subscription activation skipped');
      }
      await issueOrderInvoice(orderId);
    }
  }

  if (input.outcome === 'payment_failed') {
    await execute(`UPDATE orders SET status = 'failed' WHERE id = ? AND status IN ('pending','awaiting_payment')`, [orderId]);
    await emitDomain('payment.failed', 'order', orderId, {
      paymentId: Number(payment.id),
      orderId,
      userId,
      reason: input.failureMessage ?? 'failed',
      gateway,
    });
  }

  if (input.outcome === 'chargeback') {
    await execute(`UPDATE orders SET status = 'failed' WHERE id = ?`, [orderId]);
    await postLedger({
      userId,
      orderId,
      paymentId: Number(payment.id),
      provider: gateway,
      providerTransactionId: input.gatewayPaymentId ?? `cb_${payment.id}`,
      type: 'chargeback',
      amount,
      currency,
    });
  }

  if (input.outcome === 'refund_succeeded' || input.outcome === 'partial_refund') {
    const refundAmount = input.refundAmount ?? amount;
    const kind: LedgerType = input.outcome === 'partial_refund' ? 'partial_refund' : 'refund';
    await postLedger({
      userId,
      orderId,
      paymentId: Number(payment.id),
      refundId: input.refundId ?? null,
      provider: gateway,
      providerTransactionId: input.gatewayPaymentId ?? `rf_${input.refundId ?? payment.id}`,
      type: kind,
      amount: refundAmount,
      currency,
    });
    const rows = await queryRows<Row>(
      `SELECT amount FROM refunds WHERE payment_id = ? AND status = 'succeeded'`,
      [payment.id],
    );
    const refunded = rows.reduce((sum, row) => sum + (toNumber(row.amount) ?? 0), 0) || refundAmount;
    const orderStatus = refunded + 0.009 >= amount ? 'refunded' : 'partially_refunded';
    await execute(`UPDATE orders SET status = ? WHERE id = ?`, [orderStatus, orderId]);
    await execute(
      `UPDATE payments SET status = ? WHERE id = ?`,
      [orderStatus === 'refunded' ? 'refunded' : 'partially_refunded', payment.id],
    );
    await adjustInvoiceForRefund(orderId, refundAmount);
    await emitDomain('refund.issued', 'refund', input.refundId ?? Number(payment.id), {
      refundId: input.refundId ?? 0,
      paymentId: Number(payment.id),
      userId,
      amount: String(refundAmount),
      currency,
    });
  }

  emitToUser(userId, 'payment:updated', {
    orderId,
    paymentId: Number(payment.id),
    status: nextStatus,
  });
}

async function emitDomain(
  name: 'payment.succeeded' | 'payment.failed' | 'refund.issued' | 'refund.started' | 'refund.failed' | 'invoice.issued',
  entityType: string,
  entityId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, name, entityType, entityId, payload as never);
    void eventBus.publishAfterCommit(event);
  });
}
