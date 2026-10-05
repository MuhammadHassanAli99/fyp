import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { toJson, toNumber } from '../../db/sql';
import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { resolveGateway } from '../../providers/payments';
import { applyPaymentOutcome } from './payments.lifecycle';

const log = loggerFor('payments.jobs');

const OPEN_INTENT = `'created','pending','processing','requires_action','requires_authentication','authorized','initiated'`;

export async function expirePaymentIntents(limit = 200): Promise<number> {
  const intents = await queryRows<Row>(
    `SELECT id, order_id FROM payment_intents
      WHERE status IN (${OPEN_INTENT})
        AND expires_at IS NOT NULL
        AND expires_at < CURRENT_TIMESTAMP
      LIMIT ?`,
    [limit],
  );
  for (const row of intents) {
    await execute(`UPDATE payment_intents SET status = 'expired' WHERE id = ? AND status IN (${OPEN_INTENT})`, [row.id]);
    await execute(
      `UPDATE payments SET status = 'expired'
        WHERE payment_intent_id = ? AND status IN ('initiated','pending','processing','requires_action','requires_authentication','authorized')`,
      [row.id],
    );
    await execute(
      `UPDATE orders SET status = 'expired'
        WHERE id = ? AND status IN ('pending','awaiting_payment')`,
      [row.order_id],
    );
    await execute(
      `UPDATE bank_transfer_instructions SET status = 'expired'
        WHERE payment_intent_id = ? AND status = 'pending'`,
      [row.id],
    );
  }
  return intents.length;
}

export async function retryFailedWebhooks(limit = 25): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT id, gateway_code, event_id, payload, attempts
       FROM webhook_events
      WHERE status = 'failed' AND attempts < 8
      ORDER BY id
      LIMIT ?`,
    [limit],
  );
  let processed = 0;
  for (const row of rows) {
    try {
      const payload = toJson<Record<string, unknown>>(row.payload, {});
      const gateway = await resolveGateway(String(row.gateway_code));
      const parsed = gateway.parseWebhook(payload);
      const payment = parsed.gatewayIntentId
        ? await queryOne<Row>(`SELECT id FROM payments WHERE gateway_intent_id = ?`, [parsed.gatewayIntentId])
        : null;
      if (payment && parsed.outcome !== 'unknown') {
        await applyPaymentOutcome({
          paymentId: Number(payment.id),
          outcome: parsed.outcome,
          gatewayPaymentId: parsed.gatewayPaymentId,
          failureMessage: parsed.failureMessage,
        });
      }
      await execute(
        `UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP, error = NULL WHERE id = ?`,
        [row.id],
      );
      processed += 1;
    } catch (error) {
      await execute(`UPDATE webhook_events SET attempts = attempts + 1, error = ? WHERE id = ?`, [
        String(error).slice(0, 2000),
        row.id,
      ]);
      log.warn({ err: error, eventId: row.event_id }, 'webhook retry failed');
    }
  }
  return processed;
}

export async function snapshotReconciliation(): Promise<number> {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const providers = await queryRows<Row>(
    `SELECT code FROM payment_gateways WHERE is_active = 1 AND code <> 'manual'`,
  );
  let written = 0;
  for (const provider of providers) {
    const code = String(provider.code);
    const payments = await queryOne<Row>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
         FROM payments
        WHERE gateway_code = ? AND status IN ('succeeded','captured') AND captured_at >= ?`,
      [code, hourAgo],
    );
    const ledger = await queryOne<Row>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
         FROM payment_transactions
        WHERE provider = ? AND type = 'payment' AND status = 'posted' AND created_at >= ?`,
      [code, hourAgo],
    );
    const failedWebhooks = await queryOne<Row>(
      `SELECT COUNT(*) AS n FROM webhook_events WHERE gateway_code = ? AND status = 'failed' AND received_at >= ?`,
      [code, hourAgo],
    );
    const internalCount = Number(payments?.n ?? 0);
    const ledgerCount = Number(ledger?.n ?? 0);
    const webhookFailures = Number(failedWebhooks?.n ?? 0);
    const amountMismatch = Math.abs((toNumber(payments?.total) ?? 0) - (toNumber(ledger?.total) ?? 0)) > 0.009;
    const status = webhookFailures > 0 || internalCount !== ledgerCount || amountMismatch ? 'mismatch' : 'matched';
    await insertAndGetId(
      `INSERT INTO payment_reconciliation
         (uuid, provider, period_start, period_end, status, internal_count, provider_count,
          internal_amount, provider_amount, currency, missing_count, amount_mismatch_count, webhook_failure_count, notes)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hourly internal snapshot')`,
      [
        uuid(),
        code,
        hourAgo.toISOString().slice(0, 19).replace('T', ' '),
        status,
        internalCount,
        ledgerCount,
        toNumber(payments?.total) ?? 0,
        toNumber(ledger?.total) ?? 0,
        env.BASE_CURRENCY,
        Math.max(0, internalCount - ledgerCount),
        amountMismatch ? 1 : 0,
        webhookFailures,
      ],
    );
    written += 1;
  }
  return written;
}

export async function runPaymentJobs(): Promise<number> {
  const expired = await expirePaymentIntents();
  const retried = await retryFailedWebhooks();
  return expired + retried;
}
