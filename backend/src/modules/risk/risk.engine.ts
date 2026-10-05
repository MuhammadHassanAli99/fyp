import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { loggerFor } from '../../config/logger';
import { remember } from '../../config/cache';
import { eventBus } from '../../core/events/event-bus';
import { emitToUser } from '../../realtime/socket';
import { contextOrDefaults } from '../../core/context';
import type { RiskDecisionRecord, RiskEvaluationInput, RiskPolicyThresholds, RiskSignalHit } from './risk.types';
import { clampScore, combineSignalWeights, decisionForScore, DEFAULT_THRESHOLDS, levelForScore, requiresReview } from './risk.policy';
import { cachedIpSignals } from './risk.ip';
import { bumpVelocity, recordBehavior, velocitySignals } from './risk.behavior';
import { applyDeviceState, nextDeviceState } from './risk.device';
import { touchUserDeviceGraph } from './risk.graph';
import { enqueueRiskJob } from './risk.jobs';

const log = loggerFor('risk.engine');

const ACTIVE_MODEL = { id: 'rules-v1', version: '1.0.0' };

export async function loadPolicy(code = 'default'): Promise<RiskPolicyThresholds> {
  const all = await remember('risk:policies', 60, async () => {
    const rows = await queryRows<Row>(
      `SELECT code, allow_max, monitor_max, step_up_max, review_max, restriction_max, whitelist_score_reduction
         FROM risk_policy_thresholds WHERE is_active = 1`,
    );
    const map: Record<string, RiskPolicyThresholds> = {};
    for (const row of rows) {
      map[String(row.code)] = {
        code: String(row.code),
        allowMax: Number(row.allow_max),
        monitorMax: Number(row.monitor_max),
        stepUpMax: Number(row.step_up_max),
        reviewMax: Number(row.review_max),
        restrictionMax: Number(row.restriction_max),
        whitelistScoreReduction: Number(row.whitelist_score_reduction),
      };
    }
    return map;
  }).catch((): Record<string, RiskPolicyThresholds> => ({ default: DEFAULT_THRESHOLDS }));
  return all[code] ?? all.default ?? DEFAULT_THRESHOLDS;
}

function shadowHeuristic(signals: RiskSignalHit[]): number {
  if (signals.length === 0) return 0;
  const mean = signals.reduce((sum, s) => sum + Math.max(0, s.weight), 0) / Math.max(1, signals.length);
  return clampScore(mean * Math.log2(signals.length + 1));
}

export function assembleDecision(params: {
  input: RiskEvaluationInput;
  signals: RiskSignalHit[];
  policy: RiskPolicyThresholds;
  uuid: string;
}): RiskDecisionRecord {
  const score = combineSignalWeights(params.signals);
  const decision = decisionForScore(score, params.policy);
  const level = levelForScore(score);
  return {
    uuid: params.uuid,
    eventType: params.input.eventType,
    subjectKind: params.input.subjectKind,
    subjectId: params.input.subjectId,
    userId: params.input.userId ?? null,
    deviceId: params.input.deviceId ?? null,
    listingId: params.input.listingId ?? null,
    reviewId: params.input.reviewId ?? null,
    requestId: params.input.requestId ?? null,
    riskScore: score,
    riskLevel: level,
    decision,
    confidence: Math.min(99, 40 + params.signals.length * 6),
    signals: params.signals,
    rulesTriggered: params.signals.map((s) => s.code),
    modelId: ACTIVE_MODEL.id,
    modelVersion: ACTIVE_MODEL.version,
    policyCode: params.policy.code,
    requiresReview: requiresReview(decision),
    timestamp: new Date().toISOString(),
  };
}

export async function evaluateRisk(input: RiskEvaluationInput, requestSignals: RiskSignalHit[] = []): Promise<RiskDecisionRecord> {
  const policy = await loadPolicy(input.policyCode ?? policyForEvent(input.eventType));
  const context = contextOrDefaults();
  const ip = input.ip ?? context.ip;

  const [ipSignals, velSignals] = await Promise.all([
    cachedIpSignals(ip),
    velocitySignals(input.userId ?? null, input.eventType),
  ]);

  const signals = [...requestSignals, ...ipSignals, ...velSignals, ...(input.extraSignals ?? [])];
  const record = assembleDecision({ input, signals, policy, uuid: uuid() });

  if (input.userId && input.eventType !== 'REQUEST') {
    await bumpVelocity({ subjectKind: 'user', subjectId: String(input.userId), action: input.eventType });
    await recordBehavior({
      userId: input.userId,
      deviceId: input.deviceId,
      action: input.eventType,
      targetType: input.subjectKind,
      targetId: input.subjectId,
    });
  }

  if (input.persist !== false) {
    await persistDecision(record).catch((error) => log.warn({ err: error }, 'risk decision persist skipped'));
    if (ip) {
      await enqueueRiskJob('ip_reputation', { ip }).catch(() => undefined);
    }
    if (input.userId) {
      await touchUserDeviceGraph(input.userId, context.deviceHash, ip).catch(() => undefined);
    }
    if (input.deviceId) {
      const state = nextDeviceState({
        current: 'active',
        isNew: input.eventType === 'NEW_DEVICE',
        riskScore: record.riskScore,
        trusted: record.signals.some((s) => s.code === 'whitelist_trusted_device'),
      });
      await applyDeviceState(input.deviceId, state, record.riskScore).catch(() => undefined);
    }
    if (record.requiresReview && input.userId) {
      emitToUser(input.userId, 'risk:updated', {
        decision: publicSafe(record),
        timestamp: record.timestamp,
      });
    }
  }

  void shadowHeuristic(signals);
  return record;
}

