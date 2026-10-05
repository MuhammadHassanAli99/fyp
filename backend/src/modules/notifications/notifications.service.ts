import { execute, queryCount, queryOne, queryRows, type Row } from '../../db/query';
import { notFound } from '../../core/errors';
import { toBoolean } from '../../db/sql';
import { cache, cacheKeys } from '../../config/cache';
import { emitToUser } from '../../realtime/socket';
import { bumpMetric } from './notifications.analytics';
import { invalidateUserNotificationCache } from './notifications.catalog';
import { INBOX_FILTERS, type InboxFilter, type NotificationMarketplace } from './notifications.types';

const FILTER_SQL: Record<InboxFilter, string> = {
  all: '1=1',
  unread: 'n.read_at IS NULL',
  gold: "n.marketplace = 'GOLD'",
  property: "n.marketplace = 'PROPERTY'",
  vehicles: "n.marketplace = 'VEHICLE'",
  messages: "n.category_code LIKE 'chat.%'",
  security: "n.category_code LIKE 'security.%' OR n.category_code LIKE 'account.password%' OR nc.policy_group = 'SECURITY'",
  payments: "n.category_code LIKE 'payment.%' OR n.category_code LIKE 'subscription.%' OR n.action_type = 'payment'",
  system: "n.marketplace = 'GENERAL' AND n.category_code LIKE 'system.%'",
};

function isInboxFilter(value: string): value is InboxFilter {
  return (INBOX_FILTERS as readonly string[]).includes(value);
}

export function mapNotification(row: Row) {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    categoryCode: String(row.category_code),
    marketplace: String(row.marketplace ?? 'GENERAL') as NotificationMarketplace,
    eventType: (row.event_type as string | null) ?? String(row.category_code),
    entityType: (row.entity_type as string | null) ?? null,
    entityId: (row.entity_id as string | null) ?? null,
    title: String(row.title),
    body: (row.body as string | null) ?? null,
    imageUrl: (row.image_url as string | null) ?? null,
    icon: (row.icon as string | null) ?? null,
    actionType: String(row.action_type),
    actionTarget: (row.action_target as string | null) ?? null,
    deepLink: (row.deep_link as string | null) ?? null,
    priority: String(row.priority),
    isSilent: toBoolean(row.is_silent),
    groupKey: (row.group_key as string | null) ?? null,
    itemCount: Number(row.item_count ?? 1),
    readAt: row.read_at ? new Date(row.read_at as Date).toISOString() : null,
    createdAt: new Date(row.created_at as Date).toISOString(),
    expiresAt: row.expires_at ? new Date(row.expires_at as Date).toISOString() : null,
  };
}

export async function listNotifications(
  userId: number,
  params: { page?: number; perPage?: number; filter?: string; unreadOnly?: boolean },
) {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(1, params.perPage ?? 30));
  const filter = isInboxFilter(params.filter ?? 'all') ? (params.filter as InboxFilter) : 'all';
  const where = [
    'n.user_id = ?',
    'n.dismissed_at IS NULL',
    'n.is_silent = 0',
    '(n.expires_at IS NULL OR n.expires_at > CURRENT_TIMESTAMP)',
  ];
  const values: unknown[] = [userId];
  if (params.unreadOnly || filter === 'unread') where.push('n.read_at IS NULL');
  if (filter !== 'all' && filter !== 'unread') where.push(`(${FILTER_SQL[filter]})`);

  const whereSql = where.join(' AND ');
  const total = await queryCount(
    `SELECT COUNT(*) FROM notifications n
       LEFT JOIN notification_categories nc ON nc.code = n.category_code
      WHERE ${whereSql}`,
    values,
  );
  const rows = await queryRows<Row>(
    `SELECT n.id, n.uuid, n.category_code, n.marketplace, n.event_type, n.entity_type, n.entity_id,
            n.title, n.body, n.image_url, n.icon, n.action_type, n.action_target, n.deep_link,
            n.priority, n.is_silent, n.group_key, n.item_count, n.read_at, n.created_at, n.expires_at
       FROM notifications n
       LEFT JOIN notification_categories nc ON nc.code = n.category_code
      WHERE ${whereSql}
      ORDER BY n.created_at DESC
      LIMIT ? OFFSET ?`,
    [...values, perPage, (page - 1) * perPage],
  );

  return {
    items: rows.map(mapNotification),
    total,
    page,
    perPage,
  };
}

export async function getNotification(userId: number, notificationUuid: string) {
  const row = await queryOne<Row>(
    `SELECT n.id, n.uuid, n.category_code, n.marketplace, n.event_type, n.entity_type, n.entity_id,
            n.title, n.body, n.image_url, n.icon, n.action_type, n.action_target, n.deep_link,
            n.priority, n.is_silent, n.group_key, n.item_count, n.read_at, n.created_at, n.expires_at
       FROM notifications n
      WHERE n.uuid = ? AND n.user_id = ? AND n.dismissed_at IS NULL`,
    [notificationUuid, userId],
  );
  if (!row) throw notFound('Notification');
  return mapNotification(row);
}

