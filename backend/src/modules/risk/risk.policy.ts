import type { RiskDecision, RiskLevel, RiskPolicyThresholds, RiskSignalHit } from './risk.types';
import { NON_CONCLUSIVE_SIGNALS } from './risk.types';

export const DEFAULT_THRESHOLDS: RiskPolicyThresholds = {
  code: 'default',
  allowMax: 29.99,
  monitorMax: 44.99,
  stepUpMax: 64.99,
  reviewMax: 79.99,
  restrictionMax: 89.99,
  whitelistScoreReduction: 20,
};

/**
 * Maps a 0–100 score onto a decision using stored (or default) bands.
 * Block is reserved for blacklists, sanctions, and scores above restrictionMax.
 */
export function decisionForScore(score: number, policy: RiskPolicyThresholds): RiskDecision {
  if (score >= policy.restrictionMax + 0.01) return 'block';
  if (score > policy.reviewMax) return 'temporary_restriction';
  if (score > policy.stepUpMax) return 'review';
  if (score > policy.monitorMax) return 'step_up_verification';
  if (score > policy.allowMax) return 'allow_with_monitoring';
  return 'allow';
}

export function levelForScore(score: number): RiskLevel {
  if (score >= 90) return 'critical';
  if (score >= 65) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score * 100) / 100));
}

/**
 * Combine signal weights. A single non-conclusive signal (VPN, root, shared IP)
 * cannot reach block even if its catalogue weight is large — blocking requires
 * a combination, a blacklist, or an active sanction.
 */
export function combineSignalWeights(signals: RiskSignalHit[]): number {
  const hard = signals.filter((s) => s.code.endsWith('_blacklisted') || s.code === 'active_sanction' || s.code === 'aml_match');
  if (hard.some((s) => s.weight >= 100)) return 100;

  const total = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const conclusive = signals.filter((s) => !NON_CONCLUSIVE_SIGNALS.has(s.code) && s.weight > 0);
  if (conclusive.length === 0 && total > 0) {
    return clampScore(Math.min(total, 39.99));
  }
  return clampScore(total);
}

export function requiresReview(decision: RiskDecision): boolean {
  return decision === 'review' || decision === 'temporary_restriction' || decision === 'block';
}

export function publicDecisionForUser(decision: RiskDecision): 'ok' | 'verify' | 'restricted' {
  return publicDecisionFromUnknown(decision);
}

export function publicDecisionFromUnknown(value: string): 'ok' | 'verify' | 'restricted' {
  if (value === 'step_up_verification' || value === 'review' || value === 'challenge') return 'verify';
  if (value === 'block' || value === 'temporary_restriction' || value === 'ban') return 'restricted';
  return 'ok';
}

/** Legacy risk-guard vocabulary used by existing middleware callers. */
export function toLegacyDecision(decision: RiskDecision): 'allow' | 'challenge' | 'review' | 'block' {
  if (decision === 'block' || decision === 'temporary_restriction') return 'block';
  if (decision === 'review') return 'review';
  if (decision === 'step_up_verification') return 'challenge';
  return 'allow';
}

/** Payments prefer review over an automatic hold except for a true block. */
export function toPaymentLegacyDecision(decision: RiskDecision): 'allow' | 'challenge' | 'review' | 'block' {
  if (decision === 'block') return 'block';
  if (decision === 'temporary_restriction' || decision === 'review') return 'review';
  if (decision === 'step_up_verification') return 'challenge';
  return 'allow';
}
