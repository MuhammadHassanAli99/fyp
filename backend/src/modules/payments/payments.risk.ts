import { queryCount, queryOne, type Row } from '../../db/query';
import type { RiskDecision } from '../../middleware/risk-guard';
import { evaluateRisk } from '../risk/risk.engine';
import { signalHit } from '../risk/risk.signals';
import { toPaymentLegacyDecision } from '../risk/risk.policy';

export interface PaymentRisk {
  score: number;
  decision: RiskDecision;
  signals: Array<{ code: string; weight: number; detail?: string }>;
}

export async function assessPaymentRisk(input: {
  userId: number;
  amount: number;
  currency: string;
  countryId: number | null;
  billingCountryId?: number | null;
  requestScore?: number;
}): Promise<PaymentRisk> {
  const extra = [];
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const recent = await queryCount(
    `SELECT COUNT(*) FROM payments WHERE user_id = ? AND created_at >= ?`,
    [input.userId, hourAgo],
  );
  if (recent >= 8) extra.push(await signalHit('payment_velocity', 25, String(recent), 'payment'));
  else if (recent >= 4) extra.push(await signalHit('payment_velocity', 12, String(recent), 'payment'));

  const failed = await queryCount(
    `SELECT COUNT(*) FROM payments WHERE user_id = ? AND status = 'failed' AND created_at >= ?`,
    [input.userId, hourAgo],
  );
  if (failed >= 3) extra.push(await signalHit('payment_failed_burst', 22, String(failed), 'payment'));

  const user = await queryOne<Row>('SELECT created_at FROM users WHERE id = ?', [input.userId]);
  if (user?.created_at) {
    const ageHours = (Date.now() - new Date(user.created_at as Date).getTime()) / 3_600_000;
    if (ageHours < 24) extra.push(await signalHit('payment_new_account', 10, undefined, 'payment'));
  }

  if (input.amount >= 5000) extra.push(await signalHit('payment_high_amount', 18, String(input.amount), 'payment'));
  else if (input.amount >= 1500) extra.push(await signalHit('payment_high_amount', 8, String(input.amount), 'payment'));

  if (
    input.billingCountryId &&
    input.countryId &&
    Number(input.billingCountryId) !== Number(input.countryId)
  ) {
    extra.push(await signalHit('payment_country_mismatch', 16, undefined, 'payment'));
  }

  if (input.requestScore && input.requestScore >= 40) {
    extra.push(await signalHit('user_risk_medium', Math.min(12, input.requestScore / 8), undefined, 'identity'));
  }

  const record = await evaluateRisk(
    {
      eventType: 'PAYMENT_CREATED',
      subjectKind: 'payment',
      subjectId: input.userId,
      userId: input.userId,
      policyCode: 'payment',
    },
    extra,
  );

  return {
    score: record.riskScore,
    decision: toPaymentLegacyDecision(record.decision),
    signals: record.signals,
  };
}
