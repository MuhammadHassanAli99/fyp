import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { remember, cache, cacheKeys } from '../../config/cache';
import { toBoolean, toJson } from '../../db/sql';
import { contextOrDefaults } from '../../core/context';

/**
 * Runtime configuration and feature flags (§22 Admin Panel).
 *
 * Anything an operator might want to change without a deploy lives here:
 * listing limits, compare limits, support contacts, minimum app version.
 */
export async function getSetting<T>(key: string, fallback: T, scope = 'global'): Promise<T> {
  const value = await remember(`setting:${scope}:${key}`, 300, async () => {
    const row = await queryOne<Row>('SELECT setting_value FROM app_settings WHERE setting_key = ? AND scope = ?', [key, scope]);
    return row ? row.setting_value : null;
  });
  if (value === null || value === undefined) return fallback;
  return toJson<T>(value, fallback);
}

export async function setSetting(key: string, value: unknown, scope = 'global', isPublic = false): Promise<void> {
  await execute(
    `INSERT INTO app_settings (setting_key, setting_value, scope, is_public)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), is_public = VALUES(is_public)`,
    [key, JSON.stringify(value), scope, isPublic ? 1 : 0],
  );
  await cache.del(`setting:${scope}:${key}`);
  await cache.del(cacheKeys.publicSettings());
}

/** The subset of settings safe to hand to a client at bootstrap. */
export const getPublicSettings = () =>
  remember(cacheKeys.publicSettings(), 300, async () => {
    const rows = await queryRows<Row>('SELECT setting_key, setting_value FROM app_settings WHERE is_public = 1');
    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      settings[String(row.setting_key)] = toJson<unknown>(row.setting_value, null);
    }
    return settings;
  });

/* -------------------------------------------------------------------------- */
/* Feature flags                                                              */
/* -------------------------------------------------------------------------- */

interface FlagRow extends Row {
  code: string;
  is_enabled: number;
  rollout_percent: number;
  target_countries: unknown;
  target_platforms: unknown;
  min_app_version: string | null;
}

const loadFlags = () =>
  remember(cacheKeys.featureFlags(), 120, () =>
    queryRows<FlagRow>(
      'SELECT code, is_enabled, rollout_percent, target_countries, target_platforms, min_app_version FROM feature_flags',
    ),
  );

/**
 * Evaluates a flag for the current request.
 *
 * Percentage rollout is keyed off a stable hash of the user (or device) id so a
 * given user stays consistently inside or outside the rollout — a flag that
 * flickers between requests is worse than no flag.
 */
export async function isFeatureEnabled(code: string): Promise<boolean> {
  const flags = await loadFlags();
  const flag = flags.find((entry) => entry.code === code);
  if (!flag || !toBoolean(flag.is_enabled)) return false;

  const context = contextOrDefaults();

  const countries = toJson<string[] | null>(flag.target_countries, null);
  if (countries && countries.length > 0 && !countries.includes(context.countryCode)) return false;

  const platforms = toJson<string[] | null>(flag.target_platforms, null);
  if (platforms && platforms.length > 0 && !platforms.includes(context.platform)) return false;

  if (flag.min_app_version && context.appVersion && compareVersions(context.appVersion, flag.min_app_version) < 0) {
    return false;
  }

  const rollout = Number(flag.rollout_percent);
  if (rollout >= 100) return true;
  if (rollout <= 0) return false;

  const bucketKey = context.userId ? `u${context.userId}` : (context.deviceHash ?? context.requestId);
  return stableBucket(`${code}:${bucketKey}`) < rollout;
}

/** All flags resolved for this request, for the client bootstrap payload. */
export async function getEnabledFeatures(): Promise<Record<string, boolean>> {
  const flags = await loadFlags();
  const result: Record<string, boolean> = {};
  for (const flag of flags) {
    result[flag.code] = await isFeatureEnabled(flag.code);
  }
  return result;
}

/** FNV-1a, mapped to 0..99. Deterministic and fast — no crypto needed here. */
function stableBucket(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash) % 100;
}

export function compareVersions(a: string, b: string): number {
  const parse = (value: string) =>
    value
      .split(/[.+-]/)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}
