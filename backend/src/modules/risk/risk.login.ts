import { execute, queryCount, queryOne, type Row } from '../../db/query';
import { evaluateRisk } from './risk.engine';
import { signalHit } from './risk.signals';
import type { RiskDecisionRecord } from './risk.types';

export async function assessLoginRisk(params: {
  userId: number;
  sessionId: number;
  deviceId: number | null;
  succeeded: boolean;
  extra?: { newDevice?: boolean; newCountry?: boolean };
}): Promise<RiskDecisionRecord> {
  const extra = [];
  if (params.extra?.newDevice) extra.push(await signalHit('new_device', 8, 'unseen_device', 'device'));
  if (params.extra?.newCountry) extra.push(await signalHit('impossible_travel', 28, 'new_country', 'geo'));

  const hourAgo = new Date(Date.now() - 3600 * 1000);
  const resets = await queryCount(
    `SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = ? AND created_at >= ?`,
    [params.userId, hourAgo],
  ).catch(() => 0);
  if (resets >= 3) extra.push(await signalHit('password_reset_burst', 20, String(resets), 'behavior'));

  const contactChanges = await queryCount(
    `SELECT COUNT(*) FROM contact_change_requests WHERE user_id = ? AND created_at >= ?`,
    [params.userId, hourAgo],
  ).catch(() => 0);
  const mfaChanges = await queryCount(
    `SELECT COUNT(*) FROM auth_security_events
      WHERE user_id = ? AND event_type IN ('MFA_ENABLED','MFA_DISABLED','PASSWORD_CHANGED') AND created_at >= ?`,
    [params.userId, hourAgo],
  ).catch(() => 0);
  if (contactChanges + mfaChanges >= 2 && (params.extra?.newDevice || params.extra?.newCountry)) {
    extra.push(await signalHit('ato_sequence', 40, 'reset_device_contact', 'behavior'));
  }

  return evaluateRisk(
    {
      eventType: params.succeeded ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED',
      subjectKind: 'user',
      subjectId: params.userId,
      userId: params.userId,
      deviceId: params.deviceId,
      policyCode: 'login',
    },
    extra,
  );
}

export async function recordTakeoverAlert(params: {
  userId: number;
  trigger: 'new_device' | 'new_country' | 'password_change' | 'email_change' | 'phone_change';
  score: number;
  evidence: Record<string, unknown>;
  action: 'none' | 'notified' | 'challenged' | 'session_revoked' | 'account_locked';
}): Promise<void> {
  await execute(
    `INSERT INTO account_takeover_alerts
       (user_id, trigger_kind, risk_score, evidence, action_taken, notified_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [params.userId, params.trigger, params.score, JSON.stringify(params.evidence), params.action],
  );
}

export async function maybeRevokeSessions(userId: number, keepSessionId: number | null, decision: string): Promise<number> {
  if (decision !== 'temporary_restriction' && decision !== 'block') return 0;
  const result = await execute(
    `UPDATE user_sessions
        SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'risk_engine'
      WHERE user_id = ? AND revoked_at IS NULL ${keepSessionId ? 'AND id <> ?' : ''}`,
    keepSessionId ? [userId, keepSessionId] : [userId],
  );
  return result.affectedRows;
}

export async function latestAto(userId: number): Promise<Row | null> {
  return queryOne<Row>(
    `SELECT id, trigger_kind, risk_score, action_taken, is_false_positive, created_at
       FROM account_takeover_alerts WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    [userId],
  );
}
