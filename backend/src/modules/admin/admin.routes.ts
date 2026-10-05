import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { accepted, created, ok, page } from '../../core/http/response';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { body, params, query, validate } from '../../middleware/validate';
import { aiUsageReport } from '../ai/ai.service';
import { requireAdminAccess } from './admin.authz';
import { gatePrivileged, markExecuted, listApprovals, decideApproval } from './admin.approvals';
import {
  adminListQuery,
  approvalDecideSchema,
  assignRoleSchema,
  appointmentSchema,
  bannerSchema,
  broadcastSchema,
  categoryUpsertSchema,
  cmsPageSchema,
  companyStatusSchema,
  countryUpdateSchema,
  createRoleSchema,
  currencyUpdateSchema,
  departmentSchema,
  employeeSchema,
  languageUpdateSchema,
  leadSchema,
  leadUpdateSchema,
  listingActionParam,
  listingActionSchema,
  noteSchema,
  quoteSchema,
  reasonSchema,
  refundAdminSchema,
  reportJobSchema,
  roleUpdateSchema,
  subscriptionOverrideSchema,
  ticketAssignSchema,
  ticketReplySchema,
  translationUpsertSchema,
  userActionSchema,
  type AdminListQuery,
} from './admin.schema';
import { getAdminSession, getAdminSummary } from './admin.service';
import { getSystemHealthSnapshot } from './admin.health';
import {
  assignRole,
  createDepartment,
  createRole,
  disableEmployee,
  getCompany,
  getRole,
  getUser,
  listCompanies,
  listEmployees,
  listPermissions,
  listRoles,
  listUserDevices,
  listUsers,
  listUserSessions,
  revokeAssignment,
  setCompanyStatus,
  setUserStatus,
  updateRole,
  upsertEmployee,
} from './admin.directory';
import {
  actOnListing,
  adminRefund,
  listAdminCategories,
  listAdminCountries,
  listAdminCurrencies,
  listAdminInvoices,
  listAdminLanguages,
  listAdminListings,
  listAdminPayments,
  listAdminRefunds,
  listAdminSubscriptions,
  listAdminTranslations,
  overrideSubscription,
  updateCountry,
  updateCurrency,
  updateLanguage,
  upsertCategory,
  upsertTranslation,
} from './admin.commerce';
import {
  adminAnalytics,
  adminDecideAd,
  adminDecideReview,
  adminFraudDecisions,
  adminFraudOverview,
  adminKycQueue,
  adminModerationQueue,
  adminReviewKyc,
  assignTicket,
  createBroadcast,
  decideModerationItem,
  getAdminTicket,
  listAdminTickets,
  listAuditLogs,
  listBanners,
  listCmsPages,
  replyTicket,
  upsertBanner,
  upsertCmsPage,
} from './admin.ops';
import {
  addNote,
  createAppointment,
  createLead,
  createQuote,
  listCommissions,
  listLeads,
  salesAnalytics,
  updateLead,
} from './admin.sales';
import { getReport, listReports, queueReport } from './admin.reports';
import { securityOverview } from '../security/security.monitor';
import { privacyStaffDecideSchema } from '../security/security.schema';
import { staffDecidePrivacyRequest, staffListPrivacyRequests } from '../security/security.privacy';

export const adminRouter = Router();

const idParam = z.object({ id: z.coerce.number().int().positive() });
const uuidParam = z.object({ uuid: z.string().uuid() });
const codeParam = z.object({ code: z.string().trim().min(1).max(64) });

adminRouter.use(authenticate, requireAuth, requireAdminAccess);

adminRouter.get(
  '/me',
  asyncHandler(async (req, res) => ok(res, await getAdminSession(req))),
);

adminRouter.get(
  '/summary',
  requirePermission('admin.view', 'admin.access'),
  asyncHandler(async (req, res) => ok(res, await getAdminSummary(req))),
);

adminRouter.get(
  '/health',
  requirePermission('system_health.view', 'admin.view'),
  asyncHandler(async (_req, res) => ok(res, await getSystemHealthSnapshot())),
);

adminRouter.get(
  '/ai/usage',
  requirePermission('ai.view_any'),
  asyncHandler(async (req, res) => {
    const period = req.query.period === 'month' ? 'month' : 'today';
    return ok(res, await aiUsageReport(period));
  }),
);

