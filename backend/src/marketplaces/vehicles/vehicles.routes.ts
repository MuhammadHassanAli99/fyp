import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok, withCache } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { requireAuth } from '../../middleware/authenticate';
import { requireStaff } from '../../middleware/authorize';
import { aiRateLimit } from '../../middleware/rate-limit';
import { unauthenticated } from '../../core/errors';
import {
  estimateVehiclePrice,
  getInspection,
  getVariant,
  getVehiclePriceIndex,
  listFeatures,
  listMakes,
  listModels,
  listVariants,
  saveInspection,
  type InspectionInput,
} from './vehicles.service';
import { registerVehicleDomainRoutes } from './vehicles.domain.routes';

export const vehiclesRouter = Router();

/** `requireAuth` has already rejected guests; this only narrows the type. */
const currentUserId = (req: Request): number => {
  if (!req.auth) throw unauthenticated();
  return req.auth.userId;
};

const vehicleType = z.enum([
  'car', 'motorcycle', 'bus', 'truck', 'van', 'taxi', 'rickshaw', 'tractor',
  'heavy_machinery', 'construction_equipment', 'agriculture_equipment',
  'boat', 'yacht', 'jet_ski', 'atv', 'trailer', 'other',
]);

/** §7 Make — the first step of the listing form and of every model filter. */
vehiclesRouter.get(
  '/makes',
  validate({ query: z.object({ vehicleType: vehicleType.optional(), popular: z.coerce.boolean().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = query<{ vehicleType?: string; popular?: boolean }>(req);
    const makes = await listMakes({ vehicleType: q.vehicleType ?? null, popularOnly: q.popular === true });
    withCache(res, 3600);
    return ok(res, makes);
  }),
);

vehiclesRouter.get(
  '/makes/:makeId/models',
  validate({
    params: z.object({ makeId: z.coerce.number().int().positive() }),
    query: z.object({ vehicleType: vehicleType.optional() }),
  }),
  asyncHandler(async (req, res) => {
    const p = params<{ makeId: number }>(req);
    const q = query<{ vehicleType?: string }>(req);
    const models = await listModels(p.makeId, q.vehicleType ?? null);
    withCache(res, 3600);
    return ok(res, models);
  }),
);

vehiclesRouter.get(
  '/models/:modelId/variants',
  validate({
    params: z.object({ modelId: z.coerce.number().int().positive() }),
    query: z.object({ year: z.coerce.number().int().min(1900).max(2100).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const p = params<{ modelId: number }>(req);
    const q = query<{ year?: number }>(req);
    const variants = await listVariants(p.modelId, q.year ?? null);
    withCache(res, 3600);
    return ok(res, variants);
  }),
);

/** The reference spec sheet the compare screen renders against (spec lines 1–2). */
vehiclesRouter.get(
  '/variants/:variantId',
  validate({ params: z.object({ variantId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const p = params<{ variantId: number }>(req);
    const variant = await getVariant(p.variantId);
    withCache(res, 3600);
    return ok(res, variant);
  }),
);

vehiclesRouter.get(
  '/features',
  validate({ query: z.object({ vehicleType: vehicleType.optional() }) }),
  asyncHandler(async (req, res) => {
    const q = query<{ vehicleType?: string }>(req);
    const features = await listFeatures(q.vehicleType ?? null);
    withCache(res, 3600);
    return ok(res, features);
  }),
);

/** §18 Market Analysis — what this make/model/year is actually trading at. */
vehiclesRouter.get(
  '/price-index',
  validate({
    query: z.object({
      makeId: z.coerce.number().int().positive(),
      modelId: z.coerce.number().int().positive().optional(),
      variantId: z.coerce.number().int().positive().optional(),
      year: z.coerce.number().int().min(1900).max(2100).optional(),
      cityId: z.coerce.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ makeId: number; modelId?: number; variantId?: number; year?: number; cityId?: number }>(req);
    const index = await getVehiclePriceIndex({
      countryId: req.context.countryId,
      cityId: q.cityId ?? null,
      makeId: q.makeId,
      modelId: q.modelId ?? null,
      variantId: q.variantId ?? null,
      year: q.year ?? null,
      currency: req.context.currency,
    });
    withCache(res, 900);
    return ok(res, { index, currency: req.context.currency });
  }),
);

/**
 * §18 Vehicle Price Estimation.
 *
 * Authenticated and rate-limited: each call sweeps live comparables, and the
 * result is a market opinion we do not want scraped as a bulk pricing feed.
 */
vehiclesRouter.post(
  '/estimate',
  requireAuth,
  aiRateLimit,
  validate({
    body: z.object({
      listingId: z.coerce.number().int().positive().optional(),
      makeId: z.coerce.number().int().positive(),
      modelId: z.coerce.number().int().positive().optional(),
      variantId: z.coerce.number().int().positive().optional(),
      cityId: z.coerce.number().int().positive().optional(),
      year: z.coerce.number().int().min(1900).max(2100),
      mileageKm: z.coerce.number().int().min(0).max(9_999_999).optional(),
      conditionGrade: z.enum(['excellent', 'very_good', 'good', 'fair', 'poor', 'salvage']).optional(),
      accidentHistory: z.enum(['none', 'minor', 'major', 'unknown']).optional(),
      ownersCount: z.coerce.number().int().min(0).max(255).optional(),
      inspectionScore: z.coerce.number().min(0).max(100).optional(),
      registrationStatus: z.enum(['registered', 'unregistered', 'applied', 'transferred', 'on_papers']).optional(),
      askingPrice: z.coerce.number().min(0).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      listingId?: number;
      makeId: number;
      modelId?: number;
      variantId?: number;
      cityId?: number;
      year: number;
      mileageKm?: number;
      conditionGrade?: string;
      accidentHistory?: string;
      ownersCount?: number;
      inspectionScore?: number;
      registrationStatus?: string;
      askingPrice?: number;
    }>(req);

    const estimate = await estimateVehiclePrice({
      listingId: input.listingId ?? null,
      requestedBy: currentUserId(req),
      countryId: req.context.countryId,
      cityId: input.cityId ?? null,
      makeId: input.makeId,
      modelId: input.modelId ?? null,
      variantId: input.variantId ?? null,
      year: input.year,
      mileageKm: input.mileageKm ?? null,
      conditionGrade: input.conditionGrade ?? null,
      accidentHistory: input.accidentHistory ?? null,
      ownersCount: input.ownersCount ?? null,
      inspectionScore: input.inspectionScore ?? null,
      registrationStatus: input.registrationStatus ?? null,
      askingPrice: input.askingPrice ?? null,
      currency: req.context.currency,
    });

    return ok(res, {
      ...estimate,
      disclaimer:
        'This is an automated estimate from asking prices, market index data and depreciation curves — not an inspection or a firm offer. The condition of the individual vehicle can move the real price well outside this range.',
    });
  }),
);

const listingParams = z.object({ listingId: z.coerce.number().int().positive() });

vehiclesRouter.get(
  '/listings/:listingId/inspection',
  validate({ params: listingParams }),
  asyncHandler(async (req, res) => {
    const p = params<{ listingId: number }>(req);
    const inspection = await getInspection(p.listingId);
    return ok(res, inspection);
  }),
);

const sectionScore = z.coerce.number().min(0).max(100).optional();

vehiclesRouter.post(
  '/listings/:listingId/inspection',
  requireAuth,
  requireStaff,
  validate({
    params: listingParams,
    body: z.object({
      inspectorName: z.string().trim().max(160).optional(),
      engineScore: sectionScore,
      transmissionScore: sectionScore,
      suspensionScore: sectionScore,
      brakesScore: sectionScore,
      electricalScore: sectionScore,
      interiorScore: sectionScore,
      exteriorScore: sectionScore,
      acScore: sectionScore,
      tyresScore: sectionScore,
      checklist: z.unknown().optional(),
      findings: z.unknown().optional(),
      reportUrl: z.string().url().max(512).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const p = params<{ listingId: number }>(req);
    const input = body<InspectionInput>(req);
    const inspection = await saveInspection(p.listingId, {
      ...input,
      inspectorId: currentUserId(req),
      isStaff: Boolean(req.auth?.isStaff),
    });
    return created(res, inspection);
  }),
);

registerVehicleDomainRoutes(vehiclesRouter);
