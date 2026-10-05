import { insertAndGetId } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { loggerFor } from '../../config/logger';

const log = loggerFor('payments.ledger');

export type LedgerType = 'payment' | 'refund' | 'partial_refund' | 'fee' | 'adjustment' | 'chargeback';

export async function postLedger(
  entry: {
    userId: number;
    orderId: number;
    paymentId?: number | null;
    paymentIntentId?: number | null;
    refundId?: number | null;
    provider: string;
    providerTransactionId?: string | null;
    type: LedgerType;
    amount: number;
    currency: string;
    status?: 'pending' | 'posted' | 'failed' | 'reversed';
    metadata?: Record<string, unknown>;
  },
): Promise<number | null> {
  const providerTx = entry.providerTransactionId ?? `${entry.type}_${entry.paymentId ?? entry.orderId}_${uuid().slice(0, 8)}`;
  try {
    return await insertAndGetId(
      `INSERT INTO payment_transactions
         (uuid, user_id, order_id, payment_id, payment_intent_id, refund_id, provider, provider_transaction_id,
          type, amount, currency, status, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        entry.userId,
        entry.orderId,
        entry.paymentId ?? null,
        entry.paymentIntentId ?? null,
        entry.refundId ?? null,
        entry.provider,
        providerTx,
        entry.type,
        entry.amount,
        entry.currency,
        entry.status ?? 'posted',
        JSON.stringify(entry.metadata ?? {}),
      ],
    );
  } catch (error) {
    log.info({ err: error, providerTx, type: entry.type }, 'ledger insert skipped (duplicate or constraint)');
    return null;
  }
}
