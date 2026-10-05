import type { Request, RequestHandler } from 'express';
import { AppError, ErrorCode } from '../core/errors';
import { loggerFor } from '../config/logger';
import { collectRequestSignals } from '../modules/risk/risk.signals';
import { evaluateRisk } from '../modules/risk/risk.engine';
import { toLegacyDecision } from '../modules/risk/risk.policy';
import type { RiskDecision as EngineDecision } from '../modules/risk/risk.types';

const log = loggerFor('risk');

/** Legacy vocabulary kept for existing callers (payments, auctions, routes). */
export type RiskDecision = 'allow' | 'challenge' | 'review' | 'block';

export interface RiskAssessment {
  score: number;
  decision: RiskDecision;
  engineDecision: EngineDecision;
  signals: Array<{ code: string; weight: number; detail?: string }>;
}

/**
 * Request-path gateway into the central Risk Engine.
 *
 * VPN / emulator / root remain signals. The engine caps non-conclusive-only
 * totals so those flags cannot block by themselves. Ordinary clients never
 * receive the numeric score.
 */
export async function assessRequestRisk(req: Request): Promise<RiskAssessment> {
  const requestSignals = await collectRequestSignals(req);
  const persist =
    requestSignals.some((s) => s.weight >= 100 || s.code === 'active_sanction') ||
    requestSignals.reduce((sum, s) => sum + s.weight, 0) > 29.99;

  const record = await evaluateRisk(
    {
      eventType: 'REQUEST',
      subjectKind: req.auth ? 'user' : 'session',
      subjectId: req.auth?.userId ?? 0,
      userId: req.auth?.userId ?? null,
      deviceId: req.device.id,
      requestId: req.context.requestId,
      ip: req.context.ip,
      countryId: req.context.countryId,
      persist,
    },
    requestSignals,
  );

  return {
    score: record.riskScore,
    decision: toLegacyDecision(record.decision),
    engineDecision: record.decision,
    signals: record.signals,
  };
}

/**
 * Applies the assessment. `mode` controls how aggressive the gate is:
 * `observe` records only; `enforce` blocks; `strict` also blocks on `review`.
 */
export const riskGuard =
  (mode: 'observe' | 'enforce' | 'strict' = 'enforce'): RequestHandler =>
  (req, res, next) => {
    void (async () => {
      const assessment = await assessRequestRisk(req);
      req.context.riskScore = assessment.score;
      req.context.riskDecision = assessment.decision;

      if (req.auth?.isStaff) {
        res.setHeader('X-Risk-Score', String(assessment.score));
      }

      if (mode === 'observe') return next();

      if (assessment.decision === 'block' || (mode === 'strict' && assessment.decision === 'review')) {
        log.warn(
          { score: assessment.score, signals: assessment.signals.map((s) => s.code), requestId: req.context.requestId },
          'request blocked by risk guard',
        );
        throw new AppError('This request was blocked by our security systems', {
          status: 403,
          code: ErrorCode.RISK_BLOCKED,
          details: { reference: req.context.requestId },
        });
      }

      if (assessment.decision === 'challenge' || assessment.engineDecision === 'step_up_verification') {
        res.setHeader('X-Requires-Challenge', 'captcha');
      }

      next();
    })().catch(next);
  };
