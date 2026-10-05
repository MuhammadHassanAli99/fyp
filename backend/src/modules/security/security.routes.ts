import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { ok, page } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireAuth, requireMfa } from '../../middleware/authenticate';
import { requirePermission, requireStaff } from '../../middleware/authorize';
import { privacyRateLimit, writeRateLimit } from '../../middleware/rate-limit';
import { recordAudit } from '../../middleware/audit';
import { paginationSchema } from '../../core/http/pagination';
import { AppError, ErrorCode } from '../../core/errors';
import {
  consentUpdateSchema,
  privacyCreateSchema,
  privacyStaffDecideSchema,
} from './security.schema';
import {
  createPrivacyRequest,
  downloadPrivacyExport,
  getPrivacyRequest,
  listConsents,
  listPrivacyRequests,
  privacyApplicability,
  recordConsent,
  staffDecidePrivacyRequest,
  staffListPrivacyRequests,
} from './security.privacy';
import { securityOverview } from './security.monitor';
import { disasterTargets } from './security.backup';
import { publicSecurityConfig } from './security.secrets';
import { queryOne, type Row } from '../../db/query';
import { logout } from '../auth/auth.service';

export const securityRouter = Router();

securityRouter.use(authenticate);

securityRouter.get(
  '/policy',
  asyncHandler(async (_req, res) =>
    ok(res, {
      ...publicSecurityConfig(),
      disaster: disasterTargets(),
      pipeline: [
        'tls',
        'cdn_ddos',
        'waf',
        'rate_limit',
        'validation',
        'authentication',
        'session',
        'device_risk',
        'rbac',
        'abac',
        'scope',
        'resource',
        'audit',
        'monitoring',
      ],
    }),
  ),
);

securityRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const country = await queryOne<Row>(
      `SELECT c.iso2 FROM users u LEFT JOIN countries c ON c.id = u.country_id WHERE u.id = ?`,
      [req.auth!.userId],
    );
    return ok(res, {
      userId: req.auth!.userId,
      sessionId: req.auth!.sessionId,
      roles: req.auth!.roles,
      permissions: req.auth!.permissions,
      scopes: req.auth!.scopes,
      mfaSatisfied: req.auth!.mfaSatisfied,
      isStaff: req.auth!.isStaff,
      applicability: privacyApplicability((country?.iso2 as string | null) ?? null),
    });
  }),
);

securityRouter.post(
  '/sessions/revoke-others',
  requireAuth,
  writeRateLimit,
  asyncHandler(async (req, res) => {
    const result = await logout({
      userId: req.auth!.userId,
      sessionId: req.auth!.sessionId,
      allDevices: false,
      otherDevices: true,
    });
    void recordAudit({ action: 'auth.logout_others', entityType: 'user', entityId: req.auth!.userId });
    return ok(res, result);
  }),
);

securityRouter.get(
  '/privacy/applicability',
  requireAuth,
  asyncHandler(async (req, res) => {
    const country = await queryOne<Row>(
      `SELECT c.iso2 FROM users u LEFT JOIN countries c ON c.id = u.country_id WHERE u.id = ?`,
      [req.auth!.userId],
    );
    return ok(res, privacyApplicability((country?.iso2 as string | null) ?? null));
  }),
);

securityRouter.get(
  '/privacy/consents',
  requireAuth,
  asyncHandler(async (req, res) => ok(res, await listConsents(req.auth!.userId))),
);

securityRouter.post(
  '/privacy/consents',
  requireAuth,
  writeRateLimit,
  validate({ body: consentUpdateSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof consentUpdateSchema>>(req);
    return ok(res, await recordConsent(req.auth!.userId, input.consentType, input.granted, input.documentVersion));
  }),
);

securityRouter.get(
  '/privacy/requests',
  requireAuth,
  asyncHandler(async (req, res) => ok(res, await listPrivacyRequests(req.auth!.userId))),
);

securityRouter.post(
  '/privacy/requests',
  requireAuth,
  privacyRateLimit,
  validate({ body: privacyCreateSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof privacyCreateSchema>>(req);
    if ((input.kind === 'erasure' || input.kind === 'deletion') && !req.auth!.mfaSatisfied) {
      throw new AppError('Additional verification required', { status: 401, code: ErrorCode.MFA_REQUIRED });
    }
    const created = await createPrivacyRequest({
      userId: req.auth!.userId,
      kind: input.kind,
      regulation: input.regulation,
      notes: input.notes,
      fields: input.fields,
    });
    return ok(res, created);
  }),
);

securityRouter.get(
  '/privacy/requests/:uuid',
  requireAuth,
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await getPrivacyRequest(req.auth!.userId, uuid, Boolean(req.auth!.isStaff)));
  }),
);

securityRouter.get(
  '/privacy/requests/:uuid/export',
  requireAuth,
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const buffer = await downloadPrivacyExport(req.auth!.userId, uuid, Boolean(req.auth!.isStaff));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="privacy-export-${uuid}.json"`);
    res.send(buffer);
  }),
);

securityRouter.post(
  '/privacy/requests/:uuid/erasure',
  requireAuth,
  requireMfa,
  privacyRateLimit,
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const created = await createPrivacyRequest({
      userId: req.auth!.userId,
      kind: 'erasure',
    });
    return ok(res, created);
  }),
);

/* Staff facades also mounted under /admin/security */
securityRouter.get(
  '/admin/overview',
  requireAuth,
  requireStaff,
  requirePermission('audit.view_any', 'risk.view_any', 'admin.view'),
  asyncHandler(async (_req, res) => ok(res, await securityOverview())),
);

securityRouter.get(
  '/admin/privacy',
  requireAuth,
  requireStaff,
  requirePermission('user.export', 'user.delete', 'admin.view'),
  validate({ query: paginationSchema.extend({ status: z.string().max(32).optional() }) }),
  asyncHandler(async (req, res) => {
    const q = query<{ page: number; perPage: number; status?: string }>(req);
    const result = await staffListPrivacyRequests(q.page, q.perPage, q.status);
    return page(res, { items: result.items, total: result.total, page: q.page, perPage: q.perPage });
  }),
);

securityRouter.post(
  '/admin/privacy/:uuid',
  requireAuth,
  requireStaff,
  requirePermission('user.export', 'user.delete'),
  validate({ params: z.object({ uuid: z.string().uuid() }), body: privacyStaffDecideSchema }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const input = body<z.infer<typeof privacyStaffDecideSchema>>(req);
    return ok(res, await staffDecidePrivacyRequest(uuid, req.auth!.userId, input.status, input.notes));
  }),
);
