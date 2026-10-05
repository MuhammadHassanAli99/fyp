import { Router, type Request, type Response } from 'express';
import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok } from '../../core/http/response';
import { validate, body } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { uploadRateLimit } from '../../middleware/rate-limit';
import { badRequest } from '../../core/errors';
import { isLocalStorage } from '../../providers/storage';
import { getPublicBaseUrl, relayLocalUpload, signUpload } from './uploads.service';
import type { StoragePurpose } from '../../providers/storage';

export const uploadsRouter = Router();

uploadsRouter.use(authenticate, requireAuth);

uploadsRouter.post(
  '/sign',
  uploadRateLimit,
  validate({
    body: z.object({
      purpose: z.enum([
        'listing_media',
        'avatar',
        'cover',
        'document',
        'verification',
        'review_media',
        'ad_creative',
        'chat_attachment',
        'search_image',
        'search_voice',
      ]),
      mimeType: z.string().trim().min(3).max(96),
      sizeBytes: z.coerce.number().int().positive(),
      filename: z.string().max(255).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      purpose: StoragePurpose;
      mimeType: string;
      sizeBytes: number;
      filename?: string;
    }>(req);
    return created(res, await signUpload(req.auth!.userId, input));
  }),
);

/** Local storage relay — receives bytes for a signed token. */
uploadsRouter.put(
  '/local/:token',
  // Token is HMAC payload with a `.` separator — keep it as one path segment.
  validate({
    params: z.object({
      token: z.string().trim().min(10).max(4096),
    }),
  }),
  express.raw({ type: '*/*', limit: '30mb' }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!isLocalStorage()) throw badRequest('Local upload relay is only available with STORAGE_DRIVER=local');
    // Prefer validated params; fall back to Express params if validate was skipped.
    const token =
      (req.valid?.params as { token?: string } | undefined)?.token ??
      (typeof req.params.token === 'string' ? req.params.token : '');
    if (!token) throw badRequest('Missing upload token');
    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data) || data.length === 0) throw badRequest('Empty upload body');
    const contentType = String(req.headers['content-type'] ?? 'application/octet-stream')
      .split(';')[0]!
      .trim()
      .toLowerCase();
    return ok(res, await relayLocalUpload(token, data, contentType));
  }),
);

uploadsRouter.get(
  '/config',
  asyncHandler(async (_req, res) =>
    ok(res, {
      driver: isLocalStorage() ? 'local' : 'remote',
      publicUrl: getPublicBaseUrl(),
    }),
  ),
);
