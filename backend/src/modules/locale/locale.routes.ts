import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { ok, withCache } from '../../core/http/response';
import { validate, body, params, query } from '../../middleware/validate';
import { badRequest, notFound } from '../../core/errors';
import { queryOne, queryRows, type Row } from '../../db/query';
import { toBoolean, toJson, toNumber, where } from '../../db/sql';
import { remember } from '../../config/cache';
import { sha256 } from '../../core/security/crypto';
import { env } from '../../config/env';
import { convertAmount, getRate, listCurrencies } from './fx.service';
import { isRateStale } from './config-versions';
import { convertMeasurement } from './units.service';
import { getAddressRules, validateAddress } from './address.service';
import { normalizePhone, formatNational, getPhoneRules } from './phone.service';
import { formatInTimezone } from './datetime.service';
import { quoteTax, listActiveTaxRules } from '../billing/tax.service';
import { getRegulations } from './regulations.service';
import { acceptLegalDocument, listLegalDocuments, parseLegalKind } from './legal.service';
import { getLocalizationSession } from './localization.service';
import { authenticate, requireAuth } from '../../middleware/authenticate';

export const localeRouter = Router();

/**
 * Localisation reference data (§1 Before Login, §28 Localization).
 *
 * Everything here is read on almost every screen and changes at most weekly, so
 * each endpoint is cached server-side and ETagged for the client. The bootstrap
 * endpoint bundles the common subset; these routes exist for the pickers that
 * need the full list (country selector, language selector, currency selector).
 */

/** Strong ETag over the serialised payload — reference data has no other version. */
const etagFor = (value: unknown): string => `"${sha256(JSON.stringify(value))}"`;

const HOUR = 3600;

/** Sends `data` with cache headers, or a bodyless 304 when the client is current. */
function cached(req: Request, res: Response, seconds: number, data: unknown): Response {
  const etag = etagFor(data);
  withCache(res, seconds, etag);
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  return ok(res, data);
}

/* -------------------------------------------------------------------------- */
/* Countries                                                                  */
/* -------------------------------------------------------------------------- */

const mapCountry = (row: Row) => ({
  id: Number(row.id),
  iso2: String(row.iso2),
  iso3: String(row.iso3),
  name: String(row.name),
  nativeName: (row.native_name as string | null) ?? null,
  dialCode: String(row.dial_code),
  flagEmoji: (row.flag_emoji as string | null) ?? null,
  defaultCurrency: String(row.default_currency),
  defaultLanguage: String(row.default_language),
  defaultTimezone: String(row.default_timezone),
  measurementSystem: String(row.measurement_system) as 'metric' | 'imperial',
  areaUnit: String(row.area_unit),
  weightUnit: String(row.weight_unit),
  distanceUnit: String(row.distance_unit),
  goldWeightUnit: String(row.gold_weight_unit),
  dateFormat: String(row.date_format),
  timeFormat: String(row.time_format),
  firstDayOfWeek: Number(row.first_day_of_week),
  vatRate: toNumber(row.vat_rate) ?? 0,
  requiresKyc: toBoolean(row.requires_kyc),
  requiresAml: toBoolean(row.requires_aml),
  isActive: toBoolean(row.is_active),
});

export type CountrySummary = ReturnType<typeof mapCountry>;

const COUNTRY_COLUMNS = `
  id, iso2, iso3, name, native_name, dial_code, flag_emoji, default_currency, default_language,
  default_timezone, measurement_system, area_unit, weight_unit, distance_unit, gold_weight_unit,
  date_format, time_format, first_day_of_week, vat_rate, requires_kyc, requires_aml, is_active, sort_order
`;

export const listCountries = (activeOnly: boolean) =>
  remember(`ref:countries:full:${activeOnly ? 'active' : 'all'}`, HOUR, async () => {
    const rows = await queryRows<Row>(
      `SELECT ${COUNTRY_COLUMNS} FROM countries
        ${activeOnly ? 'WHERE is_active = 1' : ''}
        ORDER BY sort_order, name`,
    );
    return rows.map(mapCountry);
  });

