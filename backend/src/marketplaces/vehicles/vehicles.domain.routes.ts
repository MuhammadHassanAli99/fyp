import type { Router, Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok, accepted, withCache } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { aiRateLimit, writeRateLimit } from '../../middleware/rate-limit';
import { riskGuard } from '../../middleware/risk-guard';
import { unauthenticated, badRequest } from '../../core/errors';
import { queryOne, type Row } from '../../db/query';
import { getVehicleCatalog } from './vehicles.catalog';
import { createVehicleRecord, getVehicle, listMyVehicles, listVehicleMarkers } from './vehicles.assets';
import {
  counterVehicleOffer,
  createVehicleOffer,
  getVehicleOffer,
  listVehicleOffers,
  respondToVehicleOffer,
} from './vehicles.offers';
import { buyVehicleListing } from './vehicles.commerce';
import { createRentalBooking, getAvailability, upsertAvailability } from './vehicles.rental';
import { listVehicleDocuments, uploadVehicleDocument, verifyVehicleDocument } from './vehicles.documents';
import { getOwnership, listVerificationBadges, reviewOwnership, reviewVin, submitOwnership } from './vehicles.ownership';
import { analyseListingImages, assessListingQuality, runValuation } from './vehicles.ai';
import { throughGateway } from '../../modules/ai/ai.gateway';
import { analyseVehicleRisk } from './vehicles.fraud';
import { parseVehicleQuery } from './vehicles.search';
import { buyPart, createPart, getPart, searchParts } from './vehicles.parts';
import {
  advanceTradeCase,
  bookShipment,
  estimateLandedCost,
  getTradeCase,
  getTradeRule,
  startTradeCase,
  submitCustoms,
  trackShipment,
} from './vehicles.trade';
import { estimateFinance, estimateInsurance } from './vehicles.financing';
import { addHistoryEvent, addMileageReading, addServiceRecord, listHistory, listServiceRecords } from './vehicles.history';
import { createStructuredInspection, getStructuredInspection } from './vehicles.inspection';
import { createLead, listDealerInventory, listLeads, updateLead, upsertDealerInventory } from './vehicles.leads';
import { getListingAnalytics } from './vehicles.analytics';
import { decodeVin } from './vehicles.vin';
import { getAuctionByListing, listBids } from '../../modules/auctions/auctions.service';

const currentUserId = (req: Request): number => {
  if (!req.auth) throw unauthenticated();
  return req.auth.userId;
};

const isStaff = (req: Request): boolean => Boolean(req.auth?.isStaff);