function publicSafe(record: RiskDecisionRecord): { state: string; requiresVerification: boolean } {
  return {
    state:
      record.decision === 'allow' || record.decision === 'allow_with_monitoring'
        ? 'ok'
        : record.decision === 'block' || record.decision === 'temporary_restriction'
          ? 'restricted'
          : 'verify',
    requiresVerification: record.decision === 'step_up_verification' || record.decision === 'review',
  };
}

export function policyForEvent(eventType: string): string {
  if (eventType.startsWith('LOGIN') || eventType === 'NEW_DEVICE' || eventType === 'REGISTER') return 'login';
  if (eventType.startsWith('PAYMENT') || eventType.startsWith('SUBSCRIPTION')) return 'payment';
  if (eventType.startsWith('LISTING')) return 'listing';
  if (eventType.startsWith('REVIEW')) return 'review';
  if (eventType.startsWith('KYC') || eventType.startsWith('DOCUMENT')) return 'kyc';
  return 'default';
}

async function persistDecision(record: RiskDecisionRecord): Promise<void> {
  await insertAndGetId(
    `INSERT INTO risk_decisions
       (uuid, event_type, subject_kind, subject_id, user_id, device_id, listing_id, review_id, request_id,
        risk_score, risk_level, decision, confidence, signals, rules_triggered, model_id, model_version,
        policy_code, requires_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.uuid,
      record.eventType,
      record.subjectKind,
      record.subjectId,
      record.userId,
      record.deviceId,
      record.listingId,
      record.reviewId,
      record.requestId,
      record.riskScore,
      record.riskLevel,
      record.decision,
      record.confidence,
      JSON.stringify(record.signals),
      JSON.stringify(record.rulesTriggered),
      record.modelId,
      record.modelVersion,
      record.policyCode,
      record.requiresReview ? 1 : 0,
    ],
  );

  for (const signal of record.signals) {
    await execute(
      `INSERT INTO risk_events
         (uuid, subject_kind, subject_id, user_id, device_id, signal_code, score_delta, context, decision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        record.subjectKind,
        record.subjectId,
        record.userId,
        record.deviceId,
        signal.code,
        signal.weight,
        JSON.stringify({ detail: signal.detail ?? null, requestId: record.requestId, event: record.eventType }),
        persistableDecision(record.decision),
      ],
    ).catch(() => undefined);
  }

  if (record.userId) {
    await execute(
      `INSERT INTO risk_scores (subject_kind, subject_id, score, band, factors, signal_count, last_event_at)
       VALUES ('user', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE score = VALUES(score), band = VALUES(band),
                               factors = VALUES(factors), signal_count = VALUES(signal_count),
                               last_event_at = VALUES(last_event_at)`,
      [
        record.userId,
        record.riskScore,
        record.riskLevel,
        JSON.stringify(record.signals),
        record.signals.length,
      ],
    );
  }

  if (record.decision === 'block' || record.requiresReview) {
    log.info(
      { decision: record.decision, score: record.riskScore, rules: record.rulesTriggered, userId: record.userId },
      'risk decision',
    );
  }

  try {
    const evaluated = await eventBus.enqueueNow('risk.evaluated', record.subjectKind, record.subjectId, {
      subjectKind: record.subjectKind,
      subjectId: record.subjectId,
      score: record.riskScore,
      decision: record.decision,
    });
    void eventBus.publishAfterCommit(evaluated);
    if (record.requiresReview) {
      const detected = await eventBus.enqueueNow('fraud.detected', record.subjectKind, record.subjectId, {
        targetKind: record.subjectKind,
        targetId: record.subjectId,
        detectionKind: record.rulesTriggered[0] ?? 'risk_review',
        confidence: record.confidence / 100,
      });
      void eventBus.publishAfterCommit(detected);
    }
  } catch (error) {
    log.debug({ err: error }, 'risk domain event skipped');
  }
}

/** Used by jobs and tests when no request object exists. */
export async function evaluateOffline(input: RiskEvaluationInput): Promise<RiskDecisionRecord> {
  return evaluateRisk(input, []);
}

export async function latestDecision(userId: number): Promise<Row | null> {
  return queryOne<Row>(
    `SELECT uuid, event_type, risk_score, risk_level, decision, requires_review, created_at
       FROM risk_decisions WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    [userId],
  );
}

function persistableDecision(decision: RiskDecisionRecord['decision']): string {
  return decision;
}