localeRouter.get(
  '/countries',
  validate({
    query: z.object({
      search: z.string().trim().max(96).optional(),
      active: z.coerce.boolean().default(true),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { search, active } = query<{ search?: string; active: boolean }>(req);
    const countries = await listCountries(active);

    // Filtering in memory: the whole list is ~200 rows and already cached, so a
    // per-keystroke query would be pure waste.
    const needle = search?.toLowerCase();
    const filtered = needle
      ? countries.filter(
          (country) =>
            country.name.toLowerCase().includes(needle) ||
            country.nativeName?.toLowerCase().includes(needle) === true ||
            country.iso2.toLowerCase() === needle ||
            country.iso3.toLowerCase() === needle ||
            country.dialCode.replace('+', '').startsWith(needle.replace('+', '')),
        )
      : countries;

    return cached(req, res, HOUR, filtered);
  }),
);

/** One country with everything a form needs: units, formats, tax, phone shape. */
localeRouter.get(
  '/countries/:iso2',
  validate({ params: z.object({ iso2: z.string().trim().min(2).max(3) }) }),
  asyncHandler(async (req, res) => {
    const { iso2 } = params<{ iso2: string }>(req);
    const code = iso2.toUpperCase();

    const payload = await remember(`ref:country:detail:${code}`, HOUR, async () => {
      const row = await queryOne<Row>(
        `SELECT ${COUNTRY_COLUMNS}, address_format, phone_format, postal_code_regex
           FROM countries WHERE iso2 = ? OR iso3 = ?`,
        [code, code],
      );
      if (!row) return null;

      const countryId = Number(row.id);
      const [languages, currencies, taxRules, units] = await Promise.all([
        queryRows<Row>(
          `SELECT l.code, l.name, l.native_name, l.direction, cl.is_primary
             FROM country_languages cl
             JOIN languages l ON l.code = cl.language
            WHERE cl.country_id = ? AND l.is_active = 1
            ORDER BY cl.is_primary DESC, l.sort_order, l.code`,
          [countryId],
        ),
        queryRows<Row>(
          `SELECT c.code, c.name, c.symbol, c.symbol_position, c.decimal_digits
             FROM country_currencies cc
             JOIN currencies c ON c.code = cc.currency
            WHERE cc.country_id = ? AND c.is_active = 1
            ORDER BY c.code`,
          [countryId],
        ),
        queryRows<Row>(
          `SELECT code, name, kind, rate, applies_to, is_inclusive, effective_from, effective_to
             FROM tax_rules
            WHERE country_id = ? AND is_active = 1
              AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
              AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
            ORDER BY kind, code`,
          [countryId],
        ),
        queryRows<Row>(
          `SELECT code, dimension, name, symbol, to_base_factor
             FROM measurement_units WHERE is_active = 1 ORDER BY dimension, code`,
        ),
      ]);

      const country = mapCountry(row);
      return {
        ...country,
        addressFormat: toJson<string[] | Record<string, unknown> | null>(row.address_format, null),
        phoneFormat: (row.phone_format as string | null) ?? null,
        postalCodeRegex: (row.postal_code_regex as string | null) ?? null,
        languages: languages.map((language) => ({
          code: String(language.code),
          name: String(language.name),
          nativeName: String(language.native_name),
          direction: String(language.direction) as 'ltr' | 'rtl',
          isPrimary: toBoolean(language.is_primary),
        })),
        currencies: currencies.map((currency) => ({
          code: String(currency.code),
          name: String(currency.name),
          symbol: String(currency.symbol),
          symbolPosition: String(currency.symbol_position) as 'prefix' | 'suffix',
          decimalDigits: Number(currency.decimal_digits),
        })),
        taxRules: taxRules.map((rule) => ({
          code: String(rule.code),
          name: String(rule.name),
          kind: String(rule.kind),
          rate: toNumber(rule.rate) ?? 0,
          appliesTo: String(rule.applies_to),
          isInclusive: toBoolean(rule.is_inclusive),
          effectiveFrom: rule.effective_from ? (rule.effective_from as Date).toISOString().slice(0, 10) : null,
          effectiveUntil: rule.effective_to ? (rule.effective_to as Date).toISOString().slice(0, 10) : null,
        })),
        units: {
          area: units.filter((unit) => unit.dimension === 'area').map(mapUnit),
          weight: units.filter((unit) => unit.dimension === 'weight').map(mapUnit),
          distance: units.filter((unit) => unit.dimension === 'distance').map(mapUnit),
        },
      };
    });

    if (!payload) throw notFound('Country');
    return cached(req, res, HOUR, payload);
  }),
);

const mapUnit = (row: Row) => ({
  code: String(row.code),
  dimension: String(row.dimension),
  name: String(row.name),
  symbol: String(row.symbol),
  toBaseFactor: toNumber(row.to_base_factor) ?? 1,
});

/* -------------------------------------------------------------------------- */
/* Languages, currencies, units                                               */
/* -------------------------------------------------------------------------- */

export const listLanguages = () =>
  remember('ref:languages:full', HOUR, async () => {
    const rows = await queryRows<Row>(
      `SELECT code, name, native_name, direction, is_default, sort_order
         FROM languages WHERE is_active = 1 ORDER BY sort_order, code`,
    );
    return rows.map((row) => ({
      code: String(row.code),
      name: String(row.name),
      nativeName: String(row.native_name),
      // The client flips its whole layout on this, so it ships with the list
      // rather than being inferred from the code (§1 Support RTL languages).
      direction: String(row.direction) as 'ltr' | 'rtl',
      isDefault: toBoolean(row.is_default),
    }));
  });

localeRouter.get(
  '/languages',
  asyncHandler(async (req, res) => cached(req, res, HOUR, await listLanguages())),
);

localeRouter.get(
  '/currencies',
  asyncHandler(async (req, res) => cached(req, res, HOUR, await listCurrencies())),
);

localeRouter.get(
  '/units',
  validate({ query: z.object({ dimension: z.enum(['area', 'weight', 'distance', 'volume']).optional() }) }),
  asyncHandler(async (req, res) => {
    const { dimension } = query<{ dimension?: 'area' | 'weight' | 'distance' | 'volume' }>(req);
    const units = await remember(`ref:units:${dimension ?? 'all'}`, HOUR, async () => {
      const builder = where();
      builder.bool('is_active', true);
      builder.eq('dimension', dimension ?? null);
      const { sql, params: whereParams } = builder.build();
      const rows = await queryRows<Row>(
        `SELECT code, dimension, name, symbol, to_base_factor FROM measurement_units
          ${sql} ORDER BY dimension, to_base_factor`,
        whereParams,
      );
      return rows.map(mapUnit);
    });
    return cached(req, res, HOUR, units);
  }),
);

/* -------------------------------------------------------------------------- */
/* Money (§1 Currency conversion / Live exchange rate)                        */
/* -------------------------------------------------------------------------- */

localeRouter.get(
  '/exchange-rates',
  validate({
    query: z.object({
      base: z.string().length(3).toUpperCase().optional(),
      quote: z.string().length(3).toUpperCase().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { base, quote } = query<{ base?: string; quote?: string }>(req);
    const baseCurrency = base ?? env.BASE_CURRENCY;

    if (quote) {
      const rate = await getRate(baseCurrency, quote);
      if (!rate) throw notFound(`Exchange rate ${baseCurrency}/${quote}`);
      return ok(res, {
        base: baseCurrency,
        quote,
        rate: rate.rate,
        asOf: rate.asOf,
        stale: rate.stale,
        provider: null,
      });
    }

    const rows = await queryRows<Row>(
      `SELECT base_currency, quote_currency, rate, provider, fetched_at
         FROM exchange_rates WHERE base_currency = ? ORDER BY quote_currency`,
      [baseCurrency],
    );

    // asOf is the freshest fetch in the set: the client shows "rates as of X",
    // and quoting the oldest row would understate accuracy.
    const asOf = rows.reduce<string | null>((newest, row) => {
      const fetchedAt = (row.fetched_at as Date).toISOString();
      return newest === null || fetchedAt > newest ? fetchedAt : newest;
    }, null);

    // Short TTL: these move, and a stale conversion shown next to a price is a
    // support ticket.
    return cached(req, res, 300, {
      base: baseCurrency,
      asOf,
      stale: isRateStale(asOf),
      rates: Object.fromEntries(rows.map((row) => [String(row.quote_currency), toNumber(row.rate) ?? 0])),
      provider: rows[0] ? String(rows[0].provider) : null,
    });
  }),
);

localeRouter.post(
  '/convert',
  validate({
    body: z.object({
      amount: z.coerce.number().min(0),
      from: z.string().length(3).toUpperCase(),
      to: z.string().length(3).toUpperCase(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ amount: number; from: string; to: string }>(req);
    const converted = await convertAmount(input.amount, input.from, input.to);
    if (!converted) {
      throw badRequest(`No exchange rate is available for ${input.from} to ${input.to}`);
    }
    return ok(res, { original: { amount: input.amount, currency: input.from }, converted });
  }),
);

/* -------------------------------------------------------------------------- */
/* UI string bundle (§22 Language Management)                                 */
/* -------------------------------------------------------------------------- */

/**
 * The admin-managed translation catalogue, delivered as a flat key→value bundle
 * per namespace. This is what lets a copy fix ship without an app release; the
 * ETag is how the client avoids re-downloading a bundle it already has.
 */
localeRouter.get(
  '/translations/:language',
  validate({
    params: z.object({ language: z.string().trim().min(2).max(10) }),
    query: z.object({ namespace: z.string().trim().max(64).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const { language } = params<{ language: string }>(req);
    const { namespace } = query<{ namespace?: string }>(req);

    const bundle = await remember(`ref:translations:${language}:${namespace ?? 'all'}`, HOUR, async () => {
      const builder = where();
      builder.eq('language', language);
      builder.eq('namespace', namespace ?? null);
      const { sql, params: whereParams } = builder.build();

      const rows = await queryRows<Row>(
        `SELECT namespace, trans_key, value, is_machine, updated_at FROM translations ${sql}`,
        whereParams,
      );

      const namespaces: Record<string, Record<string, string>> = {};
      let updatedAt: string | null = null;
      for (const row of rows) {
        const key = String(row.namespace);
        const entries = namespaces[key] ?? {};
        entries[String(row.trans_key)] = String(row.value);
        namespaces[key] = entries;
        const rowUpdatedAt = (row.updated_at as Date).toISOString();
        if (updatedAt === null || rowUpdatedAt > updatedAt) updatedAt = rowUpdatedAt;
      }

      return { language, namespaces, keyCount: rows.length, updatedAt };
    });

    // An unknown language is not a 404: the client falls back to its bundled
    // English copy, and failing the request would blank the whole UI.
    return cached(req, res, HOUR, bundle);
  }),
);

/* -------------------------------------------------------------------------- */
/* Legal + calendar (§28)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Resolution order is country+language → country+any language → global+language
 * → global. A market without translated terms still gets enforceable terms.
 */
localeRouter.get(
  '/legal/:kind',
  validate({
    params: z.object({
      kind: z.enum(['terms', 'privacy', 'cookies', 'refund', 'listing_policy', 'aml', 'dsa', 'eula']),
    }),
    query: z.object({ language: z.string().trim().max(10).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const { kind } = params<{ kind: string }>(req);
    const { language } = query<{ language?: string }>(req);
    const resolvedLanguage = language ?? req.context.language;
    const countryId = req.context.countryId;

    const row = await queryOne<Row>(
      `SELECT id, kind, country_id, language, version, title, body, published_at
         FROM legal_documents
        WHERE kind = ? AND is_current = 1
          AND (country_id = ? OR country_id IS NULL)
        ORDER BY (country_id = ?) DESC, (language = ?) DESC, published_at DESC
        LIMIT 1`,
      [kind, countryId, countryId, resolvedLanguage],
    );

    if (!row) throw notFound(`Legal document "${kind}"`);

    return cached(req, res, HOUR, {
      kind: String(row.kind),
      countryId: row.country_id === null ? null : Number(row.country_id),
      language: String(row.language),
      version: String(row.version),
      title: String(row.title),
      body: String(row.body),
      publishedAt: row.published_at ? (row.published_at as Date).toISOString() : null,
    });
  }),
);

localeRouter.get(
  '/holidays',
  validate({ query: z.object({ year: z.coerce.number().int().min(1970).max(2999).optional() }) }),
  asyncHandler(async (req, res) => {
    const { year } = query<{ year?: number }>(req);
    const targetYear = year ?? new Date().getUTCFullYear();
    const countryId = req.context.countryId;

    // is_recurring rows carry an arbitrary year, so they are matched on
    // month/day and re-projected onto the requested year.
    const rows = await queryRows<Row>(
      `SELECT name, holiday_date, is_recurring
         FROM holidays
        WHERE country_id = ? AND (is_recurring = 1 OR YEAR(holiday_date) = ?)
        ORDER BY MONTH(holiday_date), DAY(holiday_date)`,
      [countryId, targetYear],
    );

    return cached(
      req,
      res,
      HOUR * 24,
      rows.map((row) => {
        const date = row.holiday_date as Date;
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return {
          name: String(row.name),
          date: toBoolean(row.is_recurring)
            ? `${targetYear}-${month}-${day}`
            : date.toISOString().slice(0, 10),
          isRecurring: toBoolean(row.is_recurring),
        };
      }),
    );
  }),
);

/**
 * Timezones actually in use, with the current offset resolved through Intl so
 * the client does not need its own tz database to render "GMT+05:00".
 */
localeRouter.get(
  '/timezones',
  asyncHandler(async (req, res) => {
    const zones = await remember('ref:timezones', HOUR, async () => {
      const rows = await queryRows<Row>(
        `SELECT DISTINCT tz FROM (
           SELECT default_timezone AS tz FROM countries WHERE is_active = 1
           UNION
           SELECT timezone AS tz FROM cities WHERE timezone IS NOT NULL AND is_active = 1
         ) t WHERE tz IS NOT NULL ORDER BY tz`,
      );
      return rows
        .map((row) => String(row.tz))
        .map((timezone) => ({ timezone, ...offsetOf(timezone) }))
        .filter((entry) => entry.utcOffset !== null);
    });
    return cached(req, res, HOUR, zones);
  }),
);

/** `Asia/Karachi` → `{ utcOffset: '+05:00', utcOffsetMinutes: 300 }`. */
function offsetOf(timezone: string): { utcOffset: string | null; utcOffsetMinutes: number | null } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(
      new Date(),
    );
    const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    const match = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(name);
    if (!match) return { utcOffset: '+00:00', utcOffsetMinutes: 0 };
    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2] ?? 0);
    const minutes = Number(match[3] ?? 0);
    const totalMinutes = sign * (hours * 60 + minutes);
    return {
      utcOffset: `${sign < 0 ? '-' : '+'}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
      utcOffsetMinutes: totalMinutes,
    };
  } catch {
    // An unknown IANA name is data rot, not a request failure; drop the row.
    return { utcOffset: null, utcOffsetMinutes: null };
  }
}

/* -------------------------------------------------------------------------- */
/* Localization session, units, address, phone, tax, regulations              */
/* -------------------------------------------------------------------------- */

localeRouter.get(
  '/session',
  validate({
    query: z.object({
      full: z.coerce.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const countryId = req.context.countryId;
    if (!countryId) throw badRequest('Country is required');
    const { full } = query<{ full?: boolean }>(req);
    const payload = await getLocalizationSession({
      countryId,
      language: req.context.language,
      currency: req.context.currency,
      timezone: req.context.timezone,
      includeHeavy: full === true,
    });
    return cached(req, res, 120, payload);
  }),
);

localeRouter.post(
  '/units/convert',
  validate({
    body: z.object({
      value: z.coerce.number(),
      from: z.string().trim().min(1).max(24),
      to: z.string().trim().min(1).max(24),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ value: number; from: string; to: string }>(req);
    return ok(res, await convertMeasurement(input.value, input.from, input.to));
  }),
);

localeRouter.get(
  '/address-rules',
  asyncHandler(async (req, res) => {
    const countryId = req.context.countryId;
    if (!countryId) throw badRequest('Country is required');
    return cached(req, res, HOUR, await getAddressRules(countryId));
  }),
);

localeRouter.post(
  '/address/validate',
  validate({
    body: z.object({
      street: z.string().trim().max(191).optional(),
      addressLine1: z.string().trim().max(191).optional(),
      addressLine2: z.string().trim().max(191).optional(),
      building: z.string().trim().max(64).optional(),
      unit: z.string().trim().max(64).optional(),
      district: z.string().trim().max(96).optional(),
      area: z.string().trim().max(96).optional(),
      city: z.string().trim().max(96).optional(),
      province: z.string().trim().max(96).optional(),
      state: z.string().trim().max(96).optional(),
      region: z.string().trim().max(96).optional(),
      postalCode: z.string().trim().max(32).optional(),
      country: z.string().trim().max(8).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const countryId = req.context.countryId;
    if (!countryId) throw badRequest('Country is required');
    return ok(res, await validateAddress(countryId, body(req)));
  }),
);

localeRouter.get(
  '/phone-rules',
  asyncHandler(async (req, res) => {
    const countryId = req.context.countryId;
    if (!countryId) throw badRequest('Country is required');
    return cached(req, res, HOUR, await getPhoneRules(countryId));
  }),
);

localeRouter.post(
  '/phone/normalize',
  validate({
    body: z.object({
      number: z.string().trim().min(4).max(32),
      iso2: z.string().trim().length(2).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ number: string; iso2?: string }>(req);
    const parts = await normalizePhone({
      countryId: req.context.countryId ?? undefined,
      iso2: input.iso2 ?? req.context.countryCode,
      number: input.number,
    });
    return ok(res, {
      ...parts,
      nationalFormatted: formatNational(parts.nationalNumber, (await getPhoneRules(parts.countryId)).phoneFormat),
    });
  }),
);

localeRouter.get(
  '/datetime',
  validate({
    query: z.object({
      utc: z.string().trim().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { utc } = query<{ utc?: string }>(req);
    return ok(
      res,
      formatInTimezone({
        utc: utc ?? new Date().toISOString(),
        timezone: req.context.timezone,
      }),
    );
  }),
);

localeRouter.get(
  '/tax-rules',
  asyncHandler(async (req, res) => {
    const countryId = req.context.countryId;
    if (!countryId) throw badRequest('Country is required');
    return cached(req, res, HOUR, await listActiveTaxRules(countryId));
  }),
);

localeRouter.post(
  '/tax/quote',
  validate({
    body: z.object({
      amount: z.coerce.number().min(0),
      appliesTo: z.enum(['subscription', 'promotion', 'advertisement', 'commission', 'all']).optional(),
      marketplace: z.enum(['gold', 'property', 'vehicles']).optional(),
      productType: z.string().trim().max(64).optional(),
      currency: z.string().length(3).toUpperCase().optional(),
      regionId: z.coerce.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const countryId = req.context.countryId;
    if (!countryId) throw badRequest('Country is required');
    const input = body<{
      amount: number;
      appliesTo?: 'subscription' | 'promotion' | 'advertisement' | 'commission' | 'all';
      marketplace?: 'gold' | 'property' | 'vehicles';
      productType?: string;
      currency?: string;
      regionId?: number;
    }>(req);
    return ok(
      res,
      await quoteTax({
        countryId,
        amount: input.amount,
        appliesTo: input.appliesTo,
        marketplace: input.marketplace,
        productType: input.productType,
        currency: input.currency ?? req.context.currency,
        regionId: input.regionId,
      }),
    );
  }),
);

localeRouter.get(
  '/regulations',
  validate({
    query: z.object({
      marketplace: z.enum(['gold', 'property', 'vehicles']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const countryId = req.context.countryId;
    if (!countryId) throw badRequest('Country is required');
    const { marketplace } = query<{ marketplace?: 'gold' | 'property' | 'vehicles' }>(req);
    return cached(req, res, 300, await getRegulations(countryId, marketplace));
  }),
);

localeRouter.get(
  '/legal',
  asyncHandler(async (req, res) => {
    return cached(
      req,
      res,
      HOUR,
      await listLegalDocuments(req.context.countryId, req.context.language),
    );
  }),
);

localeRouter.post(
  '/legal/:kind/accept',
  authenticate,
  requireAuth,
  validate({
    params: z.object({
      kind: z.enum(['terms', 'privacy', 'cookies', 'refund', 'listing_policy', 'aml', 'dsa', 'eula']),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { kind } = params<{ kind: string }>(req);
    return ok(
      res,
      await acceptLegalDocument({
        userId: req.auth!.userId,
        kind: parseLegalKind(kind),
        countryId: req.context.countryId,
        language: req.context.language,
      }),
    );
  }),
);

