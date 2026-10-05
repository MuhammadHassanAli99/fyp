import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { uuid } from '../../core/security/crypto';
import { execute, insertAndGetId, queryOne, type Row } from '../../db/query';
import { emitToUser } from '../../realtime/socket';
import { bumpMetric } from './notifications.analytics';
import {
  hasInstantAlerts,
  invalidateUserNotificationCache,
  loadCategory,
  loadPreference,
  loadQuietHours,
  loadUserContext,
  resolveCopy,
} from './notifications.catalog';
import { resolveDeepLink } from './notifications.deeplink';
import { groupedFavoriteCopy } from './notifications.grouping';
import { buildIdempotencyKey } from './notifications.idempotency';
import { evaluatePolicy } from './notifications.policy';
import { enqueueNotificationJob } from './notifications.queue';
import { consumeNotificationRateLimit } from './notifications.rate-limit';
import {
  marketplaceFromGroup,
  toStoredPriority,
  type ActionType,
  type NotifyCommand,
  type NotificationChannel,
} from './notifications.types';

const log = loggerFor('notify.orchestrator');

export interface NotifyResult {
  notificationId: number | null;
  uuid: string | null;
  duplicate: boolean;
  channels: NotificationChannel[];
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stringifyData(data: Record<string, unknown>): string {
  return JSON.stringify(data);
}

async function claimInboxIdempotency(key: string, userId: number): Promise<boolean> {
  try {
    await execute(
      `INSERT INTO notification_idempotency (idempotency_key, user_id, channel)
       VALUES (?, ?, 'inbox')`,
      [key, userId],
    );
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ER_DUP_ENTRY' || code === 'CONFLICT') return false;
    log.debug({ err: error }, 'idempotency insert skipped');
    return true;
  }
}

async function mergeGrouped(params: {
  userId: number;
  groupKey: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}): Promise<{ id: number; uuid: string; itemCount: number } | null> {
  const existing = await queryOne<Row>(
    `SELECT id, uuid, item_count FROM notifications
      WHERE user_id = ? AND group_key = ? AND read_at IS NULL AND dismissed_at IS NULL
        AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 6 HOUR)
      ORDER BY id DESC
      LIMIT 1`,
    [params.userId, params.groupKey],
  );
  if (!existing) return null;
  const itemCount = Number(existing.item_count ?? 1) + 1;
  const copy = params.groupKey.startsWith('favorite.')
    ? groupedFavoriteCopy(itemCount)
    : { title: params.title, body: params.body };
  await execute(
    `UPDATE notifications
        SET title = ?, body = ?, data = ?, item_count = ?, created_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [copy.title, copy.body, stringifyData({ ...params.data, count: itemCount }), itemCount, Number(existing.id)],
  );
  return { id: Number(existing.id), uuid: String(existing.uuid), itemCount };
}

async function unreadCount(userId: number): Promise<number> {
  const row = await queryOne<Row>(
    `SELECT COUNT(*) AS n FROM notifications
      WHERE user_id = ? AND read_at IS NULL AND dismissed_at IS NULL
        AND is_silent = 0
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
    [userId],
  );
  return Number(row?.n ?? 0);
}

/**
 * Single NotificationService entry. HTTP callers must not await provider I/O —
 * in-app insert is local; push/email/sms are queued.
 */
export async function notifyUser(command: NotifyCommand): Promise<NotifyResult> {
  if (!command.userId || command.userId <= 0 || !command.categoryCode) {
    return { notificationId: null, uuid: null, duplicate: false, channels: [] };
  }

  try {
    const category = await loadCategory(command.categoryCode);
    if (!category) {
      log.debug({ category: command.categoryCode }, 'unknown notification category');
      return { notificationId: null, uuid: null, duplicate: false, channels: [] };
    }

    const user = await loadUserContext(command.userId);
    if (!user) return { notificationId: null, uuid: null, duplicate: false, channels: [] };

    const inboxKey = buildIdempotencyKey({
      eventId: command.eventId,
      userId: command.userId,
      categoryCode: command.categoryCode,
      channel: 'inbox',
      entityId: command.entityId ?? command.actionTarget,
    });
    const claimed = await claimInboxIdempotency(inboxKey, command.userId);
    if (!claimed) {
      return { notificationId: null, uuid: null, duplicate: true, channels: [] };
    }

    const [preference, quietHours, instant] = await Promise.all([
      loadPreference(command.userId, command.categoryCode),
      loadQuietHours(command.userId),
      hasInstantAlerts(command.userId),
    ]);

    const priority = toStoredPriority(command.priority ?? (category.policyGroup === 'SECURITY' ? 'urgent' : 'normal'));
    const marketplace = marketplaceFromGroup(category.groupCode, command.marketplace ?? category.marketplaceScope);
    const now = new Date();
    const decisions = evaluatePolicy({
      category,
      preference,
      quietHours,
      user,
      priority,
      now,
      isSilent: Boolean(command.isSilent),
      hasInstantAlerts: instant,
      skipChannels: command.skipChannels,
    });

    const variables: Record<string, unknown> = {
      appName: env.APP_NAME,
      ...command.data,
      ...command.variables,
    };

    const inAppDecision = decisions.find((item) => item.channel === 'in_app');
    const language = command.language ?? user.language;
    const inAppCopy = await resolveCopy({
      categoryCode: command.categoryCode,
      channel: 'in_app',
      language,
      variables,
      fallbackTitle: command.title,
      fallbackBody: command.body,
    });

    const deepLink = resolveDeepLink({
      deepLink: command.deepLink ?? inAppCopy.actionUrl,
      actionType: command.actionType,
      actionTarget: command.actionTarget,
      entityType: command.entityType,
      entityId: command.entityId,
    });

    const groupKey = command.groupKey ?? null;
    let notificationId: number | null = null;
    let notificationUuid: string | null = null;
    let grouped = false;

    if (groupKey && inAppDecision?.allowed) {
      const merged = await mergeGrouped({
        userId: command.userId,
        groupKey,
        title: inAppCopy.title,
        body: inAppCopy.body,
        data: (command.data ?? {}) as Record<string, unknown>,
      });
      if (merged) {
        grouped = true;
        notificationId = merged.id;
        notificationUuid = merged.uuid;
        emitToUser(command.userId, 'notification:updated', {
          uuid: merged.uuid,
          title: groupedFavoriteCopy(merged.itemCount).title,
          body: groupedFavoriteCopy(merged.itemCount).body,
          itemCount: merged.itemCount,
        });
      }
    }

    if (!grouped && inAppDecision?.allowed && !command.isSilent) {
      notificationUuid = uuid();
      notificationId = await insertAndGetId(
        `INSERT INTO notifications
           (uuid, user_id, category_code, marketplace, event_type, entity_type, entity_id,
            title, body, image_url, icon, action_type, action_target, deep_link, data, priority,
            is_silent, group_key, idempotency_key, template_id, template_version, expires_at, scheduled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          notificationUuid,
          command.userId,
          command.categoryCode,
          marketplace,
          command.eventType ?? command.categoryCode,
          command.entityType ?? command.actionType ?? null,
          command.entityId != null ? String(command.entityId) : command.actionTarget ?? null,
          inAppCopy.title.slice(0, 255),
          inAppCopy.body,
          command.imageUrl ?? null,
          command.icon ?? null,
          (command.actionType ?? deepLink.actionType) as ActionType,
          deepLink.actionTarget ?? command.actionTarget ?? null,
          deepLink.route,
          stringifyData(command.data ?? {}),
          priority,
          command.isSilent ? 1 : 0,
          groupKey,
          inboxKey,
          inAppCopy.templateId,
          inAppCopy.templateVersion,
          asDate(command.expiresAt),
          asDate(command.scheduledAt),
        ],
      );
      await execute(
        `INSERT INTO notification_deliveries (notification_id, channel, status, destination)
         VALUES (?, 'in_app', 'delivered', ?)`,
        [notificationId, `user:${command.userId}`],
      );
      await execute(
        `UPDATE notification_idempotency SET notification_id = ? WHERE idempotency_key = ?`,
        [notificationId, inboxKey],
      );
      const count = await unreadCount(command.userId);
      emitToUser(command.userId, 'notification:new', {
        uuid: notificationUuid,
        categoryCode: command.categoryCode,
        marketplace,
        title: inAppCopy.title,
        body: inAppCopy.body,
        deepLink: deepLink.route,
        priority,
        createdAt: new Date().toISOString(),
      });
      emitToUser(command.userId, 'notification:unread_count', { count });
      await invalidateUserNotificationCache(command.userId);
      await bumpMetric({ channel: 'in_app', categoryCode: command.categoryCode, created: 1, delivered: 1 });
    }

    const queued: NotificationChannel[] = [];
    for (const decision of decisions) {
      if (!decision.allowed) {
        if (decision.reason === 'digest_instead' && decision.channel === 'push') {
          await appendDigest(command, inAppCopy.title, inAppCopy.body);
        }
        continue;
      }
      if (decision.channel === 'in_app') continue;

      const rate = await consumeNotificationRateLimit({
        userId: command.userId,
        channel: decision.channel,
        policyGroup: category.policyGroup,
      });
      if (!rate.allowed) {
        log.debug({ userId: command.userId, channel: decision.channel }, 'channel rate-limited');
        continue;
      }

      const copy = await resolveCopy({
        categoryCode: command.categoryCode,
        channel: decision.channel === 'silent' ? 'push' : decision.channel,
        language,
        variables,
        fallbackTitle: inAppCopy.title,
        fallbackBody: inAppCopy.body,
      });

      const channelKey = buildIdempotencyKey({
        eventId: command.eventId ?? inboxKey,
        userId: command.userId,
        categoryCode: command.categoryCode,
        channel: decision.channel,
        entityId: command.entityId ?? command.actionTarget,
      });
      try {
        await execute(
          `INSERT INTO notification_idempotency (idempotency_key, notification_id, user_id, channel)
           VALUES (?, ?, ?, ?)`,
          [channelKey, notificationId, command.userId, decision.channel],
        );
      } catch {
        continue;
      }

      if (notificationId) {
        await execute(
          `INSERT INTO notification_deliveries
             (notification_id, channel, status, destination, idempotency_key)
           VALUES (?, ?, 'queued', ?, ?)`,
          [notificationId, decision.channel, destinationFor(decision.channel, user), channelKey],
        );
      }

      await enqueueNotificationJob({
        notificationId,
        userId: command.userId,
        channel: decision.channel,
        priority,
        availableAt: decision.delayUntil,
        payload: {
          categoryCode: command.categoryCode,
          title: copy.title,
          body: copy.body,
          subject: copy.subject,
          deepLink: deepLink.route,
          imageUrl: command.imageUrl ?? null,
          data: {
            categoryCode: command.categoryCode,
            marketplace,
            deepLink: deepLink.route,
            notificationUuid: notificationUuid ?? '',
            ...(command.data ?? {}),
          },
          collapseKey: groupKey,
          silent: command.isSilent || decision.channel === 'silent',
          email: user.email,
          phone: user.phoneE164,
          language: copy.language,
        },
      });
      queued.push(decision.channel);
      await bumpMetric({ channel: decision.channel, categoryCode: command.categoryCode, queued: 1 });
    }

    return { notificationId, uuid: notificationUuid, duplicate: false, channels: queued };
  } catch (error) {
    log.warn({ err: error, category: command.categoryCode, userId: command.userId }, 'notification dispatch skipped');
    return { notificationId: null, uuid: null, duplicate: false, channels: [] };
  }
}

function destinationFor(channel: NotificationChannel, user: { email: string | null; phoneE164: string | null }): string | null {
  if (channel === 'email') return user.email;
  if (channel === 'sms' || channel === 'whatsapp') return user.phoneE164;
  return null;
}

async function appendDigest(command: NotifyCommand, title: string, body: string): Promise<void> {
  try {
    const open = await queryOne<Row>(
      `SELECT id, payload, item_count FROM notification_digests
        WHERE user_id = ? AND category_code = ? AND sent_at IS NULL
        ORDER BY id DESC LIMIT 1`,
      [command.userId, command.categoryCode],
    );
    const item = { title, body, entityId: command.entityId ?? command.actionTarget ?? null, at: new Date().toISOString() };
    if (open) {
      let payload: unknown[] = [];
      try {
        const parsed = typeof open.payload === 'string' ? JSON.parse(String(open.payload)) : open.payload;
        if (Array.isArray(parsed)) payload = parsed;
      } catch {
        payload = [];
      }
      payload.push(item);
      await execute(
        `UPDATE notification_digests SET payload = ?, item_count = ? WHERE id = ?`,
        [JSON.stringify(payload.slice(-50)), payload.length, Number(open.id)],
      );
      return;
    }
    const tomorrow = new Date();
    tomorrow.setUTCHours(8, 0, 0, 0);
    if (tomorrow.getTime() <= Date.now()) tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    await execute(
      `INSERT INTO notification_digests (user_id, category_code, frequency, payload, item_count, scheduled_for)
       VALUES (?, ?, 'daily', ?, 1, ?)`,
      [command.userId, command.categoryCode, JSON.stringify([item]), tomorrow],
    );
  } catch (error) {
    log.debug({ err: error }, 'digest append skipped');
  }
}

export async function getUnreadCount(userId: number): Promise<number> {
  return unreadCount(userId);
}

export { notifyUser as NotificationService };
