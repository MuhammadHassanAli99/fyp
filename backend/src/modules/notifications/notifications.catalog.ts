import { cache, cacheKeys, remember } from '../../config/cache';
import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { toBoolean } from '../../db/sql';
import { env } from '../../config/env';
import { loadEntitlements } from '../../middleware/entitlements';
import type { CategoryPolicy, PreferenceOverride, QuietHoursConfig } from './notifications.policy';
import type { NotificationChannel, PolicyGroup, RenderedCopy, UserNotificationContext } from './notifications.types';
import { languageFallbackChain, parseTemplateVariables, renderTemplate } from './notifications.templates';
import { resolveTimeZone } from './notifications.timezone';

function asPolicyGroup(value: unknown): PolicyGroup {
  const raw = String(value ?? 'MARKETPLACE').toUpperCase();
  if (raw === 'SECURITY' || raw === 'TRANSACTIONAL' || raw === 'SOCIAL' || raw === 'MARKETING' || raw === 'SYSTEM') {
    return raw;
  }
  return 'MARKETPLACE';
}

export async function loadCategory(code: string): Promise<CategoryPolicy | null> {
  return remember(cacheKeys.notificationCategory(code), 300, async () => {
    const row = await queryOne<Row>(
      `SELECT code, group_code, policy_group, marketplace_scope, default_push, default_email, default_sms,
              default_in_app, is_transactional, is_active
         FROM notification_categories
        WHERE code = ?`,
      [code],
    );
    if (!row) return null;
    return {
      code: String(row.code),
      groupCode: (row.group_code as string | null) ?? null,
      policyGroup: asPolicyGroup(row.policy_group),
      marketplaceScope: String(row.marketplace_scope ?? 'GENERAL'),
      defaultPush: toBoolean(row.default_push),
      defaultEmail: toBoolean(row.default_email),
      defaultSms: toBoolean(row.default_sms),
      defaultInApp: toBoolean(row.default_in_app),
      isTransactional: toBoolean(row.is_transactional),
      isActive: toBoolean(row.is_active),
    };
  });
}

export async function loadUserContext(userId: number): Promise<UserNotificationContext | null> {
  const row = await queryOne<Row>(
    `SELECT id, email, phone_e164, language, timezone FROM users WHERE id = ? AND deleted_at IS NULL`,
    [userId],
  );
  if (!row) return null;
  const entitlements = await loadEntitlements(userId).catch(() => ({
    planCode: 'free',
    planTier: 0,
    features: {} as Record<string, { enabled: boolean }>,
  }));
  return {
    userId,
    language: String(row.language ?? env.DEFAULT_LANGUAGE ?? 'en'),
    timezone: resolveTimeZone((row.timezone as string | null) ?? env.DEFAULT_TIMEZONE),
    email: (row.email as string | null) ?? null,
    phoneE164: (row.phone_e164 as string | null) ?? null,
    planCode: entitlements.planCode,
    planTier: entitlements.planTier,
  };
}

export async function loadPreference(userId: number, categoryCode: string): Promise<PreferenceOverride | null> {
  const row = await queryOne<Row>(
    `SELECT push, email, sms, in_app, whatsapp
       FROM notification_preferences
      WHERE user_id = ? AND category_code = ?`,
    [userId, categoryCode],
  );
  if (!row) return null;
  return {
    push: toBoolean(row.push),
    email: toBoolean(row.email),
    sms: toBoolean(row.sms),
    inApp: toBoolean(row.in_app),
    whatsapp: toBoolean(row.whatsapp),
  };
}

export async function loadQuietHours(userId: number): Promise<QuietHoursConfig | null> {
  const row = await queryOne<Row>(
    `SELECT is_enabled, start_time, end_time, timezone, allow_urgent, days_of_week
       FROM notification_quiet_hours
      WHERE user_id = ?`,
    [userId],
  );
  if (!row) return null;
  let days: number[] | null = null;
  if (row.days_of_week) {
    try {
      const parsed = typeof row.days_of_week === 'string' ? JSON.parse(row.days_of_week) : row.days_of_week;
      if (Array.isArray(parsed)) days = parsed.map((item) => Number(item));
    } catch {
      days = null;
    }
  }
  return {
    isEnabled: toBoolean(row.is_enabled),
    startTime: row.start_time ? String(row.start_time).slice(0, 8) : null,
    endTime: row.end_time ? String(row.end_time).slice(0, 8) : null,
    timezone: (row.timezone as string | null) ?? null,
    allowUrgent: toBoolean(row.allow_urgent),
    daysOfWeek: days,
  };
}

export async function hasInstantAlerts(userId: number): Promise<boolean> {
  const entitlements = await loadEntitlements(userId).catch(() => null);
  const feature = entitlements?.features.instant_marketplace_alerts;
  if (!feature) return entitlements ? entitlements.planTier > 0 : false;
  return feature.enabled;
}

interface TemplateRow {
  id: number;
  version: number;
  subject: string | null;
  title: string | null;
  body: string;
  actionUrl: string | null;
  variables: string[] | null;
}

async function loadTemplateRow(
  categoryCode: string,
  channel: NotificationChannel,
  language: string,
): Promise<TemplateRow | null> {
  return remember(cacheKeys.notificationTemplate(categoryCode, channel, language), 300, async () => {
    const row = await queryOne<Row>(
      `SELECT id, version, subject, title, body, action_url, variables
         FROM notification_templates
        WHERE category_code = ? AND channel = ? AND language = ? AND is_active = 1
        ORDER BY version DESC
        LIMIT 1`,
      [categoryCode, channel, language],
    );
    if (!row) return null;
    return {
      id: Number(row.id),
      version: Number(row.version),
      subject: (row.subject as string | null) ?? null,
      title: (row.title as string | null) ?? null,
      body: String(row.body),
      actionUrl: (row.action_url as string | null) ?? null,
      variables: parseTemplateVariables(row.variables),
    };
  });
}

export async function resolveCopy(params: {
  categoryCode: string;
  channel: NotificationChannel;
  language: string;
  variables: Record<string, unknown>;
  fallbackTitle?: string;
  fallbackBody?: string;
}): Promise<RenderedCopy> {
  let row: TemplateRow | null = null;
  let usedLanguage = 'en';
  for (const lang of languageFallbackChain(params.language)) {
    row = await loadTemplateRow(params.categoryCode, params.channel, lang);
    if (row) {
      usedLanguage = lang;
      break;
    }
  }
  const titleSource = row?.title || params.fallbackTitle || params.categoryCode;
  const bodySource = row?.body || params.fallbackBody || '';
  const subjectSource = row?.subject || titleSource;
  return {
    subject: row?.subject ? renderTemplate(subjectSource, params.variables, row.variables) : subjectSource,
    title: renderTemplate(titleSource, params.variables, row?.variables),
    body: renderTemplate(bodySource, params.variables, row?.variables),
    actionUrl: row?.actionUrl ? renderTemplate(row.actionUrl, params.variables, row.variables) : null,
    templateId: row?.id ?? null,
    templateVersion: row?.version ?? null,
    language: usedLanguage,
  };
}

export async function invalidateUserNotificationCache(userId: number): Promise<void> {
  await cache.del(cacheKeys.notificationUnread(userId));
  await cache.del(cacheKeys.notificationPrefs(userId));
}