/* -------------------------------------------------------------------------- */
/* Directory                                                                  */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/users',
  requirePermission('user.view_any'),
  validate({ query: adminListQuery }),
  asyncHandler(async (req, res) => page(res, await listUsers(req.auth!, query<AdminListQuery>(req)))),
);

adminRouter.get(
  '/users/:id',
  requirePermission('user.view_any'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => ok(res, await getUser(req.auth!, params<{ id: number }>(req).id))),
);

adminRouter.post(
  '/users/:id/status',
  requirePermission('user.update', 'user.suspend', 'user.ban'),
  validate({ params: idParam, body: userActionSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<z.infer<typeof userActionSchema>>(req);
    const status = input.status ?? 'suspended';
    const permission = status === 'banned' ? 'user.ban' : status === 'suspended' ? 'user.suspend' : 'user.update';
    const gated = await gatePrivileged(req, {
      permission,
      action: `user.${status}`,
      resourceType: 'user',
      resourceId: id,
      reason: input.reason,
      confirm: input.confirm ?? status === 'active',
      approvalRequestUuid: input.approvalRequestUuid,
      payload: { status },
    });
    if (gated.queued) return accepted(res, gated.request);
    const result = await setUserStatus(req, id, status, input.reason);
    await markExecuted(input.approvalRequestUuid);
    return ok(res, result);
  }),
);

adminRouter.get(
  '/users/:id/sessions',
  requirePermission('user.view_any'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => ok(res, await listUserSessions(req.auth!, params<{ id: number }>(req).id))),
);

adminRouter.get(
  '/users/:id/devices',
  requirePermission('user.view_any'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => ok(res, await listUserDevices(req.auth!, params<{ id: number }>(req).id))),
);

adminRouter.get(
  '/companies',
  requirePermission('business.view_any', 'business.view'),
  validate({ query: adminListQuery }),
  asyncHandler(async (req, res) => page(res, await listCompanies(req.auth!, query<AdminListQuery>(req)))),
);

