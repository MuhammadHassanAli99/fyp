import { Router } from 'express';
import { asyncHandler } from '../../core/http/async-handler';
import { ok } from '../../core/http/response';
import { validate, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { resolveMarketplace } from '../../middleware/request-context';
import { dashboardQuerySchema, type DashboardQuery } from './seller.schema';
import {
  getDashboardAnalytics,
  getDashboardFollowers,
  getDashboardInvoices,
  getDashboardLeads,
  getDashboardListings,
  getDashboardMessages,
  getDashboardPromotions,
  getDashboardRevenue,
  getDashboardSubscription,
  getDashboardSummary,
  getDashboardViews,
  getSellerDashboard,
} from './seller.service';

export const sellerRouter = Router();

sellerRouter.use(
  authenticate,
  requireAuth,
  resolveMarketplace,
  requirePermission('analytics.view', 'listing.view', 'sales.view'),
);

const dashboardQuery = validate({ query: dashboardQuerySchema });

sellerRouter.get(
  '/dashboard',
  dashboardQuery,
  asyncHandler(async (req, res) => {
    return ok(res, await getSellerDashboard(req.auth!, query<DashboardQuery>(req)));
  }),
);

sellerRouter.get(
  '/dashboard/summary',
  dashboardQuery,
  asyncHandler(async (req, res) => {
    return ok(res, await getDashboardSummary(req.auth!, query<DashboardQuery>(req)));
  }),
);

sellerRouter.get(
  '/dashboard/revenue',
  dashboardQuery,
  asyncHandler(async (req, res) => {
    return ok(res, await getDashboardRevenue(req.auth!, query<DashboardQuery>(req)));
  }),
);

sellerRouter.get(
  '/dashboard/views',
  dashboardQuery,
  asyncHandler(async (req, res) => {
    return ok(res, await getDashboardViews(req.auth!, query<DashboardQuery>(req)));
  }),
);

sellerRouter.get(
  '/dashboard/leads',
  dashboardQuery,
  asyncHandler(async (req, res) => {
    return ok(res, await getDashboardLeads(req.auth!, query<DashboardQuery>(req)));
  }),
);

sellerRouter.get(
  '/dashboard/messages',
  dashboardQuery,
  asyncHandler(async (req, res) => {
    return ok(res, await getDashboardMessages(req.auth!, query<DashboardQuery>(req)));
  }),
);

sellerRouter.get(
  '/dashboard/followers',
  dashboardQuery,
  asyncHandler(async (req, res) => {
    return ok(res, await getDashboardFollowers(req.auth!, query<DashboardQuery>(req)));
  }),
);

sellerRouter.get(
  '/dashboard/listings',
  dashboardQuery,
  asyncHandler(async (req, res) => {
    return ok(res, await getDashboardListings(req.auth!, query<DashboardQuery>(req)));
  }),
);

sellerRouter.get(
  '/dashboard/analytics',
  dashboardQuery,
  asyncHandler(async (req, res) => {
    return ok(res, await getDashboardAnalytics(req.auth!, query<DashboardQuery>(req)));
  }),
);

sellerRouter.get(
  '/dashboard/promotions',
  dashboardQuery,
  asyncHandler(async (req, res) => {
    return ok(res, await getDashboardPromotions(req.auth!, query<DashboardQuery>(req)));
  }),
);

sellerRouter.get(
  '/dashboard/invoices',
  dashboardQuery,
  asyncHandler(async (req, res) => {
    return ok(res, await getDashboardInvoices(req.auth!, query<DashboardQuery>(req)));
  }),
);

sellerRouter.get(
  '/dashboard/subscription',
  dashboardQuery,
  asyncHandler(async (req, res) => {
    return ok(res, await getDashboardSubscription(req.auth!));
  }),
);
