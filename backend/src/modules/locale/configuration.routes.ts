import { Router } from 'express';
import { asyncHandler } from '../../core/http/async-handler';
import { ok, withCache } from '../../core/http/response';
import { authenticate } from '../../middleware/authenticate';
import { getConfiguration } from './configuration.service';

export const configurationRouter = Router();

/**
 * Lightweight versioned configuration for cold start (§23 / §24).
 * Full country/language/currency rows stay on /locale/* so clients can
 * skip those payloads when their local version stamp still matches.
 */
configurationRouter.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const payload = await getConfiguration(req.context.countryId, req.context.language);
    withCache(res, 60);
    return ok(res, payload);
  }),
);
