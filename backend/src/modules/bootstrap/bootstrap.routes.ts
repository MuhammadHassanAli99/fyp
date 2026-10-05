import { Router } from 'express';
import { asyncHandler } from '../../core/http/async-handler';
import { ok, withCache } from '../../core/http/response';
import { authenticate } from '../../middleware/authenticate';
import { queryRows, type Row } from '../../db/query';
import { env } from '../../config/env';
import { listMarketplaces } from '../catalog/catalog.service';
import { getEnabledFeatures, getPublicSettings } from '../locale/settings.service';
import { inspectSchema, API_VERSION, REQUIRED_SCHEMA_VERSION } from '../../core/schema-compatibility';
import { listCountries } from '../locale/locale.routes';
import { GUEST_RESTRICTIONS } from '../locale/guest-restrictions';
import { getConfigVersions } from '../locale/config-versions';

export const bootstrapRouter = Router();

/**
 * Cold-start payload (§1 Before Login). Bundles everything the client needs to
 * render the first screen without a dozen round trips.
 */
bootstrapRouter.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const { countryId, language, currency, timezone, measurementSystem } = req.context;

    const [marketplaces, features, settings, plans, legalVersions, countries, schema, versions] = await Promise.all([
      listMarketplaces(countryId, language),
      getEnabledFeatures(),
      getPublicSettings(),
      loadPlansSummary(countryId, currency),
      loadLegalVersions(countryId, language),
      listCountries(true),
      inspectSchema(),
      getConfigVersions(),
    ]);

    const country = countries.find((entry) => entry.id === countryId) ?? null;

    withCache(res, 120);
    return ok(res, {
      app: {
        name: env.APP_NAME,
        apiPrefix: env.API_PREFIX,
        apiVersion: API_VERSION,
        baseCurrency: env.BASE_CURRENCY,
        minAppVersion: (settings['app.min_supported_version'] as string | undefined) ?? (settings.minAppVersion as string | undefined) ?? null,
        forceUpdateBelow: (settings['app.force_update_below'] as string | undefined) ?? null,
        schemaVersion: schema.appliedVersion,
        requiredSchemaVersion: REQUIRED_SCHEMA_VERSION,
        schemaCompatible: schema.compatible,
      },
      marketplaces,
      taxonomyVersions: Object.fromEntries(marketplaces.map((mp) => [mp.code, mp.taxonomyVersion])),
      features,
      settings,
      plans: plans,
      legal: legalVersions,
      versions,
      locale: {
        countryId,
        country: country
          ? { id: country.id, iso2: country.iso2, name: country.name, flagEmoji: country.flagEmoji }
          : null,
        language,
        currency,
        timezone,
        measurementSystem,
      },
      guestRestrictions: GUEST_RESTRICTIONS,
    });
  }),
);

async function loadPlansSummary(countryId: number | null, currency: string) {
  const rows = await queryRows<Row>(
    `SELECT p.id, p.code, p.name, p.description, p.tier, p.audience, p.trial_days, p.badge_code,
            pp.amount, pp.currency, pp.billing_interval, pp.original_amount
       FROM subscription_plans p
       LEFT JOIN plan_prices pp
         ON pp.plan_id = p.id AND pp.is_active = 1
        AND (pp.country_id = ? OR pp.country_id IS NULL)
        AND pp.currency = ?
      WHERE p.is_active = 1 AND p.is_public = 1
      ORDER BY p.sort_order, p.tier`,
    [countryId, currency],
  );

  const byCode = new Map<string, ReturnType<typeof mapPlan>>();
  for (const row of rows) {
    const code = String(row.code);
    if (!byCode.has(code)) {
      byCode.set(code, mapPlan(row));
    }
  }
  return [...byCode.values()];
}

const mapPlan = (row: Row) => ({
  code: String(row.code),
  name: String(row.name),
  description: (row.description as string | null) ?? null,
  tier: Number(row.tier),
  audience: String(row.audience),
  trialDays: Number(row.trial_days),
  badgeCode: (row.badge_code as string | null) ?? null,
  price:
    row.amount === null || row.amount === undefined
      ? null
      : {
          amount: Number(row.amount),
          originalAmount: row.original_amount === null ? null : Number(row.original_amount),
          currency: String(row.currency ?? ''),
          interval: String(row.billing_interval ?? 'monthly'),
        },
});

async function loadLegalVersions(countryId: number | null, language: string) {
  const kinds = ['terms', 'privacy', 'cookies', 'listing_policy'] as const;
  const versions: Record<string, { version: string; language: string; countryId: number | null } | null> = {};

  await Promise.all(
    kinds.map(async (kind) => {
      const row = await queryRows<Row>(
        `SELECT kind, country_id, language, version, is_current
           FROM legal_documents
          WHERE kind = ? AND is_current = 1
            AND (country_id = ? OR country_id IS NULL)
          ORDER BY (country_id = ?) DESC, (language = ?) DESC, published_at DESC
          LIMIT 1`,
        [kind, countryId, countryId, language],
      );
      const doc = row[0];
      versions[kind] = doc
        ? {
            version: String(doc.version),
            language: String(doc.language),
            countryId: doc.country_id === null ? null : Number(doc.country_id),
          }
        : null;
    }),
  );

  return versions;
}