export async function unreadCount(userId: number): Promise<number> {
  const cached = await cache.get<number>(cacheKeys.notificationUnread(userId));
  if (cached != null) return cached;
  const count = await queryCount(
    `SELECT COUNT(*) FROM notifications
      WHERE user_id = ? AND read_at IS NULL AND dismissed_at IS NULL AND is_silent = 0
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
    [userId],
  );
  await cache.set(cacheKeys.notificationUnread(userId), count, 15);
  return count;
}

async function emitUnread(userId: number): Promise<number> {
  await invalidateUserNotificationCache(userId);
  const count = await unreadCount(userId);
  emitToUser(userId, 'notification:unread_count', { count });
  return count;
}

export async function markRead(userId: number, notificationUuid: string) {
  const result = await execute(
    `UPDATE notifications
        SET read_at = CURRENT_TIMESTAMP
      WHERE uuid = ? AND user_id = ? AND read_at IS NULL AND dismissed_at IS NULL`,
    [notificationUuid, userId],
  );
  if (result.affectedRows > 0) {
    await bumpMetric({ channel: 'in_app', read: 1 });
    emitToUser(userId, 'notification:read', { uuid: notificationUuid });
  }
  const count = await emitUnread(userId);
  return { marked: result.affectedRows > 0, unreadCount: count };
}

export async function markUnread(userId: number, notificationUuid: string) {
  const result = await execute(
    `UPDATE notifications SET read_at = NULL
      WHERE uuid = ? AND user_id = ? AND dismissed_at IS NULL`,
    [notificationUuid, userId],
  );
  const count = await emitUnread(userId);
  if (result.affectedRows > 0) {
    emitToUser(userId, 'notification:updated', { uuid: notificationUuid, readAt: null });
  }
  return { marked: result.affectedRows > 0, unreadCount: count };
}

export async function markAllRead(userId: number) {
  const result = await execute(
    `UPDATE notifications SET read_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND read_at IS NULL AND dismissed_at IS NULL AND is_silent = 0`,
    [userId],
  );
  if (result.affectedRows > 0) await bumpMetric({ channel: 'in_app', read: result.affectedRows });
  const count = await emitUnread(userId);
  emitToUser(userId, 'notification:read', { all: true });
  return { marked: result.affectedRows, unreadCount: count };
}

export async function hideNotification(userId: number, notificationUuid: string) {
  const result = await execute(
    `UPDATE notifications SET dismissed_at = CURRENT_TIMESTAMP
      WHERE uuid = ? AND user_id = ? AND dismissed_at IS NULL`,
    [notificationUuid, userId],
  );
  const count = await emitUnread(userId);
  return { hidden: result.affectedRows > 0, unreadCount: count };
}

export async function getPreferences(userId: number) {
  const categories = await queryRows<Row>(
    `SELECT code, name, group_code, policy_group, marketplace_scope,
            default_push, default_email, default_sms, default_in_app, is_transactional
       FROM notification_categories
      WHERE is_active = 1
      ORDER BY sort_order, code`,
  );
  const prefs = await queryRows<Row>(
    `SELECT category_code, push, email, sms, in_app, whatsapp
       FROM notification_preferences WHERE user_id = ?`,
    [userId],
  );
  const byCode = new Map(prefs.map((row) => [String(row.category_code), row]));
  const quiet = await queryOne<Row>(
    `SELECT is_enabled, start_time, end_time, timezone, allow_urgent, days_of_week
       FROM notification_quiet_hours WHERE user_id = ?`,
    [userId],
  );

  return {
    quietHours: quiet
      ? {
          enabled: toBoolean(quiet.is_enabled),
          startTime: quiet.start_time ? String(quiet.start_time).slice(0, 8) : null,
          endTime: quiet.end_time ? String(quiet.end_time).slice(0, 8) : null,
          timezone: (quiet.timezone as string | null) ?? null,
          allowUrgent: toBoolean(quiet.allow_urgent),
          daysOfWeek: (() => {
            try {
              if (!quiet.days_of_week) return null;
              const parsed =
                typeof quiet.days_of_week === 'string' ? JSON.parse(String(quiet.days_of_week)) : quiet.days_of_week;
              return Array.isArray(parsed) ? parsed.map((item) => Number(item)) : null;
            } catch {
              return null;
            }
          })(),
        }
      : {
          enabled: false,
          startTime: '23:00:00',
          endTime: '07:00:00',
          timezone: null,
          allowUrgent: true,
          daysOfWeek: null,
        },
    categories: categories.map((row) => {
      const override = byCode.get(String(row.code));
      const locked = toBoolean(row.is_transactional) || String(row.policy_group) === 'SECURITY';
      return {
        categoryCode: String(row.code),
        name: String(row.name),
        groupCode: (row.group_code as string | null) ?? null,
        policyGroup: String(row.policy_group ?? 'MARKETPLACE'),
        marketplace: String(row.marketplace_scope ?? 'GENERAL'),
        locked,
        pushEnabled: override ? toBoolean(override.push) : toBoolean(row.default_push),
        emailEnabled: override ? toBoolean(override.email) : toBoolean(row.default_email),
        smsEnabled: override ? toBoolean(override.sms) : toBoolean(row.default_sms),
        inAppEnabled: override ? toBoolean(override.in_app) : toBoolean(row.default_in_app),
      };
    }),
  };
}

export async function updatePreference(
  userId: number,
  categoryCode: string,
  input: { pushEnabled?: boolean; emailEnabled?: boolean; smsEnabled?: boolean; inAppEnabled?: boolean },
) {
  const category = await queryOne<Row>(
    'SELECT code, is_transactional, policy_group FROM notification_categories WHERE code = ? AND is_active = 1',
    [categoryCode],
  );
  if (!category) throw notFound('Notification category');

  const locked = toBoolean(category.is_transactional) || String(category.policy_group) === 'SECURITY';
  const push = locked ? 1 : input.pushEnabled === undefined ? 1 : input.pushEnabled ? 1 : 0;
  const email = locked ? 1 : input.emailEnabled === undefined ? 0 : input.emailEnabled ? 1 : 0;
  const sms = locked ? (String(category.policy_group) === 'SECURITY' ? 1 : 0) : input.smsEnabled === undefined ? 0 : input.smsEnabled ? 1 : 0;
  const inApp = input.inAppEnabled === undefined ? 1 : input.inAppEnabled ? 1 : 0;

  await execute(
    `INSERT INTO notification_preferences (user_id, category_code, push, email, sms, in_app)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       push = VALUES(push),
       email = VALUES(email),
       sms = VALUES(sms),
       in_app = VALUES(in_app)`,
    [userId, categoryCode, push, email, sms, inApp],
  );
  await invalidateUserNotificationCache(userId);
  return getPreferences(userId);
}

export async function updateQuietHours(
  userId: number,
  input: {
    enabled?: boolean;
    startTime?: string | null;
    endTime?: string | null;
    timezone?: string | null;
    allowUrgent?: boolean;
    daysOfWeek?: number[] | null;
  },
) {
  await execute(
    `INSERT INTO notification_quiet_hours (user_id, is_enabled, start_time, end_time, timezone, allow_urgent, days_of_week)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       is_enabled = VALUES(is_enabled),
       start_time = VALUES(start_time),
       end_time = VALUES(end_time),
       timezone = VALUES(timezone),
       allow_urgent = VALUES(allow_urgent),
       days_of_week = VALUES(days_of_week)`,
    [
      userId,
      input.enabled === false ? 0 : 1,
      input.startTime ?? '23:00:00',
      input.endTime ?? '07:00:00',
      input.timezone ?? null,
      input.allowUrgent === false ? 0 : 1,
      input.daysOfWeek ? JSON.stringify(input.daysOfWeek) : null,
    ],
  );
  return getPreferences(userId);
}

export async function listScheduled(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT uuid, category_code, channel, scheduled_for, status, timezone, expires_at, priority
       FROM scheduled_notifications
      WHERE user_id = ? AND status IN ('scheduled','processing')
      ORDER BY scheduled_for
      LIMIT 50`,
    [userId],
  );
  return rows.map((row) => ({
    uuid: String(row.uuid),
    categoryCode: String(row.category_code),
    channel: String(row.channel),
    scheduledFor: new Date(row.scheduled_for as Date).toISOString(),
    status: String(row.status),
    timezone: (row.timezone as string | null) ?? null,
    expiresAt: row.expires_at ? new Date(row.expires_at as Date).toISOString() : null,
    priority: String(row.priority ?? 'normal'),
  }));
}

export async function cancelScheduled(userId: number, scheduledUuid: string) {
  const result = await execute(
    `UPDATE scheduled_notifications
        SET status = 'cancelled'
      WHERE uuid = ? AND user_id = ? AND status = 'scheduled'`,
    [scheduledUuid, userId],
  );
  return { cancelled: result.affectedRows > 0 };
}

export async function registerPushToken(
  userId: number,
  deviceId: number | null,
  input: { token: string; provider?: 'fcm' | 'apns' | 'webpush' },
) {
  if (!deviceId) return { registered: false };
  const provider = input.provider ?? 'fcm';
  await execute(
    `UPDATE user_devices
        SET push_token = ?, push_provider = ?, push_enabled = 1, last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?`,
    [input.token.slice(0, 512), provider, deviceId, userId],
  );
  return { registered: true };
}
