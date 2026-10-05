import { execute, queryOne, type Row } from '../../db/query';
import type { Executor } from '../../db/pool';
import { env } from '../../config/env';
import { remember } from '../../config/cache';
import { mergePreferences, emptyPreferences, type PreferenceSnapshot } from '../locale/preference-merge';

export async function validateGuestSession(guestUuid: string | null): Promise<{
  uuid: string;
  countryId: number | null;
  language: string | null;
  currency: string | null;
} | null> {
  if (!guestUuid || guestUuid.length < 8) return null;

  return remember(`guest:session:${guestUuid}`, 60, async () => {
    const row = await queryOne<Row>(
      `SELECT uuid, country_id, language, currency, expires_at, converted_user_id
         FROM guest_sessions WHERE uuid = ? LIMIT 1`,
      [guestUuid],
    );
    if (!row) return null;
    if (row.converted_user_id) return null;
    const expiresAt = row.expires_at ? new Date(row.expires_at as Date).getTime() : 0;
    if (expiresAt > 0 && expiresAt < Date.now()) return null;
    return {
      uuid: String(row.uuid),
      countryId: row.country_id === null ? null : Number(row.country_id),
      language: (row.language as string | null) ?? null,
      currency: (row.currency as string | null) ?? null,
    };
  });
}

export async function touchGuestSession(guestUuid: string): Promise<void> {
  await execute('UPDATE guest_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE uuid = ?', [guestUuid]).catch(
    () => undefined,
  );
}

/**
 * Marks the guest row converted and fills any NULL user preference columns from
 * the guest session. Explicit user values are never overwritten.
 */
export async function convertGuestSession(
  guestUuid: string | null,
  userId: number,
  executor?: Executor,
): Promise<void> {
  if (!guestUuid) return;

  const guest = await queryOne<Row>(
    `SELECT country_id, language, currency, theme, measurement_system, region_id, city_id, area_id,
            converted_user_id
       FROM guest_sessions WHERE uuid = ? LIMIT 1`,
    [guestUuid],
    executor,
  );
  if (!guest || guest.converted_user_id) return;

  await execute(
    `UPDATE guest_sessions
        SET converted_user_id = ?, converted_at = CURRENT_TIMESTAMP
      WHERE uuid = ? AND converted_user_id IS NULL`,
    [userId, guestUuid],
    executor,
  );

  const user = await queryOne<Row>(
    `SELECT country_id, language, currency, timezone, theme, measurement_system,
            region_id, city_id, area_id
       FROM users WHERE id = ?`,
    [userId],
    executor,
  );
  if (!user) return;

  const authenticated: PreferenceSnapshot = {
    countryId: user.country_id === null ? null : Number(user.country_id),
    language: (user.language as string | null) ?? null,
    currency: (user.currency as string | null) ?? null,
    timezone: (user.timezone as string | null) ?? null,
    theme: (user.theme as PreferenceSnapshot['theme']) ?? null,
    measurementSystem: (user.measurement_system as PreferenceSnapshot['measurementSystem']) ?? null,
    regionId: user.region_id === null ? null : Number(user.region_id),
    cityId: user.city_id === null ? null : Number(user.city_id),
    areaId: user.area_id === null ? null : Number(user.area_id),
    postalCode: null,
    locationSource: null,
  };

  const local: PreferenceSnapshot = {
    ...emptyPreferences(),
    countryId: guest.country_id === null ? null : Number(guest.country_id),
    language: (guest.language as string | null) ?? null,
    currency: (guest.currency as string | null) ?? null,
    theme: (guest.theme as PreferenceSnapshot['theme']) ?? null,
    measurementSystem: (guest.measurement_system as PreferenceSnapshot['measurementSystem']) ?? null,
    regionId: guest.region_id === null ? null : Number(guest.region_id),
    cityId: guest.city_id === null ? null : Number(guest.city_id),
    areaId: guest.area_id === null ? null : Number(guest.area_id),
  };

  const merged = mergePreferences({ authenticated, local });

  await execute(
    `UPDATE users
        SET country_id = COALESCE(country_id, ?),
            language = COALESCE(language, ?),
            currency = COALESCE(currency, ?),
            timezone = COALESCE(timezone, ?),
            theme = COALESCE(theme, ?),
            measurement_system = COALESCE(measurement_system, ?),
            region_id = COALESCE(region_id, ?),
            city_id = COALESCE(city_id, ?),
            area_id = COALESCE(area_id, ?)
      WHERE id = ?`,
    [
      merged.countryId,
      merged.language,
      merged.currency,
      merged.timezone,
      merged.theme,
      merged.measurementSystem,
      merged.regionId,
      merged.cityId,
      merged.areaId,
      userId,
    ],
    executor,
  );
}

export const guestTtlExpiry = (): Date => new Date(Date.now() + env.GUEST_SESSION_TTL_DAYS * 86_400_000);
