import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { ok } from '../../core/http/response';
import { validate, params } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { resolveShareToken } from './share.service';

export const shareRouter = Router();

/** Public share links — auth is optional so a guest can open a shared collection/listing. */
shareRouter.use(authenticate);

shareRouter.get(
  '/:token',
  validate({ params: z.object({ token: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { token } = params<{ token: string }>(req);
    return ok(res, await resolveShareToken(token));
  }),
);