const idParams = z.object({ id: z.coerce.number().int().positive() });
const listingParams = z.object({ listingId: z.coerce.number().int().positive() });
const vehicleParams = z.object({ vehicleId: z.coerce.number().int().positive() });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function registerVehicleDomainRoutes(router: Router): void {
  router.get(
    '/catalog',
    asyncHandler(async (req, res) => {
      withCache(res, 300);
      return ok(res, await getVehicleCatalog({ countryId: req.context.countryId, language: req.context.language }));
    }),
  );

  router.get(
    '/search/parse',
    validate({ query: z.object({ q: z.string().trim().min(1).max(191) }) }),
    asyncHandler(async (req, res) => {
      const q = query<{ q: string }>(req);
      return ok(res, parseVehicleQuery(q.q));
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
      return ok(res, await listVehicleMarkers(q));
    }),
  );

  router.get(
    '/vin/decode',
    validate({ query: z.object({ vin: z.string().trim().min(5).max(32) }) }),
    asyncHandler(async (req, res) => ok(res, decodeVin(query<{ vin: string }>(req).vin))),
  );

  router.get(
    '/vehicles',
    requireAuth,
    asyncHandler(async (req, res) => ok(res, await listMyVehicles(currentUserId(req)))),
  );

  router.post(
    '/vehicles',
    requireAuth,
    writeRateLimit,
    validate({
      body: z.object({
        vehicleType: z.string().trim().min(1).max(48),
        title: z.string().trim().max(191).optional(),
        year: z.coerce.number().int().min(1900).max(2100).optional(),
        makeId: z.coerce.number().int().positive().optional(),
        modelId: z.coerce.number().int().positive().optional(),
        businessId: z.coerce.number().int().positive().optional(),
        vin: z.string().trim().max(32).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const input = body<{
        vehicleType: string;
        year?: number;
        makeId?: number;
        modelId?: number;
        businessId?: number;
        vin?: string;
      }>(req);
      const id = await createVehicleRecord({
        ownerUserId: currentUserId(req),
        businessId: input.businessId ?? null,
        vehicleType: input.vehicleType,
        year: input.year ?? null,
        makeId: input.makeId ?? null,
        modelId: input.modelId ?? null,
        countryId: req.context.countryId ?? 1,
        vin: input.vin ?? null,
      });
      return created(res, await getVehicle(id, currentUserId(req), isStaff(req)));
    }),
  );

  router.get(
    '/vehicles/:id',
    authenticate,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      return ok(res, await getVehicle(id, req.auth?.userId ?? null, isStaff(req)));
    }),
  );

  router.get(
    '/listings/:listingId/badges',
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      const row = await queryOne<Row>('SELECT vehicle_id FROM vehicle_listing_details WHERE listing_id = ?', [listingId]);
      if (!row?.vehicle_id) return ok(res, {});
      return ok(res, await listVerificationBadges(Number(row.vehicle_id)));
    }),
  );

  router.get(
    '/listings/:listingId/offers',
    requireAuth,
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      return ok(res, await listVehicleOffers({ listingId, userId: currentUserId(req), role: 'buyer' }));
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
        await createVehicleOffer({
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
      return ok(res, await getVehicleOffer(id, currentUserId(req), isStaff(req)));
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
        await counterVehicleOffer({
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
        await respondToVehicleOffer({
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
        await buyVehicleListing({
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
        availableFrom: isoDate.optional(),
        availableUntil: isoDate.optional(),
        status: z.enum(['available', 'reserved', 'rented', 'maintenance', 'sold', 'unavailable']).optional(),
        pickupLocation: z.string().trim().max(191).optional(),
        returnLocation: z.string().trim().max(191).optional(),
        blocks: z
          .array(
            z.object({
              startDate: isoDate,
              endDate: isoDate,
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
        status?: 'available' | 'reserved' | 'rented' | 'maintenance' | 'sold' | 'unavailable';
        pickupLocation?: string;
        returnLocation?: string;
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
    '/listings/:listingId/book',
    requireAuth,
    writeRateLimit,
    riskGuard('enforce'),
    validate({
      params: listingParams,
      body: z.object({
        startDate: isoDate,
        endDate: isoDate,
        durationCode: z.string().max(32).optional(),
        gatewayCode: z.string().min(1).max(32).default('manual'),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      const input = body<{ startDate: string; endDate: string; durationCode?: string; gatewayCode: string }>(req);
      return created(
        res,
        await createRentalBooking({
          listingId,
          renterId: currentUserId(req),
          countryId: req.context.countryId ?? 1,
          startDate: input.startDate,
          endDate: input.endDate,
          durationCode: input.durationCode ?? null,
          gatewayCode: input.gatewayCode,
        }),
      );
    }),
  );

  router.get(
    '/listings/:listingId/auction',
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      const auction = await getAuctionByListing(listingId);
      if (!auction) return ok(res, null);
      return ok(res, { ...auction, bids: await listBids(auction.id, 50) });
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

  router.post(
    '/listings/:listingId/leads',
    requireAuth,
    writeRateLimit,
    validate({
      params: listingParams,
      body: z.object({ message: z.string().trim().max(1000).optional() }),
    }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      const input = body<{ message?: string }>(req);
      return created(res, await createLead({ listingId, buyerId: currentUserId(req), message: input.message ?? null }));
    }),
  );

  router.get(
    '/leads',
    requireAuth,
    validate({ query: z.object({ role: z.enum(['buyer', 'seller']).default('seller') }) }),
    asyncHandler(async (req, res) => {
      const q = query<{ role: 'buyer' | 'seller' }>(req);
      return ok(res, await listLeads(currentUserId(req), q.role));
    }),
  );

  router.patch(
    '/leads/:id',
    requireAuth,
    validate({
      params: idParams,
      body: z.object({
        status: z.enum(['new', 'contacted', 'qualified', 'negotiating', 'converted', 'lost']).optional(),
        assigneeId: z.coerce.number().int().positive().optional(),
        followUpAt: z.string().max(40).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{
        status?: 'new' | 'contacted' | 'qualified' | 'negotiating' | 'converted' | 'lost';
        assigneeId?: number;
        followUpAt?: string;
      }>(req);
      return ok(
        res,
        await updateLead({
          leadId: id,
          userId: currentUserId(req),
          isStaff: isStaff(req),
          status: input.status,
          assigneeId: input.assigneeId ?? null,
          followUpAt: input.followUpAt ?? null,
        }),
      );
    }),
  );

  router.get(
    '/dealers/:id/inventory',
    requireAuth,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      return ok(res, await listDealerInventory(id, currentUserId(req), isStaff(req)));
    }),
  );

  router.post(
    '/dealers/:id/inventory',
    requireAuth,
    writeRateLimit,
    validate({
      params: idParams,
      body: z.object({
        vehicleId: z.coerce.number().int().positive(),
        listingId: z.coerce.number().int().positive().optional(),
        status: z.enum(['available', 'reserved', 'sold', 'rented', 'service', 'archived']).optional(),
        askingPrice: z.coerce.number().min(0).optional(),
        currency: z.string().length(3).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{
        vehicleId: number;
        listingId?: number;
        status?: string;
        askingPrice?: number;
        currency?: string;
      }>(req);
      return ok(
        res,
        await upsertDealerInventory({
          businessId: id,
          vehicleId: input.vehicleId,
          userId: currentUserId(req),
          isStaff: isStaff(req),
          listingId: input.listingId ?? null,
          status: input.status,
          askingPrice: input.askingPrice ?? null,
          currency: input.currency ?? req.context.currency,
        }),
      );
    }),
  );

  router.post(
    '/vehicles/:vehicleId/ownership',
    requireAuth,
    writeRateLimit,
    validate({
      params: vehicleParams,
      body: z.object({
        ownershipType: z.enum(['registered_owner', 'title_holder', 'importer', 'dealer', 'other']).optional(),
        status: z.string().optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { vehicleId } = params<{ vehicleId: number }>(req);
      const input = body<{ ownershipType?: string; status?: string }>(req);
      if (input.status === 'verified') {
        throw badRequest('Clients cannot mark ownership as verified');
      }
      return created(
        res,
        await submitOwnership({
          vehicleId,
          userId: currentUserId(req),
          isStaff: isStaff(req),
          ownershipType: input.ownershipType,
        }),
      );
    }),
  );

  router.get(
    '/vehicles/:vehicleId/ownership',
    requireAuth,
    validate({ params: vehicleParams }),
    asyncHandler(async (req, res) => {
      const { vehicleId } = params<{ vehicleId: number }>(req);
      return ok(res, await getOwnership(vehicleId));
    }),
  );

  router.post(
    '/ownership/:id/review',
    requireAuth,
    validate({
      params: idParams,
      body: z.object({
        status: z.enum(['partially_verified', 'verified', 'rejected', 'expired']),
        reason: z.string().trim().max(500).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{ status: 'partially_verified' | 'verified' | 'rejected' | 'expired'; reason?: string }>(req);
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
    '/vehicles/:vehicleId/vin/review',
    requireAuth,
    validate({
      params: vehicleParams,
      body: z.object({ status: z.enum(['partially_verified', 'verified', 'rejected', 'expired']) }),
    }),
    asyncHandler(async (req, res) => {
      const { vehicleId } = params<{ vehicleId: number }>(req);
      const input = body<{ status: 'partially_verified' | 'verified' | 'rejected' | 'expired' }>(req);
      return ok(
        res,
        await reviewVin({
          vehicleId,
          actorId: currentUserId(req),
          isStaff: isStaff(req),
          status: input.status,
        }),
      );
    }),
  );

  router.post(
    '/vehicles/:vehicleId/documents',
    requireAuth,
    writeRateLimit,
    validate({
      params: vehicleParams,
      body: z.object({
        docType: z.string().trim().min(1).max(48),
        title: z.string().trim().max(191).optional(),
        storagePath: z.string().trim().min(1).max(512),
        mimeType: z.string().trim().max(96).optional(),
        listingDocumentId: z.coerce.number().int().positive().optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { vehicleId } = params<{ vehicleId: number }>(req);
      const input = body<{
        docType: string;
        title?: string;
        storagePath: string;
        mimeType?: string;
        listingDocumentId?: number;
      }>(req);
      return created(
        res,
        await uploadVehicleDocument({
          vehicleId,
          userId: currentUserId(req),
          isStaff: isStaff(req),
          docType: input.docType,
          title: input.title ?? null,
          storagePath: input.storagePath,
          mimeType: input.mimeType ?? null,
          listingDocumentId: input.listingDocumentId ?? null,
        }),
      );
    }),
  );

  router.get(
    '/vehicles/:vehicleId/documents',
    requireAuth,
    validate({ params: vehicleParams }),
    asyncHandler(async (req, res) => {
      const { vehicleId } = params<{ vehicleId: number }>(req);
      return ok(res, await listVehicleDocuments(vehicleId, currentUserId(req), isStaff(req)));
    }),
  );

  router.post(
    '/documents/:id/verify',
    requireAuth,
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
        await verifyVehicleDocument({
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
    '/vehicles/:vehicleId/history',
    validate({ params: vehicleParams }),
    asyncHandler(async (req, res) => {
      const { vehicleId } = params<{ vehicleId: number }>(req);
      return ok(res, await listHistory(vehicleId));
    }),
  );

  router.post(
    '/vehicles/:vehicleId/history',
    requireAuth,
    writeRateLimit,
    validate({
      params: vehicleParams,
      body: z.object({
        eventType: z.enum([
          'ownership',
          'registration',
          'accident',
          'mileage',
          'service',
          'inspection',
          'import',
          'export',
          'damage',
          'auction',
          'recall',
          'other',
        ]),
        occurredAt: isoDate.optional(),
        summary: z.string().trim().max(500).optional(),
        isVerified: z.coerce.boolean().optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { vehicleId } = params<{ vehicleId: number }>(req);
      const input = body<{
        eventType:
          | 'ownership'
          | 'registration'
          | 'accident'
          | 'mileage'
          | 'service'
          | 'inspection'
          | 'import'
          | 'export'
          | 'damage'
          | 'auction'
          | 'recall'
          | 'other';
        occurredAt?: string;
        summary?: string;
        isVerified?: boolean;
      }>(req);
      return created(
        res,
        await addHistoryEvent({
          vehicleId,
          userId: currentUserId(req),
          isStaff: isStaff(req),
          eventType: input.eventType,
          occurredAt: input.occurredAt ?? null,
          summary: input.summary ?? null,
        }),
      );
    }),
  );

  router.get(
    '/vehicles/:vehicleId/service',
    authenticate,
    validate({ params: vehicleParams }),
    asyncHandler(async (req, res) => {
      const { vehicleId } = params<{ vehicleId: number }>(req);
      return ok(res, await listServiceRecords(vehicleId, req.auth?.userId ?? null, isStaff(req)));
    }),
  );

  router.post(
    '/vehicles/:vehicleId/service',
    requireAuth,
    writeRateLimit,
    validate({
      params: vehicleParams,
      body: z.object({
        servicedAt: isoDate,
        mileageValue: z.coerce.number().int().min(0).optional(),
        mileageUnit: z.string().max(16).optional(),
        workshop: z.string().trim().max(191).optional(),
        serviceType: z.string().trim().max(96).optional(),
        parts: z.string().trim().max(500).optional(),
        costAmount: z.coerce.number().min(0).optional(),
        costCurrency: z.string().length(3).optional(),
        notes: z.string().trim().max(1000).optional(),
        visibility: z.enum(['private', 'authorized', 'public']).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { vehicleId } = params<{ vehicleId: number }>(req);
      const input = body<{
        servicedAt: string;
        mileageValue?: number;
        mileageUnit?: string;
        workshop?: string;
        serviceType?: string;
        parts?: string;
        costAmount?: number;
        costCurrency?: string;
        notes?: string;
        visibility?: 'private' | 'authorized' | 'public';
      }>(req);
      return created(
        res,
        await addServiceRecord({
          vehicleId,
          userId: currentUserId(req),
          isStaff: isStaff(req),
          ...input,
        }),
      );
    }),
  );

  router.post(
    '/vehicles/:vehicleId/mileage',
    requireAuth,
    writeRateLimit,
    validate({
      params: vehicleParams,
      body: z.object({
        value: z.coerce.number().int().min(0),
        unit: z.string().max(16),
        verificationStatus: z.string().optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { vehicleId } = params<{ vehicleId: number }>(req);
      const input = body<{ value: number; unit: string }>(req);
      return created(
        res,
        await addMileageReading({
          vehicleId,
          userId: currentUserId(req),
          isStaff: isStaff(req),
          value: input.value,
          unit: input.unit,
        }),
      );
    }),
  );

  router.post(
    '/listings/:listingId/inspections',
    requireAuth,
    writeRateLimit,
    validate({
      params: listingParams,
      body: z.object({
        checklistCode: z.string().min(1).max(48),
        inspectorName: z.string().trim().max(160).optional(),
        result: z.enum(['pass', 'pass_with_warnings', 'requires_repair', 'fail']).optional(),
        items: z
          .array(
            z.object({
              itemCode: z.string().min(1).max(64),
              score: z.coerce.number().min(0).max(100).optional(),
              result: z.string().max(32).optional(),
              notes: z.string().max(500).optional(),
              measurement: z.string().max(64).optional(),
            }),
          )
          .min(1)
          .max(80),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      const input = body<{
        checklistCode: string;
        inspectorName?: string;
        items: Array<{ itemCode: string; score?: number; result?: string; notes?: string; measurement?: string }>;
      }>(req);
      return created(
        res,
        await createStructuredInspection({
          listingId,
          inspectorId: currentUserId(req),
          isStaff: isStaff(req),
          checklistCode: input.checklistCode,
          inspectorName: input.inspectorName ?? null,
          items: input.items,
        }),
      );
    }),
  );

  router.get(
    '/listings/:listingId/inspections',
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      return ok(res, await getStructuredInspection(listingId));
    }),
  );

  router.post(
    '/ai/valuate',
    requireAuth,
    aiRateLimit,
    validate({
      body: z.object({
        listingId: z.coerce.number().int().positive().optional(),
        makeId: z.coerce.number().int().positive(),
        modelId: z.coerce.number().int().positive().optional(),
        variantId: z.coerce.number().int().positive().optional(),
        year: z.coerce.number().int().min(1900).max(2100),
        mileageKm: z.coerce.number().int().min(0).optional(),
        conditionGrade: z.string().max(32).optional(),
        askingPrice: z.coerce.number().min(0).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const input = body<{
        listingId?: number;
        makeId: number;
        modelId?: number;
        variantId?: number;
        year: number;
        mileageKm?: number;
        conditionGrade?: string;
        askingPrice?: number;
      }>(req);
      const gated = await throughGateway(req, {
        task: 'vehicle_estimate',
        input,
        run: async () => {
          const valuation = await runValuation({
            listingId: input.listingId ?? null,
            requestedBy: currentUserId(req),
            countryId: req.context.countryId,
            makeId: input.makeId,
            modelId: input.modelId ?? null,
            variantId: input.variantId ?? null,
            year: input.year,
            mileageKm: input.mileageKm ?? null,
            conditionGrade: input.conditionGrade ?? null,
            askingPrice: input.askingPrice ?? null,
            currency: req.context.currency,
          });
          return { ...valuation, model: 'vehicle-valuation', confidence: valuation.confidence, latencyMs: 0 };
        },
      });
      if ('accepted' in gated) return accepted(res, gated);
      return ok(res, {
        ...gated.result,
        meta: gated.meta,
        disclaimer: 'Estimate from comparable listings. Not a guaranteed trade-in or retail price.',
      });
    }),
  );

  router.post(
    '/ai/quality/:listingId',
    requireAuth,
    aiRateLimit,
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      return ok(res, await assessListingQuality(listingId));
    }),
  );

  router.post(
    '/ai/images/:listingId',
    requireAuth,
    aiRateLimit,
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      return ok(res, await analyseListingImages(listingId));
    }),
  );

  router.get(
    '/listings/:listingId/risk',
    requireAuth,
    validate({ params: listingParams }),
    asyncHandler(async (req, res) => {
      const { listingId } = params<{ listingId: number }>(req);
      return ok(res, await analyseVehicleRisk(listingId));
    }),
  );

  router.get(
    '/parts',
    validate({
      query: z.object({
        q: z.string().trim().max(128).optional(),
        oem: z.string().trim().max(64).optional(),
        sku: z.string().trim().max(64).optional(),
        brand: z.string().trim().max(96).optional(),
        categoryCode: z.string().trim().max(48).optional(),
        makeId: z.coerce.number().int().positive().optional(),
        modelId: z.coerce.number().int().positive().optional(),
        year: z.coerce.number().int().min(1900).max(2100).optional(),
        conditionCode: z.string().max(32).optional(),
        page: z.coerce.number().int().min(1).default(1),
        perPage: z.coerce.number().int().min(1).max(50).default(20),
      }),
    }),
    asyncHandler(async (req, res) => ok(res, await searchParts(query(req)))),
  );

  router.post(
    '/parts',
    requireAuth,
    writeRateLimit,
    validate({
      body: z.object({
        categoryCode: z.string().trim().min(1).max(48),
        name: z.string().trim().min(1).max(191),
        sku: z.string().trim().max(64).optional(),
        oemPartNumber: z.string().trim().max(64).optional(),
        manufacturerPartNumber: z.string().trim().max(64).optional(),
        barcode: z.string().trim().max(64).optional(),
        brand: z.string().trim().max(96).optional(),
        conditionCode: z.string().max(32).optional(),
        warranty: z.string().trim().max(128).optional(),
        price: z.coerce.number().min(0),
        currency: z.string().length(3).optional(),
        quantity: z.coerce.number().int().min(0).optional(),
        compatibility: z
          .array(
            z.object({
              makeId: z.coerce.number().int().positive().optional(),
              modelId: z.coerce.number().int().positive().optional(),
              yearFrom: z.coerce.number().int().min(1900).optional(),
              yearTo: z.coerce.number().int().min(1900).optional(),
              engineCc: z.coerce.number().int().min(0).optional(),
              transmission: z.string().max(32).optional(),
            }),
          )
          .max(50)
          .optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const input = body<{
        categoryCode: string;
        name: string;
        sku?: string;
        oemPartNumber?: string;
        manufacturerPartNumber?: string;
        barcode?: string;
        brand?: string;
        conditionCode?: string;
        warranty?: string;
        price: number;
        currency?: string;
        quantity?: number;
        compatibility?: Array<{
          makeId?: number;
          modelId?: number;
          yearFrom?: number;
          yearTo?: number;
          engineCc?: number;
          transmission?: string;
        }>;
      }>(req);
      return created(
        res,
        await createPart({
          sellerId: currentUserId(req),
          ...input,
          currency: input.currency ?? req.context.currency,
        }),
      );
    }),
  );

  router.get(
    '/parts/:id',
    validate({ params: idParams }),
    asyncHandler(async (req, res) => ok(res, await getPart(params<{ id: number }>(req).id))),
  );

  router.post(
    '/parts/:id/buy',
    requireAuth,
    writeRateLimit,
    riskGuard('enforce'),
    validate({
      params: idParams,
      body: z.object({
        quantity: z.coerce.number().int().min(1).max(99).default(1),
        gatewayCode: z.string().min(1).max(32).default('manual'),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{ quantity: number; gatewayCode: string }>(req);
      return created(
        res,
        await buyPart({
          partId: id,
          buyerId: currentUserId(req),
          countryId: req.context.countryId ?? 1,
          quantity: input.quantity,
          gatewayCode: input.gatewayCode,
        }),
      );
    }),
  );

  router.get(
    '/trade/rules',
    validate({
      query: z.object({
        originCountryId: z.coerce.number().int().positive(),
        destinationCountryId: z.coerce.number().int().positive(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const q = query<{ originCountryId: number; destinationCountryId: number }>(req);
      return ok(res, await getTradeRule(q.originCountryId, q.destinationCountryId));
    }),
  );

  router.post(
    '/trade/landed-cost',
    validate({
      body: z.object({
        listingId: z.coerce.number().int().positive().optional(),
        originCountryId: z.coerce.number().int().positive(),
        destinationCountryId: z.coerce.number().int().positive(),
        vehiclePrice: z.coerce.number().min(0),
        currency: z.string().length(3).optional(),
        shipping: z.coerce.number().min(0).optional(),
        insurance: z.coerce.number().min(0).optional(),
        portFees: z.coerce.number().min(0).optional(),
        inspectionFees: z.coerce.number().min(0).optional(),
        registrationFees: z.coerce.number().min(0).optional(),
        brokerFees: z.coerce.number().min(0).optional(),
        localDelivery: z.coerce.number().min(0).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const input = body<{
        listingId?: number;
        originCountryId: number;
        destinationCountryId: number;
        vehiclePrice: number;
        currency?: string;
        shipping?: number;
        insurance?: number;
        portFees?: number;
        inspectionFees?: number;
        registrationFees?: number;
        brokerFees?: number;
        localDelivery?: number;
      }>(req);
      return ok(
        res,
        await estimateLandedCost({
          ...input,
          listingId: input.listingId ?? null,
          currency: input.currency ?? req.context.currency,
        }),
      );
    }),
  );

  router.post(
    '/trade/cases',
    requireAuth,
    writeRateLimit,
    validate({
      body: z.object({
        listingId: z.coerce.number().int().positive(),
        originCountryId: z.coerce.number().int().positive(),
        destinationCountryId: z.coerce.number().int().positive(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const input = body<{ listingId: number; originCountryId: number; destinationCountryId: number }>(req);
      return created(
        res,
        await startTradeCase({
          listingId: input.listingId,
          buyerId: currentUserId(req),
          originCountryId: input.originCountryId,
          destinationCountryId: input.destinationCountryId,
        }),
      );
    }),
  );

  router.get(
    '/trade/cases/:id',
    requireAuth,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      return ok(res, await getTradeCase(id, currentUserId(req), isStaff(req)));
    }),
  );

  router.post(
    '/trade/cases/:id/advance',
    requireAuth,
    writeRateLimit,
    validate({
      params: idParams,
      body: z.object({ toStatus: z.string().min(1).max(48) }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{ toStatus: string }>(req);
      return ok(
        res,
        await advanceTradeCase({
          caseId: id,
          userId: currentUserId(req),
          isStaff: isStaff(req),
          toStatus: input.toStatus as never,
        }),
      );
    }),
  );

  router.post(
    '/trade/cases/:id/shipments',
    requireAuth,
    writeRateLimit,
    validate({
      params: idParams,
      body: z.object({
        mode: z.string().min(1).max(32),
        providerCode: z.string().max(48).optional(),
        originPort: z.string().max(128).optional(),
        destinationPort: z.string().max(128).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{ mode: string; providerCode?: string; originPort?: string; destinationPort?: string }>(req);
      return created(
        res,
        await bookShipment({
          caseId: id,
          userId: currentUserId(req),
          isStaff: isStaff(req),
          ...input,
        }),
      );
    }),
  );

  router.get(
    '/shipments/:id',
    requireAuth,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      return ok(res, await trackShipment(id, currentUserId(req), isStaff(req)));
    }),
  );

  router.post(
    '/trade/cases/:id/customs',
    requireAuth,
    writeRateLimit,
    validate({
      params: idParams,
      body: z.object({
        direction: z.enum(['export', 'import']),
        dutyAmount: z.coerce.number().min(0).optional(),
        taxAmount: z.coerce.number().min(0).optional(),
        currency: z.string().length(3).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { id } = params<{ id: number }>(req);
      const input = body<{
        direction: 'export' | 'import';
        dutyAmount?: number;
        taxAmount?: number;
        currency?: string;
      }>(req);
      return created(
        res,
        await submitCustoms({
          caseId: id,
          userId: currentUserId(req),
          isStaff: isStaff(req),
          ...input,
        }),
      );
    }),
  );

  router.post(
    '/finance/quote',
    requireAuth,
    validate({
      body: z.object({
        listingId: z.coerce.number().int().positive().optional(),
        vehiclePrice: z.coerce.number().positive(),
        downPayment: z.coerce.number().min(0),
        termMonths: z.coerce.number().int().min(1).max(120),
        annualRatePct: z.coerce.number().min(0).max(80),
        currency: z.string().length(3).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const input = body<{
        listingId?: number;
        vehiclePrice: number;
        downPayment: number;
        termMonths: number;
        annualRatePct: number;
        currency?: string;
      }>(req);
      return ok(
        res,
        await estimateFinance({
          ...input,
          listingId: input.listingId ?? null,
          userId: currentUserId(req),
          currency: input.currency ?? req.context.currency,
        }),
      );
    }),
  );

  router.post(
    '/insurance/quote',
    requireAuth,
    validate({
      body: z.object({
        listingId: z.coerce.number().int().positive().optional(),
        vehiclePrice: z.coerce.number().positive(),
        coverage: z.string().max(128).optional(),
        currency: z.string().length(3).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const input = body<{ listingId?: number; vehiclePrice: number; coverage?: string; currency?: string }>(req);
      return ok(
        res,
        await estimateInsurance({
          listingId: input.listingId ?? null,
          userId: currentUserId(req),
          vehiclePrice: input.vehiclePrice,
          coverage: input.coverage,
          currency: input.currency ?? req.context.currency,
        }),
      );
    }),
  );
}
