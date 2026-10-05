import type { Router, Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok, accepted, withCache } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { aiRateLimit, writeRateLimit } from '../../middleware/rate-limit';
import { riskGuard } from '../../middleware/risk-guard';
import { unauthenticated, forbidden } from '../../core/errors';
import { getPropertyCatalog } from './property.catalog';
import {
  createPropertyRecord,
  getExactLocation,
  getProperty,
  getPublicLocation,
  listMyProperties,
} from './property.assets';
import {
  counterPropertyOffer,
  createPropertyOffer,
  getPropertyOffer,
  listPropertyOffers,
  respondToPropertyOffer,
} from './property.offers';
import {
  applyForRental,
  changeLeaseStatus,
  createBooking,
  createLeaseFromApplication,
  getApplication,
  getAvailability,
  getLease,
  listApplications,
  payLease,
  reviewApplication,
  upsertAvailability,
  upsertRoomType,
} from './property.rental';
import { buyPropertyListing } from './property.commerce';
import {
  getPropertyDocument,
  listPropertyDocuments,
  uploadPropertyDocument,
  verifyPropertyDocument,
} from './property.documents';
import {
  getOwnership,
  listVerificationBadges,
  reviewOwnership,
  setVerificationDimension,
  submitOwnership,
} from './property.ownership';
import { analyseListingImages, assessListingQuality, runValuation } from './property.ai';
import { throughGateway } from '../../modules/ai/ai.gateway';
import { analysePropertyRisk } from './property.fraud';
import { addBuilding, addUnit, createProject, getProject, listBuilderProjects } from './property.projects';
import { getListingAnalytics } from './property.analytics';
import { parsePropertyQuery } from './property.search';
import { getMapProvider, listMapProviders, markersInBounds } from '../../providers/maps';
import { queryOne, type Row } from '../../db/query';

const currentUserId = (req: Request): number => {
  if (!req.auth) throw unauthenticated();
  return req.auth.userId;
};

const isStaff = (req: Request): boolean => Boolean(req.auth?.isStaff);

const idParams = z.object({ id: z.coerce.number().int().positive() });
const listingParams = z.object({ listingId: z.coerce.number().int().positive() });
const propertyParams = z.object({ propertyId: z.coerce.number().int().positive() });

