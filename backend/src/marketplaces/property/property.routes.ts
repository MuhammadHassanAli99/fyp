import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok, withCache } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { requireAuth } from '../../middleware/authenticate';
import { aiRateLimit } from '../../middleware/rate-limit';
import { unauthenticated } from '../../core/errors';
import {
  getAreaUnitsForCountry,
  getNearbyPlaces,
  getPropertyPriceIndex,
  listAmenities,
  listViewings,
  requestViewing,
  updateViewingStatus,
  valuateProperty,
  type ViewingStatus,
} from './property.service';
import { registerPropertyDomainRoutes } from './property.domain.routes';

export const propertyRouter = Router();

/** `requireAuth` has already rejected guests; this only narrows the type. */
const currentUserId = (req: Request): number => {
  if (!req.auth) throw unauthenticated();
  return req.auth.userId;
};

const listingParams = z.object({ listingId: z.coerce.number().int().positive() });

/** §6 Property Features — the amenity checklist on the listing form and filters. */
propertyRouter.get(
  '/amenities',
  asyncHandler(async (_req, res) => {
    const groups = await listAmenities();
    withCache(res, 3600);
    return ok(res, groups);
  }),
);

/**
 * The unit picker. A seller in Lahore thinks in marla and one in Dubai in sqft,
 * so the client needs to know which unit to preselect before showing the form.
 */
propertyRouter.get(
  '/area-units',
  asyncHandler(async (req, res) => {
    const units = await getAreaUnitsForCountry(req.context.countryId);
    withCache(res, 3600);
    return ok(res, units);
  }),
);

/** §18 Market Analysis — what the area is going for, and which way it is moving. */
propertyRouter.get(
  '/price-index',
  validate({
    query: z.object({
      cityId: z.coerce.number().int().positive().optional(),
      areaId: z.coerce.number().int().positive().optional(),
      propertyKind: z.string().trim().min(1).max(48),
      operation: z.enum(['sell', 'rent']).default('sell'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ cityId?: number; areaId?: number; propertyKind: string; operation: 'sell' | 'rent' }>(req);
    const index = await getPropertyPriceIndex({
      countryId: req.context.countryId,
      cityId: q.cityId ?? null,
      areaId: q.areaId ?? null,
      propertyKind: q.propertyKind,
      operation: q.operation,
      currency: req.context.currency,
    });
    withCache(res, 900);
    return ok(res, { index, currency: req.context.currency });
  }),
);

/**
 * §18 Property Valuation.
 *
 * Authenticated and rate-limited: it runs a comparables sweep per call and the
 * output is a market opinion, not a number we want scraped in bulk.
 */
propertyRouter.post(
  '/valuate',
  requireAuth,
  aiRateLimit,
  validate({
    body: z.object({
      listingId: z.coerce.number().int().positive().optional(),
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

    const valuation = await valuateProperty({
      listingId: input.listingId ?? null,
      requestedBy: currentUserId(req),
      countryId: req.context.countryId,
      cityId: input.cityId,
      areaId: input.areaId ?? null,
      propertyKind: input.propertyKind,
      operation: input.operation,
      areaValue: input.areaValue,
      areaUnit: input.areaUnit,
      bedrooms: input.bedrooms ?? null,
      bathrooms: input.bathrooms ?? null,
      furnishing: input.furnishing ?? null,
      yearBuilt: input.yearBuilt ?? null,
      amenityCount: input.amenityCount ?? null,
      currency: req.context.currency,
    });

    return ok(res, {
      ...valuation,
      disclaimer:
        'This is an automated estimate from asking prices of comparable listings, not a surveyed valuation. Asking prices are not sale prices. Commission a licensed valuer before signing anything.',
    });
  }),
);

/** §11 Nearby Places — schools, transit and hospitals around the property. */
propertyRouter.get(
  '/listings/:listingId/nearby',
  validate({ params: listingParams }),
  asyncHandler(async (req, res) => {
    const p = params<{ listingId: number }>(req);
    const places = await getNearbyPlaces(p.listingId);
    withCache(res, 600);
    return ok(res, places);
  }),
);

propertyRouter.post(
  '/listings/:listingId/viewings',
  requireAuth,
  validate({
    params: listingParams,
    body: z.object({
      scheduledAt: z.string().min(1),
      durationMin: z.coerce.number().int().min(10).max(480).optional(),
      mode: z.enum(['in_person', 'video_call', 'virtual_tour']).optional(),
      notes: z.string().trim().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const p = params<{ listingId: number }>(req);
    const input = body<{
      scheduledAt: string;
      durationMin?: number;
      mode?: 'in_person' | 'video_call' | 'virtual_tour';
      notes?: string;
    }>(req);
    const viewing = await requestViewing(p.listingId, currentUserId(req), input);
    return created(res, viewing);
  }),
);

/** Both sides of the appointment read the same list, filtered by their role. */
propertyRouter.get(
  '/viewings',
  requireAuth,
  validate({
    query: z.object({
      role: z.enum(['visitor', 'owner']).default('visitor'),
      status: z.enum(['requested', 'confirmed', 'rescheduled', 'completed', 'cancelled', 'no_show']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ role: 'visitor' | 'owner'; status?: ViewingStatus }>(req);
    const viewings = await listViewings({
      userId: currentUserId(req),
      role: q.role,
      status: q.status ?? null,
    });
    return ok(res, viewings);
  }),
);

propertyRouter.patch(
  '/viewings/:id',
  requireAuth,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({
      status: z.enum(['requested', 'confirmed', 'rescheduled', 'completed', 'cancelled', 'no_show']),
      notes: z.string().trim().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const p = params<{ id: number }>(req);
    const input = body<{ status: ViewingStatus; notes?: string }>(req);
    const viewing = await updateViewingStatus(p.id, currentUserId(req), {
      status: input.status,
      notes: input.notes ?? null,
    });
    return ok(res, viewing);
  }),
);

registerPropertyDomainRoutes(propertyRouter);
