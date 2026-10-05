import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../config/env';
import { remember, cacheKeys } from '../config/cache';
import { queryRows, queryOne } from '../db/query';
import { runWithContext, type RequestContext } from '../core/context';
import { uuid } from '../core/security/crypto';
import { clip } from '../core/strings';
import type { Row } from '../db/query';
import { validateGuestSession } from '../modules/auth/guest.service';

interface CountryRow extends Row {
  id: number;
  iso2: string;
  default_currency: string;
  default_language: string;
  default_timezone: string;
  measurement_system: 'metric' | 'imperial';
}

interface PlatformRow extends Row {
  id: number;
  code: string;
}

const loadCountries = () =>
  remember(cacheKeys.countries(), 3600, () =>
    queryRows<CountryRow>(
      `SELECT id, iso2, default_currency, default_language, default_timezone, measurement_system
         FROM countries WHERE is_active = 1`,
    ),
  );

const loadPlatforms = () =>
  remember('ref:platforms', 3600, () => queryRows<PlatformRow>('SELECT id, code FROM platforms WHERE is_active = 1'));

const loadSupported = () =>
  remember('ref:supported-locale', 3600, async () => {
    const [languages, currencies] = await Promise.all([
      queryRows<Row & { code: string }>('SELECT code FROM languages WHERE is_active = 1'),
      queryRows<Row & { code: string }>('SELECT code FROM currencies WHERE is_active = 1'),
    ]);
    return {
      languages: new Set(languages.map((row) => row.code)),
      currencies: new Set(currencies.map((row) => row.code)),
    };
  });

/** `en-GB,en;q=0.9,ar;q=0.8` → ['en-GB', 'en', 'ar'] */
function parseAcceptLanguage(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part) => {
      const [tag = '', qualityPart] = part.trim().split(';');
      const quality = qualityPart?.startsWith('q=') ? Number(qualityPart.slice(2)) : 1;
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.quality - a.quality)
    .map((entry) => entry.tag);
}

function pickLanguage(candidates: string[], supported: Set<string>): string | null {
  for (const candidate of candidates) {
    if (supported.has(candidate)) return candidate;
    const base = candidate.split('-')[0];
    if (base && supported.has(base)) return base;
  }
  return null;
}

