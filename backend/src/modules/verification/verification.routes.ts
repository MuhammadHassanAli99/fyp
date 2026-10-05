import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok } from '../../core/http/response';
import { validate, body, params } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { writeRateLimit } from '../../middleware/rate-limit';
import { denyGuest } from '../../middleware/authorize';
import { forbidden } from '../../core/errors';
import {
  attachDocumentSchema,
  reviewVerificationSchema,
  startVerificationSchema,
  type AttachDocumentInput,
  type ReviewVerificationInput,
  type StartVerificationInput,
} from './verification.schema';
import {
  attachDocument,
  getMyVerification,
  getVerificationByUuid,
  issueDocumentAccess,
  parseDocumentAccessToken,
  readProtectedDocument,
  reviewVerification,
  startVerification,
  submitVerification,
} from './verification.service';

export const verificationRouter = Router();

verificationRouter.get(
  '/documents/:id/content',
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    query: z.object({ token: z.string().min(20).max(512) }),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const token = String(req.query.token);
    const parsed = parseDocumentAccessToken(token);
    if (parsed.documentId !== id) throw forbidden('Token does not match this document');
    const file = await readProtectedDocument(id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(file.bytes);
  }),
);

verificationRouter.use(authenticate, requireAuth, denyGuest('use verification'));

verificationRouter.get(
  '/',
  asyncHandler(async (req, res) => ok(res, await getMyVerification(req.auth!.userId))),
);

verificationRouter.post(
  '/',
  writeRateLimit,
  validate({ body: startVerificationSchema }),
  asyncHandler(async (req, res) => {
    return created(res, await startVerification(req.auth!.userId, body<StartVerificationInput>(req)));
  }),
);

verificationRouter.get(
  '/:uuid',
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await getVerificationByUuid(uuid, req.auth!.userId, req.auth!.isStaff));
  }),
);

verificationRouter.post(
  '/:uuid/documents',
  writeRateLimit,
  validate({
    params: z.object({ uuid: z.string().uuid() }),
    body: attachDocumentSchema,
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return created(res, await attachDocument(req.auth!.userId, uuid, body<AttachDocumentInput>(req)));
  }),
);

verificationRouter.post(
  '/:uuid/submit',
  writeRateLimit,
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await submitVerification(req.auth!.userId, uuid));
  }),
);

verificationRouter.post(
  '/:uuid/review',
  requirePermission('verification.approve', 'verification.reject'),
  writeRateLimit,
  validate({
    params: z.object({ uuid: z.string().uuid() }),
    body: reviewVerificationSchema,
  }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return ok(res, await reviewVerification(req.auth!.userId, uuid, body<ReviewVerificationInput>(req)));
  }),
);

verificationRouter.post(
  '/documents/:id/access',
  requirePermission('verification.view_any'),
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return ok(res, await issueDocumentAccess(req.auth!.userId, id));
  }),
);
