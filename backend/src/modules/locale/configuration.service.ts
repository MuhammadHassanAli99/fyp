import { queryRows, type Row } from '../../db/query';
import { remember } from '../../config/cache';
import { env } from '../../config/env';
import { getPublicSettings, getEnabledFeatures } from './settings.service';
import { listCountries, listLanguages } from './locale.routes';
import { listCurrencies } from './fx.service';
import { listMarketplaces } from '../catalog/catalog.service';
import { GUEST_RESTRICTIONS } from './guest-restrictions';
import { inspectSchema, API_VERSION, REQUIRED_SCHEMA_VERSION } from '../../core/schema-compatibility';
import { getConfigVersions } from './config-versions';

export async function getConfiguration(countryId: number | null, language: string) {
  return remember(`ref:configuration:${countryId ?? 'none'}:${language}`, 60, async () => {
    const [versions, settings, features, countries, languages, currencies, marketplaces, schema] =
      await Promise.all([
        getConfigVersions(),
        getPublicSettings(),
        getEnabledFeatures(),
        listCountries(true),
        listLanguages(),
        listCurrencies(),
        listMarketplaces(countryId, language),
        inspectSchema(),
      ]);

    const rtlLanguages = languages.filter((entry) => entry.direction === 'rtl').map((entry) => entry.code);

    return {
      versions,
      app: {
        name: env.APP_NAME,
        apiPrefix: env.API_PREFIX,
        apiVersion: API_VERSION,
        baseCurrency: env.BASE_CURRENCY,
        defaultCountry: env.DEFAULT_COUNTRY,
        defaultLanguage: env.DEFAULT_LANGUAGE,
        defaultTimezone: env.DEFAULT_TIMEZONE,
        minAppVersion:
          (settings['app.min_supported_version'] as string | undefined) ??
          (settings.minAppVersion as string | undefined) ??
          null,
        forceUpdateBelow: (settings['app.force_update_below'] as string | undefined) ?? null,
        schemaVersion: schema.appliedVersion,
        requiredSchemaVersion: REQUIRED_SCHEMA_VERSION,
        schemaCompatible: schema.compatible,
      },
      supportedCountryCodes: countries.map((country) => country.iso2),
      supportedLanguageCodes: languages.map((entry) => entry.code),
      supportedCurrencyCodes: currencies.map((entry) => entry.code),
      rtlLanguages,
      marketplaces: marketplaces.map((mp) => ({
        code: mp.code,
        isActive: mp.isActive,
        isComingSoon: mp.isComingSoon,
      })),
      features,
      guestRestrictions: GUEST_RESTRICTIONS,
    };
  });
}

export async function marketplaceAvailability(countryId: number | null) {
  if (!countryId) {
    const rows = await queryRows<Row>('SELECT code, is_active FROM marketplaces ORDER BY sort_order');
    return rows.map((row) => ({
      code: String(row.code),
      isActive: Number(row.is_active) === 1,
      launched: Number(row.is_active) === 1,
    }));
  }

  const rows = await queryRows<Row>(
    `SELECT m.code, m.is_active,
            COALESCE(mc.is_active, 1) AS launched
       FROM marketplaces m
       LEFT JOIN marketplace_countries mc
         ON mc.marketplace_id = m.id AND mc.country_id = ?
      ORDER BY m.sort_order`,
    [countryId],
  );

  return rows.map((row) => ({
    code: String(row.code),
    isActive: Number(row.is_active) === 1,
    launched: Number(row.launched) === 1,
  }));
}