function clientIp(req: Request): string | null {
  if (env.TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
    if (first) return first.trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? null;
}

/**
 * Resolves country / language / currency / timezone / platform for every request
 * and opens the AsyncLocalStorage scope that the rest of the stack reads from.
 *
 * Precedence is explicit-header → GeoIP hint → platform default. The
 * authenticated user's stored preference is layered on later by `authenticate`,
 * because it needs the database lookup that authentication already performs.
 */
export const requestContext: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    const requestId = (req.headers['x-request-id'] as string | undefined) ?? uuid();
    const [countries, platforms, supported] = await Promise.all([loadCountries(), loadPlatforms(), loadSupported()]);

    const requestedCountry = String(req.headers['x-country'] ?? req.query.country ?? env.DEFAULT_COUNTRY).toUpperCase();
    const ipCountryHint = String(req.headers['cf-ipcountry'] ?? req.headers['x-appengine-country'] ?? '')
      .toUpperCase()
      .slice(0, 2);
    const country =
      countries.find((row) => row.iso2 === requestedCountry) ??
      countries.find((row) => row.iso2 === ipCountryHint) ??
      countries.find((row) => row.iso2 === env.DEFAULT_COUNTRY) ??
      null;

    const requestedLanguage = req.headers['x-language'] as string | undefined;
    const language =
      (requestedLanguage && pickLanguage([requestedLanguage], supported.languages)) ??
      pickLanguage(parseAcceptLanguage(req.headers['accept-language']), supported.languages) ??
      country?.default_language ??
      env.DEFAULT_LANGUAGE;

    const requestedCurrency = String(req.headers['x-currency'] ?? '').toUpperCase();
    const currency =
      (requestedCurrency && supported.currencies.has(requestedCurrency) ? requestedCurrency : null) ??
      country?.default_currency ??
      env.BASE_CURRENCY;

    const platformCode = String(req.headers['x-platform'] ?? 'web').toLowerCase();
    const platform = platforms.find((row) => row.code.toLowerCase() === platformCode) ?? null;

    const rawInstallationId = clip(req.headers['x-device-id'] as string | undefined, 36);
    const rawTimezone = clip(req.headers['x-timezone'] as string | undefined, 64);
    const rawAppVersion = clip(req.headers['x-app-version'] as string | undefined, 24);

    const rawGuestId = (req.headers['x-guest-id'] as string | undefined) ?? null;
    const guest = rawGuestId ? await validateGuestSession(rawGuestId) : null;

    const context: RequestContext = {
      requestId,
      startedAt: Date.now(),
      userId: null,
      sessionId: null,
      guestUuid: guest?.uuid ?? null,
      roles: [],
      permissions: [],
      isStaff: false,
      countryId: country?.id ?? null,
      countryCode: country?.iso2 ?? env.DEFAULT_COUNTRY,
      language: clip(language, 10) ?? env.DEFAULT_LANGUAGE,
      currency: clip(currency, 3) ?? env.BASE_CURRENCY,
      timezone: rawTimezone ?? clip(country?.default_timezone, 64) ?? env.DEFAULT_TIMEZONE,
      measurementSystem: country?.measurement_system ?? 'metric',
      platformId: platform?.id ?? null,
      platform: platform?.code ?? platformCode,
      appVersion: rawAppVersion,
      deviceId: null,
      installationId: rawInstallationId,
      deviceHash: rawInstallationId,
      ip: clientIp(req),
      userAgent: clip(req.headers['user-agent'] as string | undefined, 512),
      marketplaceId: null,
      marketplaceCode: null,
      riskScore: 0,
      riskDecision: 'allow',
    };

    req.context = context;
    req.auth = null;
    req.guestUuid = context.guestUuid;
    req.valid = {};
    req.marketplaceId = null;
    req.marketplaceCode = null;
    req.device = {
      id: null,
      uuid: null,
      fingerprintHash: context.deviceHash,
      platformId: context.platformId,
      platform: context.platform,
      appVersion: context.appVersion,
      isRooted: req.headers['x-device-rooted'] === '1',
      isJailbroken: req.headers['x-device-jailbroken'] === '1',
      isEmulator: req.headers['x-device-emulator'] === '1',
      isDebugging: req.headers['x-device-debugging'] === '1',
      isAutomation: req.headers['x-device-automation'] === '1',
    };

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Resolved-Country', context.countryCode);
    res.setHeader('X-Resolved-Language', context.language);
    res.setHeader('X-Resolved-Currency', context.currency);

    runWithContext(context, () => next());
  })().catch(next);
};

interface MarketplaceRow extends Row {
  id: number;
  code: string;
  is_active: number;
}

/**
 * Binds a marketplace to the request from `:marketplace` in the path or the
 * `X-Marketplace` header, so module routers do not each re-resolve it.
 */
export const resolveMarketplace: RequestHandler = (req, _res, next) => {
  void (async () => {
    const raw = (req.params.marketplace ??
      req.params.marketplaceId ??
      req.headers['x-marketplace'] ??
      req.query.marketplace ??
      req.query.marketplaceId) as string | undefined;
    if (!raw) return next();

    const marketplace = await remember(`ref:marketplace:${raw}`, 900, () =>
      queryOne<MarketplaceRow>('SELECT id, code, is_active FROM marketplaces WHERE code = ? OR id = ?', [raw, Number(raw) || 0]),
    );

    if (marketplace && marketplace.is_active === 1) {
      req.marketplaceId = marketplace.id;
      req.marketplaceCode = marketplace.code;
      req.context.marketplaceId = marketplace.id;
      req.context.marketplaceCode = marketplace.code;
    }
    next();
  })().catch(next);
};