adminRouter.get(
  '/companies/:id',
  requirePermission('business.view_any', 'business.view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => ok(res, await getCompany(req.auth!, params<{ id: number }>(req).id))),
);

adminRouter.post(
  '/companies/:id/status',
  requirePermission('business.update', 'business.approve', 'business.reject'),
  validate({ params: idParam, body: companyStatusSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<z.infer<typeof companyStatusSchema>>(req);
    return ok(res, await setCompanyStatus(req, id, input.status, input.reason));
  }),
);

adminRouter.get(
  '/employees',
  requirePermission('employee.view_any'),
  validate({ query: adminListQuery }),
  asyncHandler(async (req, res) => page(res, await listEmployees(req.auth!, query<AdminListQuery>(req)))),
);

adminRouter.post(
  '/companies/:id/employees',
  requirePermission('employee.create', 'employee.update'),
  validate({ params: idParam, body: employeeSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<z.infer<typeof employeeSchema>>(req);
    return created(res, await upsertEmployee(req, id, input));
  }),
);

adminRouter.post(
  '/companies/:id/employees/:userId/disable',
  requirePermission('employee.disable'),
  validate({ params: z.object({ id: z.coerce.number().int().positive(), userId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id, userId } = params<{ id: number; userId: number }>(req);
    return ok(res, await disableEmployee(req, id, userId));
  }),
);

adminRouter.post(
  '/companies/:id/departments',
  requirePermission('employee.update', 'business.update'),
  validate({ params: idParam, body: departmentSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<z.infer<typeof departmentSchema>>(req);
    return created(res, await createDepartment(req, id, input));
  }),
);

adminRouter.get('/roles', requirePermission('role.view_any'), asyncHandler(async (_req, res) => ok(res, await listRoles())));
adminRouter.get(
  '/permissions',
  requirePermission('permission.view_any', 'role.view_any'),
  asyncHandler(async (_req, res) => ok(res, await listPermissions())),
);
adminRouter.get(
  '/roles/:code',
  requirePermission('role.view_any'),
  validate({ params: codeParam }),
  asyncHandler(async (req, res) => ok(res, await getRole(params<{ code: string }>(req).code))),
);
adminRouter.post(
  '/roles',
  requirePermission('role.create'),
  validate({ body: createRoleSchema }),
  asyncHandler(async (req, res) => created(res, await createRole(req, body(req)))),
);
adminRouter.patch(
  '/roles/:code',
  requirePermission('role.update'),
  validate({ params: codeParam, body: roleUpdateSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await updateRole(req, params<{ code: string }>(req).code, body(req))),
  ),
);
adminRouter.post(
  '/users/:id/roles',
  requirePermission('role.assign'),
  validate({ params: idParam, body: assignRoleSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof assignRoleSchema>>(req);
    const gated = await gatePrivileged(req, {
      permission: 'role.assign',
      action: 'role.assign',
      resourceType: 'user',
      resourceId: params<{ id: number }>(req).id,
      reason: input.reason ?? 'Role assignment',
      confirm: true,
      payload: input,
    });
    if (gated.queued) return accepted(res, gated.request);
    return created(res, await assignRole(req, params<{ id: number }>(req).id, input));
  }),
);
adminRouter.delete(
  '/assignments/:uuid',
  requirePermission('role.assign'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => ok(res, await revokeAssignment(req, params<{ uuid: string }>(req).uuid))),
);

/* -------------------------------------------------------------------------- */
/* Commerce                                                                   */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/listings',
  requirePermission('listing.view_any', 'listing.view'),
  validate({ query: adminListQuery }),
  asyncHandler(async (req, res) => page(res, await listAdminListings(req.auth!, query<AdminListQuery>(req)))),
);

adminRouter.post(
  '/listings/:id/:action',
  requirePermission(
    'listing.approve',
    'listing.reject',
    'listing.suspend',
    'listing.feature',
    'listing.boost',
    'listing.moderate',
    'listing.delete',
    'listing.restore',
    'listing.update',
  ),
  validate({ params: listingActionParam, body: listingActionSchema.partial() }),
  asyncHandler(async (req, res) => {
    const { id, action } = params<z.infer<typeof listingActionParam>>(req);
    const input = (req.valid.body ?? {}) as z.infer<typeof listingActionSchema>;
    return ok(res, await actOnListing(req, id, action, input.reason, input.days));
  }),
);

adminRouter.get(
  '/categories',
  requirePermission('category.view_any'),
  validate({ query: z.object({ marketplaceId: z.coerce.number().int().positive().optional() }) }),
  asyncHandler(async (req, res) =>
    ok(res, await listAdminCategories(query<{ marketplaceId?: number }>(req).marketplaceId)),
  ),
);
adminRouter.post(
  '/categories',
  requirePermission('category.create', 'category.update', 'category.manage'),
  validate({ body: categoryUpsertSchema }),
  asyncHandler(async (req, res) => created(res, await upsertCategory(req, body(req)))),
);

adminRouter.get('/countries', requirePermission('country.view_any'), asyncHandler(async (_req, res) => ok(res, await listAdminCountries())));
adminRouter.patch(
  '/countries/:id',
  requirePermission('country.update'),
  validate({ params: idParam, body: countryUpdateSchema }),
  asyncHandler(async (req, res) => ok(res, await updateCountry(req, params<{ id: number }>(req).id, body(req)))),
);

adminRouter.get('/languages', requirePermission('language.view_any'), asyncHandler(async (_req, res) => ok(res, await listAdminLanguages())));
adminRouter.patch(
  '/languages/:code',
  requirePermission('language.update'),
  validate({ params: codeParam, body: languageUpdateSchema }),
  asyncHandler(async (req, res) => ok(res, await updateLanguage(req, params<{ code: string }>(req).code, body(req)))),
);
adminRouter.get(
  '/translations',
  requirePermission('translation.view_any', 'language.view_any'),
  validate({ query: z.object({ language: z.string().optional(), namespace: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = query<{ language?: string; namespace?: string }>(req);
    return ok(res, await listAdminTranslations(q.language, q.namespace));
  }),
);
adminRouter.put(
  '/translations',
  requirePermission('translation.update', 'translation.create'),
  validate({ body: translationUpsertSchema }),
  asyncHandler(async (req, res) => ok(res, await upsertTranslation(req, body(req)))),
);

adminRouter.get('/currencies', requirePermission('currency.view_any'), asyncHandler(async (_req, res) => ok(res, await listAdminCurrencies())));
adminRouter.patch(
  '/currencies/:code',
  requirePermission('currency.update'),
  validate({ params: codeParam, body: currencyUpdateSchema }),
  asyncHandler(async (req, res) => ok(res, await updateCurrency(req, params<{ code: string }>(req).code, body(req)))),
);

adminRouter.get(
  '/subscriptions',
  requirePermission('subscription.view_any', 'subscription.view'),
  validate({ query: adminListQuery }),
  asyncHandler(async (req, res) => page(res, await listAdminSubscriptions(req.auth!, query<AdminListQuery>(req)))),
);
adminRouter.post(
  '/subscriptions/:id/override',
  requirePermission('subscription.manage'),
  validate({ params: idParam, body: subscriptionOverrideSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof subscriptionOverrideSchema>>(req);
    return ok(res, await overrideSubscription(req, params<{ id: number }>(req).id, { reason: input.reason }));
  }),
);

adminRouter.get(
  '/payments',
  requirePermission('payment.view_any', 'payment.view'),
  validate({ query: adminListQuery }),
  asyncHandler(async (req, res) => page(res, await listAdminPayments(req.auth!, query<AdminListQuery>(req)))),
);
adminRouter.get(
  '/refunds',
  requirePermission('refund.view_any', 'refund.view'),
  validate({ query: adminListQuery }),
  asyncHandler(async (req, res) => page(res, await listAdminRefunds(req.auth!, query<AdminListQuery>(req)))),
);
adminRouter.get(
  '/invoices',
  requirePermission('invoice.view_any', 'invoice.view'),
  validate({ query: adminListQuery }),
  asyncHandler(async (req, res) => page(res, await listAdminInvoices(req.auth!, query<AdminListQuery>(req)))),
);
adminRouter.post(
  '/payments/:uuid/refund',
  requirePermission('refund.create'),
  validate({ params: uuidParam, body: refundAdminSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof refundAdminSchema>>(req);
    const gated = await gatePrivileged(req, {
      permission: 'refund.create',
      action: 'refund.create',
      resourceType: 'payment',
      resourceId: params<{ uuid: string }>(req).uuid,
      reason: input.reason,
      confirm: input.confirm,
      approvalRequestUuid: input.approvalRequestUuid,
      amount: input.amount,
    });
    if (gated.queued) return accepted(res, gated.request);
    const result = await adminRefund(req, params<{ uuid: string }>(req).uuid, input.amount, input.reason);
    await markExecuted(input.approvalRequestUuid);
    return ok(res, result);
  }),
);

/* -------------------------------------------------------------------------- */
/* Operations                                                                 */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/moderation',
  requirePermission('moderation.view_any', 'moderation.view'),
  validate({ query: z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() }) }),
  asyncHandler(async (req, res) => {
    const q = query<{ status?: string; limit?: number }>(req);
    return ok(res, await adminModerationQueue(q.status, q.limit ?? 50));
  }),
);
adminRouter.post(
  '/moderation/:id',
  requirePermission('moderation.moderate', 'moderation.approve', 'moderation.reject'),
  validate({
    params: idParam,
    body: reasonSchema.extend({ decision: z.enum(['approved', 'rejected', 'escalated']) }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ decision: 'approved' | 'rejected' | 'escalated'; reason: string }>(req);
    return ok(res, await decideModerationItem(req, params<{ id: number }>(req).id, input.decision, input.reason));
  }),
);

