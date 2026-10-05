import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { ok } from '../../core/http/response';
import { validate, params, query } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { resolveMarketplace } from '../../middleware/request-context';
import { env } from '../../config/env';
import { queryOne, type Row } from '../../db/query';
import {
  getCityBySlug,
  listAreas,
  listCities,
  listRegions,
  nearbyCities,
  popularLocations,
  reverseGeocode,
  searchPlaces,
  forwardGeocode,
  lookupPostalCode,
} from './geo.service';

export const geoRouter = Router();
export const locationsAliasRouter = Router();

geoRouter.use(authenticate);
locationsAliasRouter.use(authenticate);

geoRouter.get(
  '/countries/:countryId/regions',
  validate({ params: z.object({ countryId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { countryId } = params<{ countryId: number }>(req);
    return ok(res, await listRegions(countryId));
  }),
);

geoRouter.get(
  '/countries/:countryId/cities',
  validate({
    params: z.object({ countryId: z.coerce.number().int().positive() }),
    query: z.object({
      regionId: z.coerce.number().int().positive().optional(),
      search: z.string().trim().max(96).optional(),
      popular: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { countryId } = params<{ countryId: number }>(req);
    const q = query<{ regionId?: number; search?: string; popular?: boolean; limit: number }>(req);
    return ok(
      res,
      await listCities({
        countryId,
        regionId: q.regionId ?? null,
        search: q.search ?? null,
        popularOnly: q.popular,
        limit: q.limit,
      }),
    );
  }),
);

geoRouter.get(
  '/countries/:countryId/cities/:idOrSlug',
  validate({
    params: z.object({
      countryId: z.coerce.number().int().positive(),
      idOrSlug: z.string().min(1).max(128),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { countryId, idOrSlug } = params<{ countryId: number; idOrSlug: string }>(req);
    return ok(res, await getCityBySlug(countryId, idOrSlug));
  }),
);

geoRouter.get(
  '/cities/:cityId/areas',
  validate({
    params: z.object({ cityId: z.coerce.number().int().positive() }),
    query: z.object({ search: z.string().trim().max(96).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const { cityId } = params<{ cityId: number }>(req);
    const { search } = query<{ search?: string }>(req);
    return ok(res, await listAreas(cityId, search ?? null));
  }),
);

geoRouter.get(
  '/reverse',
  validate({
    query: z.object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { lat, lng } = query<{ lat: number; lng: number }>(req);
    return ok(res, await reverseGeocode(lat, lng));
  }),
);

geoRouter.get(
  '/nearby',
  validate({
    query: z.object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      radiusKm: z.coerce.number().min(1).max(500).default(25),
      limit: z.coerce.number().int().min(1).max(50).default(25),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { lat, lng, radiusKm, limit } = query<{ lat: number; lng: number; radiusKm: number; limit: number }>(req);
    return ok(res, await nearbyCities(lat, lng, radiusKm, limit));
  }),
);

geoRouter.get(
  '/popular',
  resolveMarketplace,
  validate({
    query: z.object({
      countryId: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { countryId, limit } = query<{ countryId?: number; limit: number }>(req);
    const resolvedCountry = countryId ?? req.context.countryId;
    if (!resolvedCountry) return ok(res, []);
    return ok(res, await popularLocations(resolvedCountry, req.marketplaceId, limit));
  }),
);

geoRouter.get(
  '/search',
  validate({
    query: z.object({
      countryId: z.coerce.number().int().positive(),
      q: z.string().trim().min(1).max(96),
      limit: z.coerce.number().int().min(1).max(20).default(10),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { countryId, q, limit } = query<{ countryId: number; q: string; limit: number }>(req);
    return ok(res, await searchPlaces(countryId, q, limit));
  }),
);

geoRouter.get(
  '/geocode',
  validate({
    query: z.object({
      q: z.string().trim().min(2).max(191),
      countryId: z.coerce.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { q, countryId } = query<{ q: string; countryId?: number }>(req);
    return ok(res, await forwardGeocode({ query: q, countryId: countryId ?? req.context.countryId }));
  }),
);

geoRouter.get(
  '/postal',
  validate({
    query: z.object({
      countryId: z.coerce.number().int().positive(),
      q: z.string().trim().min(2).max(24),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { countryId, q } = query<{ countryId: number; q: string }>(req);
    return ok(res, await lookupPostalCode(countryId, q));
  }),
);

/**
 * IP-derived country suggestion. Uses edge/CDN country headers when present
 * (Cloudflare, App Engine). Never requests GPS. Client confirmation is required.
 */
geoRouter.get(
  '/suggest-country',
  asyncHandler(async (req, res) => {
    const header = String(req.headers['cf-ipcountry'] ?? req.headers['x-appengine-country'] ?? '')
      .toUpperCase()
      .slice(0, 2);
    const fromIp = /^[A-Z]{2}$/.test(header) && header !== 'XX' && header !== 'T1';
    const iso2 = fromIp ? header : env.DEFAULT_COUNTRY;
    const row = await queryOne<Row>(
      `SELECT id, iso2, name, native_name, flag_emoji, default_currency, default_language
         FROM countries WHERE iso2 = ? AND is_active = 1`,
      [iso2],
    );
    return ok(res, {
      iso2: row ? String(row.iso2) : env.DEFAULT_COUNTRY,
      countryId: row ? Number(row.id) : null,
      name: row ? String(row.name) : null,
      nativeName: row ? ((row.native_name as string | null) ?? null) : null,
      flagEmoji: row ? ((row.flag_emoji as string | null) ?? null) : null,
      defaultCurrency: row ? String(row.default_currency) : env.BASE_CURRENCY,
      defaultLanguage: row ? String(row.default_language) : env.DEFAULT_LANGUAGE,
      source: fromIp ? 'ip' : 'default',
      confidence: fromIp ? 'medium' : 'low',
      needsConfirmation: true,
    });
  }),
);

locationsAliasRouter.get(
  '/search',
  validate({
    query: z.object({
      countryId: z.coerce.number().int().positive(),
      q: z.string().trim().min(1).max(96),
      limit: z.coerce.number().int().min(1).max(20).default(10),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { countryId, q, limit } = query<{ countryId: number; q: string; limit: number }>(req);
    return ok(res, await searchPlaces(countryId, q, limit));
  }),
);

locationsAliasRouter.get(
  '/reverse-geocode',
  validate({
    query: z.object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { lat, lng } = query<{ lat: number; lng: number }>(req);
    return ok(res, await reverseGeocode(lat, lng));
  }),
);
