import { remember } from '../../config/cache';
import { getConfigVersions } from './config-versions';
import { listUnits } from './units.service';
import { getAddressRules } from './address.service';
import { getPhoneRules } from './phone.service';
import { listActiveTaxRules } from '../billing/tax.service';
import { getRegulations } from './regulations.service';
import { listLegalDocuments } from './legal.service';
import { queryOne, queryRows, type Row } from '../../db/query';
import { toBoolean, toNumber } from '../../db/sql';
import { notFound } from '../../core/errors';

/**
 * Localization pipeline payload. Country detection + manual override happen
 * on the client; this endpoint is the single bundle the Flutter UI consumes
 * after a country is known. Units/tax/holidays/regulations/legal stay lazy
 * via dedicated routes — this returns the compact session config.
 */

export async function getLocalizationSession(params: {
  countryId: number;
  language: string;
  currency: string;
  timezone: string;
  includeHeavy?: boolean;
}) {
  const heavy = params.includeHeavy === true;
  const cacheKey = `ref:l10n-session:${params.countryId}:${params.language}:${params.currency}:${heavy ? 'full' : 'lite'}`;

  return remember(cacheKey, 120, async () => {
    const country = await loadCountry(params.countryId);
    if (!country) throw notFound('Country');
    const versions = await getConfigVersions();
    const [address, phone, units] = await Promise.all([
      getAddressRules(params.countryId),
      getPhoneRules(params.countryId),
      listUnits(),
    ]);

    const heavyPayload = heavy
      ? {
          taxRules: await listActiveTaxRules(params.countryId),
          holidays: await listHolidays(params.countryId),
          regulations: await getRegulations(params.countryId),
          legal: await listLegalDocuments(params.countryId, params.language),
        }
      : {
          taxRules: undefined,
          holidays: undefined,
          regulations: undefined,
          legal: undefined,
        };

    return {
      versions,
      country,
      language: params.language,
      currency: params.currency,
      timezone: params.timezone || country.defaultTimezone,
      units: {
        system: country.measurementSystem,
        area: country.areaUnit,
        weight: country.weightUnit,
        distance: country.distanceUnit,
        goldWeight: country.goldWeightUnit,
        catalog: units,
      },
      address,
      phone,
      dateTime: {
        dateFormat: country.dateFormat,
        timeFormat: country.timeFormat,
        firstDayOfWeek: country.firstDayOfWeek,
        timezone: params.timezone || country.defaultTimezone,
      },
      ...heavyPayload,
    };
  });
}

async function loadCountry(countryId: number) {
  const row = await queryOne<Row>(
    `SELECT id, iso2, iso3, name, native_name, dial_code, flag_emoji, default_currency, default_language,
            default_timezone, measurement_system, area_unit, weight_unit, distance_unit, gold_weight_unit,
            date_format, time_format, first_day_of_week, vat_rate, requires_kyc, requires_aml, is_active
       FROM countries WHERE id = ?`,
    [countryId],
  );
  if (!row) return null;
  return {
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
  };
}

async function listHolidays(countryId: number) {
  const year = new Date().getUTCFullYear();
  const rows = await queryRows<Row>(
    `SELECT name, holiday_date, is_recurring
       FROM holidays
      WHERE country_id = ? AND (is_recurring = 1 OR YEAR(holiday_date) = ?)
      ORDER BY MONTH(holiday_date), DAY(holiday_date)`,
    [countryId, year],
  );
  return rows.map((row) => {
    const date = row.holiday_date as Date;
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return {
      name: String(row.name),
      date: toBoolean(row.is_recurring) ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10),
      isRecurring: toBoolean(row.is_recurring),
    };
  });
}