export function registerPropertyDomainRoutes(router: Router): void {
  router.get(
    '/catalog',
    asyncHandler(async (req, res) => {
      withCache(res, 300);
      return ok(
        res,
        await getPropertyCatalog({ countryId: req.context.countryId, language: req.context.language }),
      );
    }),
  );

  router.get(
    '/search/parse',
    validate({ query: z.object({ q: z.string().trim().min(1).max(191) }) }),
    asyncHandler(async (req, res) => {
      const q = query<{ q: string }>(req);
      return ok(res, parsePropertyQuery(q.q));
    }),
  );

  router.get(
    '/maps/providers',
    asyncHandler(async (_req, res) => {
      withCache(res, 3600);
      return ok(res, { providers: await listMapProviders(), active: getMapProvider().code });
    }),
  );

  router.get(
    '/maps/markers',
    validate({
      query: z.object({
        minLat: z.coerce.number().min(-90).max(90),
        maxLat: z.coerce.number().min(-90).max(90),
        minLng: z.coerce.number().min(-180).max(180),
        maxLng: z.coerce.number().min(-180).max(180),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      }),
    }),
    asyncHandler(async (req, res) => {
      const q = query<{ minLat: number; maxLat: number; minLng: number; maxLng: number; limit: number }>(req);
      return ok(res, await markersInBounds(q, q.limit));
    }),
  );

  router.get(
    '/properties',
    requireAuth,
    asyncHandler(async (req, res) => ok(res, await listMyProperties(currentUserId(req)))),
  );

  router.post(
    '/properties',
    requireAuth,
    writeRateLimit,
    validate({
      body: z.object({
        propertyKind: z.string().trim().min(1).max(48),
        usageType: z.enum(['residential', 'commercial', 'rental', 'hospitality', 'land', 'industrial', 'mixed']).optional(),
        title: z.string().trim().max(191).optional(),
        locationPrivacy: z.enum(['public_exact', 'approximate', 'private']).optional(),
        latitude: z.coerce.number().min(-90).max(90).optional(),
        longitude: z.coerce.number().min(-180).max(180).optional(),
        businessId: z.coerce.number().int().positive().optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const input = body<{
        propertyKind: string;
        usageType?: string;
        title?: string;
        locationPrivacy?: 'public_exact' | 'approximate' | 'private';
        latitude?: number;
        longitude?: number;
        businessId?: number;
      }>(req);
      const id = await createPropertyRecord({
        ownerUserId: currentUserId(req),
        businessId: input.businessId ?? null,
        propertyKind: input.propertyKind,
        usageType: input.usageType ?? 'residential',
        title: input.title ?? null,
        countryId: req.context.countryId ?? 1,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        locationPrivacy: input.locationPrivacy,
      });
      return created(res, await getProperty(id, currentUserId(req), isStaff(req)));
    }),
  );

  router.get(
    '/properties/:id',
    authenticate,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      return ok(res, await getProperty(id, req.auth?.userId ?? null, isStaff(req)));
    }),
  );

  router.get(
    '/listings/:listingId/location',
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      return ok(res, await getPublicLocation(listingId));
    }),
  );

  router.get(
    '/listings/:listingId/location/exact',
    requireAuth,
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      return ok(res, await getExactLocation(listingId, currentUserId(req), isStaff(req)));
    }),
  );

  router.get(
    '/listings/:listingId/badges',
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      const row = await queryOne<Row>(
        'SELECT property_id FROM property_listing_details WHERE listing_id = ?',
        [listingId],
      );
      if (!row?.property_id) return ok(res, {});
      return ok(res, await listVerificationBadges(Number(row.property_id), listingId));
    }),
  );

  router.get(
    '/listings/:listingId/offers',
    requireAuth,
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      return ok(res, await listPropertyOffers({ listingId, userId: currentUserId(req), role: 'buyer' }));
    }),
  );

  router.post(
    '/listings/:listingId/offers',
    requireAuth,
    writeRateLimit,
    riskGuard('observe'),
    validate({
      params: listingParams,
      body: z.object({
        amount: z.coerce.number().positive(),
        currency: z.string().length(3).toUpperCase().optional(),
        message: z.string().trim().max(1000).optional(),
        conditions: z.string().trim().max(1000).optional(),
        depositAmount: z.coerce.number().min(0).optional(),
        expiresAt: z.string().max(40).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      const input = body<{
        amount: number;
        currency?: string;
        message?: string;
        conditions?: string;
        depositAmount?: number;
        expiresAt?: string;
      }>(req);
      return created(
        res,
        await createPropertyOffer({
          listingId,
          buyerId: currentUserId(req),
          amount: input.amount,
          currency: input.currency ?? req.context.currency,
          message: input.message ?? null,
          conditions: input.conditions ?? null,
          depositAmount: input.depositAmount ?? null,
          expiresAt: input.expiresAt ?? null,
        }),
      );
    }),
  );

  router.get(
    '/offers/:id',
    requireAuth,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      return ok(res, await getPropertyOffer(id, currentUserId(req), isStaff(req)));
    }),
  );

  router.post(
    '/offers/:id/counter',
    requireAuth,
    writeRateLimit,
    validate({
      params: idParams,
      body: z.object({
        amount: z.coerce.number().positive(),
        currency: z.string().length(3).toUpperCase().optional(),
        message: z.string().trim().max(1000).optional(),
        conditions: z.string().trim().max(1000).optional(),
        depositAmount: z.coerce.number().min(0).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{
        amount: number;
        currency?: string;
        message?: string;
        conditions?: string;
        depositAmount?: number;
      }>(req);
      return ok(
        res,
        await counterPropertyOffer({
          offerId: id,
          userId: currentUserId(req),
          amount: input.amount,
          currency: input.currency ?? req.context.currency,
          message: input.message ?? null,
          conditions: input.conditions ?? null,
          depositAmount: input.depositAmount ?? null,
        }),
      );
    }),
  );

  router.post(
    '/offers/:id/respond',
    requireAuth,
    writeRateLimit,
    validate({
      params: idParams,
      body: z.object({
        action: z.enum(['accepted', 'rejected', 'cancelled']),
        message: z.string().trim().max(1000).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{ action: 'accepted' | 'rejected' | 'cancelled'; message?: string }>(req);
      return ok(
        res,
        await respondToPropertyOffer({
          offerId: id,
          userId: currentUserId(req),
          action: input.action,
          message: input.message ?? null,
        }),
      );
    }),
  );

  router.post(
    '/listings/:listingId/buy',
    requireAuth,
    writeRateLimit,
    riskGuard('enforce'),
    validate({
      params: listingParams,
      body: z.object({
        gatewayCode: z.string().min(1).max(32).default('manual'),
        offerId: z.coerce.number().int().positive().optional(),
        returnUrl: z.string().url().max(512).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      const input = body<{ gatewayCode: string; offerId?: number; returnUrl?: string }>(req);
      return created(
        res,
        await buyPropertyListing({
          listingId,
          buyerId: currentUserId(req),
          countryId: req.context.countryId ?? 1,
          gatewayCode: input.gatewayCode,
          offerId: input.offerId ?? null,
          returnUrl: input.returnUrl ?? null,
        }),
      );
    }),
  );

  router.get(
    '/listings/:listingId/availability',
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      return ok(res, await getAvailability(listingId));
    }),
  );

  router.put(
    '/listings/:listingId/availability',
    requireAuth,
    writeRateLimit,
    validate({
      params: listingParams,
      body: z.object({
        availableFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        availableUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        minStayDays: z.coerce.number().int().min(0).max(3650).optional(),
        maxStayDays: z.coerce.number().int().min(0).max(3650).optional(),
        occupancyMax: z.coerce.number().int().min(1).max(255).optional(),
        checkInTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        checkOutTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        instantBook: z.coerce.boolean().optional(),
        status: z.enum(['available', 'limited', 'unavailable']).optional(),
        blocks: z
          .array(
            z.object({
              startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              reason: z.string().max(64).optional(),
            }),
          )
          .max(366)
          .optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      const input = body<{
        availableFrom?: string;
        availableUntil?: string;
        minStayDays?: number;
        maxStayDays?: number;
        occupancyMax?: number;
        checkInTime?: string;
        checkOutTime?: string;
        instantBook?: boolean;
        status?: 'available' | 'limited' | 'unavailable';
        blocks?: Array<{ startDate: string; endDate: string; reason?: string }>;
      }>(req);
      return ok(
        res,
        await upsertAvailability({
          listingId,
          userId: currentUserId(req),
          isStaff: isStaff(req),
          ...input,
        }),
      );
    }),
  );

  router.post(
    '/listings/:listingId/rooms',
    requireAuth,
    writeRateLimit,
    validate({
      params: listingParams,
      body: z.object({
        code: z.string().trim().min(1).max(32),
        name: z.string().trim().min(1).max(96),
        occupancy: z.coerce.number().int().min(1).max(50),
        bedCount: z.coerce.number().int().min(0).max(50).optional(),
        privacy: z.enum(['private', 'shared', 'mixed']).optional(),
        quantity: z.coerce.number().int().min(1).max(500),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      const input = body<{
        code: string;
        name: string;
        occupancy: number;
        bedCount?: number;
        privacy?: 'private' | 'shared' | 'mixed';
        quantity: number;
      }>(req);
      return created(res, await upsertRoomType({ listingId, userId: currentUserId(req), ...input }));
    }),
  );

  router.post(
    '/listings/:listingId/apply',
    requireAuth,
    writeRateLimit,
    validate({
      params: listingParams,
      body: z.object({
        message: z.string().trim().max(2000).optional(),
        occupants: z.coerce.number().int().min(1).max(50).optional(),
        desiredStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        desiredEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      const input = body<{ message?: string; occupants?: number; desiredStart?: string; desiredEnd?: string }>(req);
      return created(
        res,
        await applyForRental({
          listingId,
          applicantId: currentUserId(req),
          message: input.message ?? null,
          occupants: input.occupants ?? null,
          desiredStart: input.desiredStart ?? null,
          desiredEnd: input.desiredEnd ?? null,
        }),
      );
    }),
  );

  router.get(
    '/applications',
    requireAuth,
    validate({
      query: z.object({
        listingId: z.coerce.number().int().positive().optional(),
        role: z.enum(['applicant', 'landlord']).default('applicant'),
      }),
    }),
    asyncHandler(async (req, res) => {
      const q = query<{ listingId?: number; role: 'applicant' | 'landlord' }>(req);
      return ok(res, await listApplications({ listingId: q.listingId, userId: currentUserId(req), role: q.role }));
    }),
  );

  router.get(
    '/applications/:id',
    requireAuth,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      return ok(res, await getApplication(id, currentUserId(req), isStaff(req)));
    }),
  );

  router.post(
    '/applications/:id/review',
    requireAuth,
    writeRateLimit,
    validate({
      params: idParams,
      body: z.object({
        decision: z.enum(['accepted', 'rejected']),
        reason: z.string().trim().max(500).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{ decision: 'accepted' | 'rejected'; reason?: string }>(req);
      return ok(
        res,
        await reviewApplication({
          applicationId: id,
          userId: currentUserId(req),
          isStaff: isStaff(req),
          decision: input.decision,
          reason: input.reason ?? null,
        }),
      );
    }),
  );

  router.post(
    '/applications/:id/lease',
    requireAuth,
    writeRateLimit,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const application = await getApplication(id, currentUserId(req), isStaff(req));
      if (!isStaff(req) && application.landlordId !== currentUserId(req)) {
        throw forbidden('Only the landlord can create a lease');
      }
      return created(res, await createLeaseFromApplication(id));
    }),
  );

  router.get(
    '/leases/:id',
    requireAuth,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      return ok(res, await getLease(id, currentUserId(req), isStaff(req)));
    }),
  );

  router.post(
    '/leases/:id/status',
    requireAuth,
    writeRateLimit,
    validate({
      params: idParams,
      body: z.object({
        status: z.enum(['pending_signature', 'active', 'expired', 'terminated', 'cancelled']),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{ status: 'pending_signature' | 'active' | 'expired' | 'terminated' | 'cancelled' }>(req);
      return ok(
        res,
        await changeLeaseStatus({
          leaseId: id,
          userId: currentUserId(req),
          isStaff: isStaff(req),
          status: input.status,
        }),
      );
    }),
  );

  router.post(
    '/leases/:id/pay',
    requireAuth,
    writeRateLimit,
    riskGuard('enforce'),
    validate({
      params: idParams,
      body: z.object({
        kind: z.enum(['rental_deposit', 'rental_payment']),
        gatewayCode: z.string().min(1).max(32).default('manual'),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{ kind: 'rental_deposit' | 'rental_payment'; gatewayCode: string }>(req);
      return created(
        res,
        await payLease({
          leaseId: id,
          userId: currentUserId(req),
          countryId: req.context.countryId ?? 1,
          gatewayCode: input.gatewayCode,
          kind: input.kind,
        }),
      );
    }),
  );

  router.post(
    '/listings/:listingId/book',
    requireAuth,
    writeRateLimit,
    riskGuard('enforce'),
    validate({
      params: listingParams,
      body: z.object({
        checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        guests: z.coerce.number().int().min(1).max(50).optional(),
        roomTypeId: z.coerce.number().int().positive().optional(),
        gatewayCode: z.string().min(1).max(32).default('manual'),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      const input = body<{
        checkIn: string;
        checkOut: string;
        guests?: number;
        roomTypeId?: number;
        gatewayCode: string;
      }>(req);
      return created(
        res,
        await createBooking({
          listingId,
          guestId: currentUserId(req),
          countryId: req.context.countryId ?? 1,
          gatewayCode: input.gatewayCode,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          guests: input.guests,
          roomTypeId: input.roomTypeId ?? null,
        }),
      );
    }),
  );

  router.get(
    '/properties/:propertyId/documents',
    requireAuth,
    validate({ params: propertyParams }),
    asyncHandler(async (req, res) => {
      const { propertyId } = params<{ propertyId: number }>(req);
      return ok(res, await listPropertyDocuments(propertyId, currentUserId(req), isStaff(req)));
    }),
  );

  router.post(
    '/properties/:propertyId/documents',
    requireAuth,
    writeRateLimit,
    validate({
      params: propertyParams,
      body: z.object({
        docType: z.enum([
          'ownership',
          'title_registry',
          'map',
          'approval',
          'noc',
          'tax',
          'building_approval',
          'completion_certificate',
          'other',
        ]),
        title: z.string().trim().max(191).optional(),
        storagePath: z.string().trim().min(1).max(512),
        listingDocumentId: z.coerce.number().int().positive().optional(),
        mimeType: z.string().trim().max(96).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { propertyId } = params<{ propertyId: number }>(req);
      const input = body<{
        docType:
          | 'ownership'
          | 'title_registry'
          | 'map'
          | 'approval'
          | 'noc'
          | 'tax'
          | 'building_approval'
          | 'completion_certificate'
          | 'other';
        title?: string;
        storagePath: string;
        listingDocumentId?: number;
        mimeType?: string;
      }>(req);
      return created(
        res,
        await uploadPropertyDocument({
          propertyId,
          userId: currentUserId(req),
          isStaff: isStaff(req),
          ...input,
        }),
      );
    }),
  );

  router.get(
    '/documents/:id',
    requireAuth,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      return ok(res, await getPropertyDocument(id, currentUserId(req), isStaff(req)));
    }),
  );

  router.post(
    '/documents/:id/verify',
    requireAuth,
    writeRateLimit,
    validate({
      params: idParams,
      body: z.object({
        decision: z.enum(['verified', 'rejected']),
        reason: z.string().trim().max(500).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{ decision: 'verified' | 'rejected'; reason?: string }>(req);
      return ok(
        res,
        await verifyPropertyDocument({
          documentId: id,
          actorId: currentUserId(req),
          isStaff: isStaff(req),
          decision: input.decision,
          reason: input.reason ?? null,
        }),
      );
    }),
  );

  router.get(
    '/properties/:propertyId/ownership',
    requireAuth,
    validate({ params: propertyParams }),
    asyncHandler(async (req, res) => {
      const { propertyId } = params<{ propertyId: number }>(req);
      return ok(res, await getOwnership(propertyId));
    }),
  );

  router.post(
    '/properties/:propertyId/ownership',
    requireAuth,
    writeRateLimit,
    validate({
      params: propertyParams,
      body: z.object({
        ownershipType: z.enum(['freehold', 'leasehold', 'power_of_attorney', 'allotment', 'shared', 'other']),
        sharePercent: z.coerce.number().min(0).max(100).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { propertyId } = params<{ propertyId: number }>(req);
      const input = body<{
        ownershipType: 'freehold' | 'leasehold' | 'power_of_attorney' | 'allotment' | 'shared' | 'other';
        sharePercent?: number;
      }>(req);
      return created(
        res,
        await submitOwnership({
          propertyId,
          userId: currentUserId(req),
          ownershipType: input.ownershipType,
          sharePercent: input.sharePercent ?? null,
        }),
      );
    }),
  );

  router.post(
    '/ownership/:id/review',
    requireAuth,
    writeRateLimit,
    validate({
      params: idParams,
      body: z.object({
        status: z.enum(['partially_verified', 'verified', 'rejected', 'expired']),
        reason: z.string().trim().max(500).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{
        status: 'partially_verified' | 'verified' | 'rejected' | 'expired';
        reason?: string;
      }>(req);
      return ok(
        res,
        await reviewOwnership({
          ownershipId: id,
          actorId: currentUserId(req),
          isStaff: isStaff(req),
          status: input.status,
          reason: input.reason ?? null,
        }),
      );
    }),
  );

  router.post(
    '/properties/:propertyId/verifications',
    requireAuth,
    writeRateLimit,
    validate({
      params: propertyParams,
      body: z.object({
        listingId: z.coerce.number().int().positive().optional(),
        dimension: z.enum([
          'seller_identity',
          'business_identity',
          'ownership',
          'documents',
          'location',
          'listing_information',
          'property_inspection',
        ]),
        status: z.enum(['pending', 'verified', 'rejected', 'expired']),
        reason: z.string().trim().max(500).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { propertyId } = params<{ propertyId: number }>(req);
      const input = body<{
        listingId?: number;
        dimension:
          | 'seller_identity'
          | 'business_identity'
          | 'ownership'
          | 'documents'
          | 'location'
          | 'listing_information'
          | 'property_inspection';
        status: 'pending' | 'verified' | 'rejected' | 'expired';
        reason?: string;
      }>(req);
      return ok(
        res,
        await setVerificationDimension({
          propertyId,
          listingId: input.listingId ?? null,
          actorId: currentUserId(req),
          isStaff: isStaff(req),
          dimension: input.dimension,
          status: input.status,
          reason: input.reason ?? null,
        }),
      );
    }),
  );

  router.post(
    '/listings/:listingId/ai/quality',
    requireAuth,
    aiRateLimit,
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      return ok(res, await assessListingQuality(listingId));
    }),
  );

  router.post(
    '/listings/:listingId/ai/images',
    requireAuth,
    aiRateLimit,
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      return ok(res, await analyseListingImages(listingId));
    }),
  );

  router.post(
    '/listings/:listingId/risk',
    requireAuth,
    aiRateLimit,
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      return ok(res, await analysePropertyRisk(listingId));
    }),
  );

  router.post(
    '/ai/valuate',
    requireAuth,
    aiRateLimit,
    validate({
      body: z.object({
        listingId: z.coerce.number().int().positive().optional(),
        propertyId: z.coerce.number().int().positive().optional(),
        propertyKind: z.string().trim().min(1).max(48),
        operation: z.enum(['sell', 'rent']).default('sell'),
        cityId: z.coerce.number().int().positive(),
        areaId: z.coerce.number().int().positive().optional(),
        areaValue: z.coerce.number().positive().max(100_000_000),
        areaUnit: z.string().trim().min(1).max(24),
        bedrooms: z.coerce.number().int().min(0).max(50).optional(),
        bathrooms: z.coerce.number().int().min(0).max(50).optional(),
        furnishing: z.enum(['unfurnished', 'semi_furnished', 'furnished', 'fully_furnished']).optional(),
        yearBuilt: z.coerce.number().int().min(1800).max(2100).optional(),
        amenityCount: z.coerce.number().int().min(0).max(80).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const input = body<{
        listingId?: number;
        propertyId?: number;
        propertyKind: string;
        operation: 'sell' | 'rent';
        cityId: number;
        areaId?: number;
        areaValue: number;
        areaUnit: string;
        bedrooms?: number;
        bathrooms?: number;
        furnishing?: string;
        yearBuilt?: number;
        amenityCount?: number;
      }>(req);
      const gated = await throughGateway(req, {
        task: 'property_valuation',
        input,
        run: async () => {
          const valuation = await runValuation({
            ...input,
            countryId: req.context.countryId ?? 1,
            currency: req.context.currency,
            requestedBy: currentUserId(req),
          });
          return { ...valuation, model: 'property-valuation', confidence: valuation.confidence, latencyMs: 0 };
        },
      });
      if ('accepted' in gated) return accepted(res, gated);
      return ok(res, {
        ...gated.result,
        meta: gated.meta,
        disclaimer: 'Automated estimate from comparable asking prices. Not a surveyed professional valuation.',
      });
    }),
  );

  router.get(
    '/listings/:listingId/analytics',
    requireAuth,
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      return ok(res, await getListingAnalytics(listingId, currentUserId(req), isStaff(req)));
    }),
  );

  router.get(
    '/projects',
    requireAuth,
    asyncHandler(async (req, res) => ok(res, await listBuilderProjects(currentUserId(req)))),
  );

  router.post(
    '/projects',
    requireAuth,
    writeRateLimit,
    validate({
      body: z.object({
        businessId: z.coerce.number().int().positive(),
        name: z.string().trim().min(2).max(191),
        description: z.string().trim().max(5000).optional(),
        cityId: z.coerce.number().int().positive().optional(),
        areaId: z.coerce.number().int().positive().optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const input = body<{
        businessId: number;
        name: string;
        description?: string;
        cityId?: number;
        areaId?: number;
      }>(req);
      return created(
        res,
        await createProject({
          userId: currentUserId(req),
          businessId: input.businessId,
          name: input.name,
          description: input.description ?? null,
          countryId: req.context.countryId ?? 1,
          cityId: input.cityId ?? null,
          areaId: input.areaId ?? null,
        }),
      );
    }),
  );

  router.get(
    '/projects/:id',
    requireAuth,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      return ok(res, await getProject(id, currentUserId(req), isStaff(req)));
    }),
  );

  router.post(
    '/projects/:id/buildings',
    requireAuth,
    writeRateLimit,
    validate({
      params: idParams,
      body: z.object({
        name: z.string().trim().min(1).max(96),
        totalFloors: z.coerce.number().int().min(1).max(80).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{ name: string; totalFloors?: number }>(req);
      return created(
        res,
        await addBuilding({
          projectId: id,
          userId: currentUserId(req),
          name: input.name,
          totalFloors: input.totalFloors ?? null,
        }),
      );
    }),
  );

  router.post(
    '/floors/:id/units',
    requireAuth,
    writeRateLimit,
    validate({
      params: idParams,
      body: z.object({
        unitNumber: z.string().trim().min(1).max(32),
        unitType: z.string().trim().max(48).optional(),
        propertyId: z.coerce.number().int().positive().optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{ unitNumber: string; unitType?: string; propertyId?: number }>(req);
      return created(
        res,
        await addUnit({
          floorId: id,
          userId: currentUserId(req),
          unitNumber: input.unitNumber,
          unitType: input.unitType ?? null,
          propertyId: input.propertyId ?? null,
        }),
      );
    }),
  );
}
