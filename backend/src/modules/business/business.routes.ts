import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok } from '../../core/http/response';
import { validate, body, params } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { writeRateLimit } from '../../middleware/rate-limit';
import { denyGuest } from '../../middleware/authorize';
import {
  acceptInvitationSchema,
  agencyExtensionSchema,
  builderExtensionSchema,
  changeRoleSchema,
  createBusinessSchema,
  dealerExtensionSchema,
  goldShopExtensionSchema,
  inviteMemberSchema,
  locationSchema,
  transferOwnershipSchema,
  updateBusinessSchema,
  type AgencyExtensionInput,
  type BuilderExtensionInput,
  type CreateBusinessInput,
  type DealerExtensionInput,
  type GoldShopExtensionInput,
  type InviteMemberInput,
  type LocationInput,
  type UpdateBusinessInput,
} from './business.schema';
import {
  acceptInvitation,
  addLocation,
  changeMemberRole,
  createBusiness,
  getBusiness,
  getBusinessBySlug,
  inviteMember,
  listMyBusinesses,
  removeMember,
  saveAgencyExtension,
  saveBuilderExtension,
  saveDealerExtension,
  saveGoldShopExtension,
  transferOwnership,
  updateBusiness,
} from './business.service';

export const businessRouter = Router();

businessRouter.use(authenticate);

businessRouter.get(
  '/',
  requireAuth,
  denyGuest('manage a business'),
  asyncHandler(async (req, res) => ok(res, await listMyBusinesses(req.auth!.userId))),
);

businessRouter.get(
  '/s/:slug',
  validate({ params: z.object({ slug: z.string().min(2).max(200) }) }),
  asyncHandler(async (req, res) => {
    const { slug } = params<{ slug: string }>(req);
    return ok(res, await getBusinessBySlug(slug, req.auth?.userId ?? null, req.auth?.isStaff ?? false));
  }),
);

businessRouter.get(
  '/:id',
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return ok(res, await getBusiness(id, req.auth?.userId ?? null, req.auth?.isStaff ?? false));
  }),
);

businessRouter.use(requireAuth, denyGuest('manage a business'));

businessRouter.post(
  '/',
  writeRateLimit,
  validate({ body: createBusinessSchema }),
  asyncHandler(async (req, res) => {
    return created(res, await createBusiness(req.auth!.userId, body<CreateBusinessInput>(req)));
  }),
);

businessRouter.post(
  '/invitations/accept',
  writeRateLimit,
  validate({ body: acceptInvitationSchema }),
  asyncHandler(async (req, res) => {
    const { token } = body<{ token: string }>(req);
    return ok(res, await acceptInvitation(req.auth!.userId, token));
  }),
);

businessRouter.patch(
  '/:id',
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: updateBusinessSchema,
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return ok(res, await updateBusiness(id, req.auth!.userId, req.auth!.isStaff, body<UpdateBusinessInput>(req)));
  }),
);

businessRouter.post(
  '/:id/invitations',
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: inviteMemberSchema,
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return created(res, await inviteMember(id, req.auth!.userId, req.auth!.isStaff, body<InviteMemberInput>(req)));
  }),
);

businessRouter.patch(
  '/:id/members/:userId',
  writeRateLimit,
  validate({
    params: z.object({
      id: z.coerce.number().int().positive(),
      userId: z.coerce.number().int().positive(),
    }),
    body: changeRoleSchema,
  }),
  asyncHandler(async (req, res) => {
    const p = params<{ id: number; userId: number }>(req);
    const { role } = body<{ role: 'admin' | 'manager' | 'agent' | 'staff' | 'salesperson' | 'editor' | 'accountant' | 'support' }>(req);
    return ok(res, await changeMemberRole(p.id, req.auth!.userId, p.userId, role, req.auth!.isStaff));
  }),
);

businessRouter.delete(
  '/:id/members/:userId',
  writeRateLimit,
  validate({
    params: z.object({
      id: z.coerce.number().int().positive(),
      userId: z.coerce.number().int().positive(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const p = params<{ id: number; userId: number }>(req);
    return ok(res, await removeMember(p.id, req.auth!.userId, p.userId, req.auth!.isStaff));
  }),
);

businessRouter.post(
  '/:id/transfer',
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: transferOwnershipSchema,
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const { toUserId, password } = body<{ toUserId: number; password: string }>(req);
    return ok(res, await transferOwnership(id, req.auth!.userId, toUserId, password));
  }),
);

businessRouter.post(
  '/:id/locations',
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: locationSchema,
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return created(res, await addLocation(id, req.auth!.userId, req.auth!.isStaff, body<LocationInput>(req)));
  }),
);

businessRouter.put(
  '/:id/dealer',
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: dealerExtensionSchema,
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return ok(res, await saveDealerExtension(id, req.auth!.userId, req.auth!.isStaff, body<DealerExtensionInput>(req)));
  }),
);

businessRouter.put(
  '/:id/agency',
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: agencyExtensionSchema,
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return ok(res, await saveAgencyExtension(id, req.auth!.userId, req.auth!.isStaff, body<AgencyExtensionInput>(req)));
  }),
);

businessRouter.put(
  '/:id/builder',
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: builderExtensionSchema,
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return ok(res, await saveBuilderExtension(id, req.auth!.userId, req.auth!.isStaff, body<BuilderExtensionInput>(req)));
  }),
);

businessRouter.put(
  '/:id/gold-shop',
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: goldShopExtensionSchema,
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return ok(res, await saveGoldShopExtension(id, req.auth!.userId, req.auth!.isStaff, body<GoldShopExtensionInput>(req)));
  }),
);
