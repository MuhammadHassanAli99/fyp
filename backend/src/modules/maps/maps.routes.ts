import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { ok } from '../../core/http/response';
import { validate, query, body } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { resolveMarketplace } from '../../middleware/request-context';
import { searchRateLimit } from '../../middleware/rate-limit';
import { trackSearchEvent } from '../search/search.analytics';
import {
  describeMap,
  directionsFor,
  distanceBetween,
  nearbyPlaces,
  searchMap,
  streetViewFor,
  type MapSearchInput,
} from './maps.service';

export const mapsRouter = Router();
mapsRouter.use(authenticate);

const boundsSchema = z.object({
  minLat: z.coerce.number().min(-90).max(90),
  maxLat: z.coerce.number().min(-90).max(90),
  minLng: z.coerce.number().min(-180).max(180),
  maxLng: z.coerce.number().min(-180).max(180),
});

mapsRouter.get(
  '/capabilities',
  validate({
    query: z.object({
      provider: z.enum(['openstreetmap', 'google', 'apple']).optional(),
      platform: z.enum(['android', 'ios', 'web', 'windows', 'macos', 'linux']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ provider?: string; platform?: string }>(req);
    return ok(res, await describeMap(q));
  }),
);

mapsRouter.post(
  '/search',
  resolveMarketplace,
  searchRateLimit,
  validate({
    body: z.object({
      marketplace: z.enum(['gold', 'property', 'vehicles']).nullable().optional(),
      dsl: z.record(z.string(), z.unknown()).optional(),
      filters: z.record(z.string(), z.unknown()).optional(),
      bounds: boundsSchema.optional(),
      zoom: z.coerce.number().min(1).max(18).optional(),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      radiusKm: z.coerce.number().min(0.1).max(100).optional(),
      provider: z.enum(['openstreetmap', 'google', 'apple']).optional(),
      platform: z.enum(['android', 'ios', 'web', 'windows', 'macos', 'linux']).optional(),
      style: z.enum(['standard', 'satellite', 'hybrid']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<MapSearchInput>(req);
    const result = await searchMap(
      { ...input, marketplace: input.marketplace ?? req.marketplaceCode ?? null },
      {
        currency: req.context.currency,
        language: req.context.language,
        countryCode: req.context.countryCode,
        countryId: req.context.countryId,
      },
    );
    await trackSearchEvent({
      eventType: 'map_open',
      userId: req.auth?.userId ?? null,
      guestUuid: req.guestUuid ?? null,
      marketplaceId: req.marketplaceId ?? null,
      metadata: { zoom: input.zoom, clustered: result.clustered, total: result.total },
      countryId: req.context.countryId,
    });
    return ok(res, result);
  }),
);

mapsRouter.get(
  '/markers',
  resolveMarketplace,
  searchRateLimit,
  validate({
    query: boundsSchema.extend({
      marketplace: z.enum(['gold', 'property', 'vehicles']).optional(),
      zoom: z.coerce.number().min(1).max(18).optional(),
      radiusKm: z.coerce.number().min(0.1).max(100).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{
      minLat: number;
      maxLat: number;
      minLng: number;
      maxLng: number;
      marketplace?: string;
      zoom?: number;
    }>(req);
    const result = await searchMap(
      {
        marketplace: q.marketplace ?? req.marketplaceCode ?? null,
        bounds: q,
        zoom: q.zoom,
      },
      {
        currency: req.context.currency,
        language: req.context.language,
        countryCode: req.context.countryCode,
        countryId: req.context.countryId,
      },
    );
    return ok(res, result);
  }),
);

mapsRouter.post(
  '/events',
  searchRateLimit,
  validate({
    body: z.object({
      eventType: z.enum([
        'map_open',
        'map_move',
        'nearby_search',
        'marker_click',
        'listing_click',
        'directions_click',
        'street_view',
        'satellite',
        'poi_click',
        'filter_apply',
        'filter_clear',
        'filter_chip_remove',
      ]),
      listingId: z.coerce.number().int().positive().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      eventType: Parameters<typeof trackSearchEvent>[0]['eventType'];
      listingId?: number;
      metadata?: Record<string, unknown>;
    }>(req);
    await trackSearchEvent({
      eventType: input.eventType,
      userId: req.auth?.userId ?? null,
      guestUuid: req.guestUuid ?? null,
      marketplaceId: req.marketplaceId ?? null,
      listingId: input.listingId ?? null,
      metadata: input.metadata,
      countryId: req.context.countryId,
    });
    return ok(res, { recorded: true });
  }),
);

mapsRouter.get(
  '/directions',
  validate({
    query: z.object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      originLat: z.coerce.number().min(-90).max(90).optional(),
      originLng: z.coerce.number().min(-180).max(180).optional(),
      provider: z.enum(['openstreetmap', 'google', 'apple']).optional(),
      platform: z.enum(['android', 'ios', 'web', 'windows', 'macos', 'linux']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{
      lat: number;
      lng: number;
      originLat?: number;
      originLng?: number;
      provider?: string;
      platform?: string;
    }>(req);
    return ok(
      res,
      directionsFor({
        destination: { lat: q.lat, lng: q.lng },
        origin: q.originLat !== undefined && q.originLng !== undefined ? { lat: q.originLat, lng: q.originLng } : undefined,
        provider: q.provider,
        platform: q.platform,
      }),
    );
  }),
);

mapsRouter.get(
  '/street-view',
  validate({
    query: z.object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      provider: z.enum(['openstreetmap', 'google', 'apple']).optional(),
      platform: z.enum(['android', 'ios', 'web', 'windows', 'macos', 'linux']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ lat: number; lng: number; provider?: string; platform?: string }>(req);
    return ok(res, streetViewFor(q));
  }),
);

mapsRouter.get(
  '/distance',
  validate({
    query: z.object({
      fromLat: z.coerce.number().min(-90).max(90),
      fromLng: z.coerce.number().min(-180).max(180),
      toLat: z.coerce.number().min(-90).max(90),
      toLng: z.coerce.number().min(-180).max(180),
      unit: z.enum(['m', 'km', 'mi']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{
      fromLat: number;
      fromLng: number;
      toLat: number;
      toLng: number;
      unit?: 'm' | 'km' | 'mi';
    }>(req);
    return ok(
      res,
      distanceBetween({ lat: q.fromLat, lng: q.fromLng }, { lat: q.toLat, lng: q.toLng }, q.unit),
    );
  }),
);

mapsRouter.get(
  '/places',
  searchRateLimit,
  validate({
    query: z.object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      radiusM: z.coerce.number().int().min(200).max(10_000).optional(),
      types: z.string().max(191).optional(),
      listingId: z.coerce.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{
      lat: number;
      lng: number;
      radiusM?: number;
      types?: string;
      listingId?: number;
    }>(req);
    return ok(
      res,
      await nearbyPlaces({
        lat: q.lat,
        lng: q.lng,
        radiusM: q.radiusM,
        types: q.types ? q.types.split(',').map((item) => item.trim()).filter(Boolean) : undefined,
        listingId: q.listingId,
        countryId: req.context.countryId,
      }),
    );
  }),
);