adminRouter.post(
  '/reviews/:uuid',
  requirePermission('review.moderate'),
  validate({
    params: uuidParam,
    body: reasonSchema.extend({ decision: z.enum(['approve', 'reject', 'hide']) }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ decision: 'approve' | 'reject' | 'hide'; reason: string }>(req);
    return ok(res, await adminDecideReview(req, params<{ uuid: string }>(req).uuid, input.decision, input.reason));
  }),
);

adminRouter.post(
  '/ads/:uuid',
  requirePermission('ad_campaign.approve', 'ad_campaign.reject'),
  validate({
    params: uuidParam,
    body: reasonSchema.extend({ decision: z.enum(['approve', 'reject', 'pause']) }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ decision: 'approve' | 'reject' | 'pause'; reason: string }>(req);
    return ok(res, await adminDecideAd(req, params<{ uuid: string }>(req).uuid, input.decision, input.reason));
  }),
);

adminRouter.get(
  '/fraud',
  requirePermission('risk.view_any', 'fraud_case.view_any'),
  validate({ query: z.object({ from: z.string().optional(), to: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = query<{ from?: string; to?: string }>(req);
    return ok(res, await adminFraudOverview(q.from, q.to));
  }),
);
adminRouter.get(
  '/fraud/decisions',
  requirePermission('risk.view_any'),
  validate({ query: z.object({ decision: z.string().optional(), riskLevel: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = query<{ decision?: string; riskLevel?: string }>(req);
    return ok(res, await adminFraudDecisions(q.decision, q.riskLevel));
  }),
);

adminRouter.get('/kyc', requirePermission('kyc.view_any'), asyncHandler(async (_req, res) => ok(res, await adminKycQueue())));
adminRouter.post(
  '/kyc/:uuid',
  requirePermission('kyc.review', 'verification.approve', 'verification.reject'),
  validate({
    params: uuidParam,
    body: reasonSchema.extend({ decision: z.enum(['approved', 'rejected']) }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ decision: 'approved' | 'rejected'; reason: string }>(req);
    return ok(res, await adminReviewKyc(req, params<{ uuid: string }>(req).uuid, input.decision, input.reason));
  }),
);

adminRouter.get(
  '/cms/pages',
  requirePermission('cms_page.view_any'),
  validate({ query: adminListQuery }),
  asyncHandler(async (req, res) => page(res, await listCmsPages(query<AdminListQuery>(req)))),
);
adminRouter.post(
  '/cms/pages',
  requirePermission('cms_page.create', 'cms_page.update'),
  validate({ body: cmsPageSchema.extend({ id: z.coerce.number().int().positive().optional() }) }),
  asyncHandler(async (req, res) => created(res, await upsertCmsPage(req, body(req)))),
);
adminRouter.get('/cms/banners', requirePermission('banner.view_any', 'cms_page.view_any'), asyncHandler(async (_req, res) => ok(res, await listBanners())));
adminRouter.post(
  '/cms/banners',
  requirePermission('banner.create'),
  validate({ body: bannerSchema }),
  asyncHandler(async (req, res) => created(res, await upsertBanner(req, body(req)))),
);

adminRouter.post(
  '/notifications/broadcasts',
  requirePermission('notification.create'),
  validate({ body: broadcastSchema }),
  asyncHandler(async (req, res) => created(res, await createBroadcast(req, body(req)))),
);

adminRouter.get(
  '/support',
  requirePermission('ticket.view_any', 'ticket.view'),
  validate({ query: adminListQuery }),
  asyncHandler(async (req, res) => page(res, await listAdminTickets(req.auth!, query<AdminListQuery>(req)))),
);
adminRouter.get(
  '/support/analytics',
  requirePermission('ticket.view_any', 'ticket.manage', 'analytics.view_any'),
  asyncHandler(async (req, res) => {
    const { supportOverview } = await import('../support/support.analytics');
    return ok(res, await supportOverview(req.auth!));
  }),
);
adminRouter.get(
  '/support/:uuid',
  requirePermission('ticket.view_any', 'ticket.view'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => ok(res, await getAdminTicket(params<{ uuid: string }>(req).uuid))),
);
adminRouter.post(
  '/support/:uuid/assign',
  requirePermission('ticket.update', 'ticket.manage'),
  validate({ params: uuidParam, body: ticketAssignSchema }),
  asyncHandler(async (req, res) => ok(res, await assignTicket(req, params<{ uuid: string }>(req).uuid, body(req)))),
);
adminRouter.post(
  '/support/:uuid/reply',
  requirePermission('ticket.update'),
  validate({ params: uuidParam, body: ticketReplySchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof ticketReplySchema>>(req);
    return ok(res, await replyTicket(req, params<{ uuid: string }>(req).uuid, input.body, input.internal));
  }),
);

adminRouter.get(
  '/audit',
  requirePermission('audit.view_any', 'audit.view'),
  validate({ query: adminListQuery }),
  asyncHandler(async (req, res) => page(res, await listAuditLogs(query<AdminListQuery>(req)))),
);

adminRouter.get(
  '/analytics',
  requirePermission('analytics.view_any', 'analytics.view'),
  validate({ query: z.object({ from: z.string().optional() }) }),
  asyncHandler(async (req, res) => ok(res, await adminAnalytics(req.auth!, query<{ from?: string }>(req).from))),
);

adminRouter.get(
  '/reports',
  requirePermission('report.view_any', 'report.export', 'report.manage'),
  asyncHandler(async (req, res) => ok(res, await listReports(req))),
);
adminRouter.post(
  '/reports',
  requirePermission('report.export', 'report.manage', 'report.view_any'),
  validate({ body: reportJobSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof reportJobSchema>>(req);
    return accepted(res, await queueReport(req, input.reportType, input.filters ?? {}));
  }),
);
adminRouter.get(
  '/reports/:uuid',
  requirePermission('report.view_any', 'report.export', 'report.manage'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => ok(res, await getReport(req, params<{ uuid: string }>(req).uuid))),
);

/* -------------------------------------------------------------------------- */
/* Sales CRM                                                                  */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/sales/leads',
  requirePermission('sales.view_any', 'sales.view', 'lead.view_any', 'lead.view'),
  validate({ query: adminListQuery }),
  asyncHandler(async (req, res) => page(res, await listLeads(req.auth!, query<AdminListQuery>(req)))),
);
adminRouter.post(
  '/sales/leads',
  requirePermission('lead.create', 'sales.manage'),
  validate({ body: leadSchema }),
  asyncHandler(async (req, res) => created(res, await createLead(req, body(req)))),
);
adminRouter.patch(
  '/sales/leads/:id',
  requirePermission('lead.update', 'sales.manage'),
  validate({ params: idParam, body: leadUpdateSchema }),
  asyncHandler(async (req, res) => ok(res, await updateLead(req, params<{ id: number }>(req).id, body(req)))),
);
adminRouter.post(
  '/sales/notes',
  requirePermission('lead.update', 'sales.manage'),
  validate({ body: noteSchema }),
  asyncHandler(async (req, res) => created(res, await addNote(req, body(req)))),
);
adminRouter.post(
  '/sales/appointments',
  requirePermission('lead.update', 'sales.manage'),
  validate({ body: appointmentSchema }),
  asyncHandler(async (req, res) => created(res, await createAppointment(req, body(req)))),
);
adminRouter.post(
  '/sales/quotes',
  requirePermission('lead.update', 'sales.manage'),
  validate({ body: quoteSchema }),
  asyncHandler(async (req, res) => created(res, await createQuote(req, body(req)))),
);
adminRouter.get(
  '/sales/commissions',
  requirePermission('commission.view_any', 'commission.view'),
  validate({ query: adminListQuery }),
  asyncHandler(async (req, res) => page(res, await listCommissions(req.auth!, query<AdminListQuery>(req)))),
);
adminRouter.get(
  '/sales/analytics',
  requirePermission('sales.view_any', 'sales.view'),
  validate({ query: z.object({ companyId: z.coerce.number().int().positive().optional() }) }),
  asyncHandler(async (req, res) => ok(res, await salesAnalytics(req.auth!, query<{ companyId?: number }>(req).companyId))),
);

/* -------------------------------------------------------------------------- */
/* Four-eyes                                                                  */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/approvals',
  requirePermission('approval.view'),
  validate({ query: z.object({ status: z.string().optional() }) }),
  asyncHandler(async (req, res) => ok(res, await listApprovals(query<{ status?: string }>(req).status ?? 'pending'))),
);
adminRouter.post(
  '/approvals/:uuid',
  requirePermission('approval.decide'),
  validate({ params: uuidParam, body: approvalDecideSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof approvalDecideSchema>>(req);
    return ok(res, await decideApproval(req, params<{ uuid: string }>(req).uuid, input.decision, input.reason));
  }),
);

/* -------------------------------------------------------------------------- */
/* Security / privacy (facades over the platform security layer)              */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/security',
  requirePermission('audit.view_any', 'risk.view_any', 'admin.view'),
  asyncHandler(async (_req, res) => ok(res, await securityOverview())),
);

adminRouter.get(
  '/privacy',
  requirePermission('user.export', 'user.delete', 'admin.view'),
  validate({ query: adminListQuery }),
  asyncHandler(async (req, res) => {
    const q = query<AdminListQuery>(req);
    const result = await staffListPrivacyRequests(q.page, q.perPage, q.status);
    return page(res, { items: result.items, total: result.total, page: q.page, perPage: q.perPage });
  }),
);

adminRouter.post(
  '/privacy/:uuid',
  requirePermission('user.export', 'user.delete'),
  validate({ params: uuidParam, body: privacyStaffDecideSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof privacyStaffDecideSchema>>(req);
    return ok(res, await staffDecidePrivacyRequest(params<{ uuid: string }>(req).uuid, req.auth!.userId, input.status, input.notes));
  }),
);
