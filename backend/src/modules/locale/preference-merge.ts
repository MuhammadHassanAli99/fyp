/**
 * Deterministic preference merge for guest → authenticated (§1 / §20).
 *
 * Precedence (first non-null wins):
 *   1. Explicit authenticated-user preference
 *   2. Guest / local preference
 *   3. Country default
 *   4. Application default
 *
 * A NULL on the user row means "never chosen", not "reset to empty".
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type MeasurementSystem = 'metric' | 'imperial';
export type LocationSource = 'manual' | 'gps' | 'ip' | 'profile' | 'listing' | 'device';

export interface PreferenceSnapshot {
  countryId: number | null;
  language: string | null;
  currency: string | null;
  timezone: string | null;
  theme: ThemeMode | null;
  measurementSystem: MeasurementSystem | null;
  regionId: number | null;
  cityId: number | null;
  areaId: number | null;
  postalCode: string | null;
  locationSource: LocationSource | null;
}

export const APP_DEFAULT_PREFERENCES: PreferenceSnapshot = {
  countryId: null,
  language: 'en',
  currency: 'USD',
  timezone: 'UTC',
  theme: 'system',
  measurementSystem: 'metric',
  regionId: null,
  cityId: null,
  areaId: null,
  postalCode: null,
  locationSource: null,
};

function firstDefined<T>(...candidates: Array<T | null | undefined>): T | null {
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && candidate !== '') {
      return candidate;
    }
  }
  return null;
}

export function mergePreferences(params: {
  authenticated: PreferenceSnapshot;
  local: PreferenceSnapshot;
  countryDefault?: Partial<PreferenceSnapshot> | null;
  appDefault?: PreferenceSnapshot;
}): PreferenceSnapshot {
  const country = params.countryDefault ?? {};
  const app = params.appDefault ?? APP_DEFAULT_PREFERENCES;
  const auth = params.authenticated;
  const local = params.local;

  return {
    countryId: firstDefined(auth.countryId, local.countryId, country.countryId, app.countryId),
    language: firstDefined(auth.language, local.language, country.language, app.language),
    currency: firstDefined(auth.currency, local.currency, country.currency, app.currency),
    timezone: firstDefined(auth.timezone, local.timezone, country.timezone, app.timezone),
    theme: firstDefined(auth.theme, local.theme, country.theme, app.theme),
    measurementSystem: firstDefined(
      auth.measurementSystem,
      local.measurementSystem,
      country.measurementSystem,
      app.measurementSystem,
    ),
    regionId: firstDefined(auth.regionId, local.regionId, country.regionId, app.regionId),
    cityId: firstDefined(auth.cityId, local.cityId, country.cityId, app.cityId),
    areaId: firstDefined(auth.areaId, local.areaId, country.areaId, app.areaId),
    postalCode: firstDefined(auth.postalCode, local.postalCode, country.postalCode, app.postalCode),
    locationSource: firstDefined(
      auth.locationSource,
      local.locationSource,
      country.locationSource,
      app.locationSource,
    ),
  };
}

export function emptyPreferences(): PreferenceSnapshot {
  return {
    countryId: null,
    language: null,
    currency: null,
    timezone: null,
    theme: null,
    measurementSystem: null,
    regionId: null,
    cityId: null,
    areaId: null,
    postalCode: null,
    locationSource: null,
  };
}
