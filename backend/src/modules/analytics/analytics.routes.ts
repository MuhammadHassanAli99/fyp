import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../../core/http/async-handler';
import { accepted, ok } from '../../core/http/response';
import { validate, body, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { writeRateLimit } from '../../middleware/rate-limit';
import { forbidden, unauthenticated } from '../../core/errors';
import { hasPermission } from '../../middleware/authorize';
import { sellerCanAccessDashboard } from '../seller/seller.scope';
import { ingestBatch, ingestEvent } from './analytics.ingest';
import { analyticsQuerySchema, ingestBatchSchema, ingestBodySchema, type AnalyticsQuery } from './analytics.schema';
import {
  getAiInsights,
  getCity,
  getConversion,
  getCountry,
  getDevice,
  getFilters,
  getHeatmaps,
  getOs,
  getOverview,
  getRentals,
  getRevenue,
  getSales,
  getTraffic,
  getUserGrowth,
  getRetention,
} from './analytics.service';

export const analyticsRouter = Router();

analyticsRouter.use(authenticate);

const requireAnalyticsRead: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthenticated());
  if (sellerCanAccessDashboard(req.auth) || hasPermission(req.auth.permissions, 'analytics.view_any')) {
    return next();
  }
  return next(forbidden('Missing permission: analytics.view'));
};

analyticsRouter.post(
  '/events',
  writeRateLimit,
  validate({ body: ingestBodySchema }),
  asyncHandler(async (req, res) => accepted(res, await ingestEvent(body(req)))),
);

analyticsRouter.post(
  '/events/batch',
  writeRateLimit,
  validate({ body: ingestBatchSchema }),
  asyncHandler(async (req, res) => {
    const { events } = body<{ events: Parameters<typeof ingestBatch>[0] }>(req);
    return accepted(res, await ingestBatch(events));
  }),
);

analyticsRouter.get(
  '/health',
  asyncHandler(async (_req, res) => ok(res, { ingest: 'ok' })),
);

const reportQuery = validate({ query: analyticsQuerySchema });

analyticsRouter.get(
  '/overview',
  requireAuth,
  requireAnalyticsRead,
  reportQuery,
  asyncHandler(async (req, res) => ok(res, await getOverview(req.auth!, query<AnalyticsQuery>(req)))),
);
analyticsRouter.get(
  '/sales',
  requireAuth,
  requireAnalyticsRead,
  reportQuery,
  asyncHandler(async (req, res) => ok(res, await getSales(req.auth!, query<AnalyticsQuery>(req)))),
);
analyticsRouter.get(
  '/rentals',
  requireAuth,
  requireAnalyticsRead,
  reportQuery,
  asyncHandler(async (req, res) => ok(res, await getRentals(req.auth!, query<AnalyticsQuery>(req)))),
);
analyticsRouter.get(
  '/revenue',
  requireAuth,
  requireAnalyticsRead,
  reportQuery,
  asyncHandler(async (req, res) => ok(res, await getRevenue(req.auth!, query<AnalyticsQuery>(req)))),
);
analyticsRouter.get(
  '/country',
  requireAuth,
  requireAnalyticsRead,
  reportQuery,
  asyncHandler(async (req, res) => ok(res, await getCountry(req.auth!, query<AnalyticsQuery>(req)))),
);
analyticsRouter.get(
  '/city',
  requireAuth,
  requireAnalyticsRead,
  reportQuery,
  asyncHandler(async (req, res) => ok(res, await getCity(req.auth!, query<AnalyticsQuery>(req)))),
);
analyticsRouter.get(
  '/device',
  requireAuth,
  requireAnalyticsRead,
  reportQuery,
  asyncHandler(async (req, res) => ok(res, await getDevice(req.auth!, query<AnalyticsQuery>(req)))),
);
analyticsRouter.get(
  '/os',
  requireAuth,
  requireAnalyticsRead,
  reportQuery,
  asyncHandler(async (req, res) => ok(res, await getOs(req.auth!, query<AnalyticsQuery>(req)))),
);
analyticsRouter.get(
  '/traffic',
  requireAuth,
  requireAnalyticsRead,
  reportQuery,
  asyncHandler(async (req, res) => ok(res, await getTraffic(req.auth!, query<AnalyticsQuery>(req)))),
);
analyticsRouter.get(
  '/conversion',
  requireAuth,
  requireAnalyticsRead,
  reportQuery,
  asyncHandler(async (req, res) => ok(res, await getConversion(req.auth!, query<AnalyticsQuery>(req)))),
);
analyticsRouter.get(
  '/retention',
  requireAuth,
  requireAnalyticsRead,
  reportQuery,
  asyncHandler(async (req, res) => ok(res, await getRetention(req.auth!, query<AnalyticsQuery>(req)))),
);
analyticsRouter.get(
  '/user-growth',
  requireAuth,
  requireAnalyticsRead,
  reportQuery,
  asyncHandler(async (req, res) => ok(res, await getUserGrowth(req.auth!, query<AnalyticsQuery>(req)))),
);
analyticsRouter.get(
  '/heatmaps',
  requireAuth,
  requireAnalyticsRead,
  reportQuery,
  asyncHandler(async (req, res) => ok(res, await getHeatmaps(req.auth!, query<AnalyticsQuery>(req)))),
);
analyticsRouter.get(
  '/ai-insights',
  requireAuth,
  requireAnalyticsRead,
  reportQuery,
  asyncHandler(async (req, res) => ok(res, await getAiInsights(req.auth!, query<AnalyticsQuery>(req)))),
);
analyticsRouter.get(
  '/filters',
  requireAuth,
  requireAnalyticsRead,
  reportQuery,
  asyncHandler(async (req, res) => ok(res, await getFilters(req.auth!, query<AnalyticsQuery>(req)))),
);
