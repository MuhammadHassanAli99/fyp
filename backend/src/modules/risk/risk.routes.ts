import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok } from '../../core/http/response';
import { validate, body, query, params } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { requirePermission, requireStaff } from '../../middleware/authorize';
import { publicDecisionFromUnknown } from './risk.policy';
import { latestDecision } from './risk.engine';
import { getKyc, listKycQueue } from './risk.kyc';
import { listAmlQueue, reviewAml, latestAml } from './risk.aml';
import { listAccessEntries, upsertAccessList, appealAccessList } from './risk.lists';
import { getFraudCase, listFraudCases, updateFraudCase } from './risk.cases';
import { listDecisions, multipleAccounts, riskOverview, suspiciousSubjects } from './risk.dashboard';
import { relatedUsersFor } from './risk.graph';
import { listUserDevices } from './risk.device';
import { latestAto } from './risk.login';
import { notFound } from '../../core/errors';

export const riskRouter = Router();

riskRouter.use(authenticate);

/** Ordinary users see coarse verification state, never raw scores or signals. */
riskRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [decision, kyc, aml, ato] = await Promise.all([
      latestDecision(req.auth!.userId),
      getKyc(req.auth!.userId),
      latestAml(req.auth!.userId),
      latestAto(req.auth!.userId),
    ]);
    const mapped = decision ? publicDecisionFromUnknown(String(decision.decision)) : 'ok';
    return ok(res, {
      state: mapped,
      kycStatus: kyc.status,
      identityVerified: kyc.status === 'verified',
      amlClear: !aml || String(aml.result) === 'clear',
      recentSecurityAlert: Boolean(ato && Number(ato.is_false_positive) !== 1),
    });
  }),
);

riskRouter.get(
  '/me/devices',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await listUserDevices(req.auth!.userId);
    return ok(
      res,
      rows.map((row) => {
        const status = String(row.status ?? 'active');
        const state =
          status === 'blocked' || status === 'suspicious' || status === 'revoked'
            ? 'restricted'
            : status === 'first_seen'
              ? 'verify'
              : 'ok';
        return {
          uuid: row.uuid,
          platform: row.platform,
          deviceModel: row.device_model,
          lastSeenAt: row.last_seen_at,
          state,
        };
      }),
    );
  }),
);

const staff = [authenticate, requireAuth, requireStaff];

riskRouter.get(
  '/overview',
  ...staff,
  requirePermission('risk.view_any'),
  validate({
    query: z.object({ from: z.string().optional(), to: z.string().optional() }),
  }),
  asyncHandler(async (req, res) => ok(res, await riskOverview(query(req)))),
);

riskRouter.get(
  '/suspicious/:kind',
  ...staff,
  requirePermission('risk.view_any'),
  validate({
    params: z.object({ kind: z.enum(['users', 'devices', 'ips']) }),
  }),
  asyncHandler(async (req, res) => {
    const kind = params<{ kind: string }>(req).kind;
    const mapped = kind === 'users' ? 'user' : kind === 'devices' ? 'device' : 'ip';
    return ok(res, await suspiciousSubjects(mapped));
  }),
);

riskRouter.get(
  '/multiple-accounts',
  ...staff,
  requirePermission('risk.view_any'),
  asyncHandler(async (_req, res) => ok(res, await multipleAccounts())),
);

riskRouter.get(
  '/graph/:userId',
  ...staff,
  requirePermission('risk.view_any'),
  validate({ params: z.object({ userId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const userId = params<{ userId: number }>(req).userId;
    return ok(res, await relatedUsersFor('user', String(userId)));
  }),
);

riskRouter.get(
  '/decisions',
  ...staff,
  requirePermission('risk.view_any'),
  validate({
    query: z.object({
      decision: z.string().optional(),
      riskLevel: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await listDecisions(query(req)))),
);

riskRouter.get(
  '/cases',
  ...staff,
  requirePermission('fraud_case.view_any'),
  validate({
    query: z.object({
      status: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await listFraudCases(query(req)))),
);

riskRouter.get(
  '/cases/:id',
  ...staff,
  requirePermission('fraud_case.view_any'),
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const found = await getFraudCase(params<{ id: number }>(req).id);
    if (!found) throw notFound('Fraud case');
    return ok(res, found);
  }),
);

riskRouter.patch(
  '/cases/:id',
  ...staff,
  requirePermission('fraud_case.update'),
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({
      status: z.enum(['open', 'investigating', 'confirmed', 'false_positive', 'resolved', 'appealed']).optional(),
      assignedTo: z.coerce.number().int().positive().optional(),
      findings: z.string().max(5000).optional(),
      resolution: z.string().max(64).optional(),
      isFalsePositive: z.coerce.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const id = params<{ id: number }>(req).id;
    const patch = body<{
      status?: 'open' | 'investigating' | 'confirmed' | 'false_positive' | 'resolved' | 'appealed';
      assignedTo?: number;
      findings?: string;
      resolution?: string;
      isFalsePositive?: boolean;
    }>(req);
    await updateFraudCase({ caseId: id, actorId: req.auth!.userId, ...patch });
    return ok(res, await getFraudCase(id));
  }),
);

riskRouter.get(
  '/lists',
  ...staff,
  requirePermission('sanction.view_any'),
  validate({
    query: z.object({
      listKind: z.enum(['blacklist', 'whitelist', 'greylist']).optional(),
      entryKind: z.string().optional(),
      limit: z.coerce.number().int().optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await listAccessEntries(query(req)))),
);

riskRouter.post(
  '/lists',
  ...staff,
  requirePermission('sanction.create'),
  validate({
    body: z.object({
      listKind: z.enum(['blacklist', 'whitelist', 'greylist']),
      entryKind: z.string().min(2).max(32),
      value: z.string().min(1).max(255),
      reason: z.string().min(3).max(500),
      source: z.enum(['manual', 'automated', 'partner', 'regulator']).optional(),
      severity: z.enum(['info', 'low', 'medium', 'high', 'critical']).optional(),
      expiresAt: z.string().datetime().optional().nullable(),
      untilReview: z.coerce.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const id = await upsertAccessList({ ...body(req), addedBy: req.auth!.userId });
    return created(res, { id });
  }),
);

riskRouter.post(
  '/lists/:id/appeal',
  requireAuth,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({ note: z.string().min(3).max(500) }),
  }),
  asyncHandler(async (req, res) => {
    await appealAccessList(params<{ id: number }>(req).id, body<{ note: string }>(req).note);
    return ok(res, { appealed: true });
  }),
);

riskRouter.get(
  '/kyc',
  ...staff,
  requirePermission('kyc.view_any'),
  asyncHandler(async (_req, res) => ok(res, await listKycQueue())),
);

riskRouter.get(
  '/aml',
  ...staff,
  requirePermission('aml.view_any'),
  asyncHandler(async (_req, res) => ok(res, await listAmlQueue())),
);

riskRouter.patch(
  '/aml/:id',
  ...staff,
  requirePermission('aml.review'),
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({ result: z.enum(['clear', 'match']) }),
  }),
  asyncHandler(async (req, res) => {
    await reviewAml(params<{ id: number }>(req).id, req.auth!.userId, body<{ result: 'clear' | 'match' }>(req).result);
    return ok(res, { updated: true });
  }),
);
