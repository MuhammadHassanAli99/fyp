import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { execute, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { messaging } from '../../providers/messaging';
import { bumpMetric } from './notifications.analytics';
import { notifyUser } from './notifications.orchestrator';
import { backoffSeconds, claimNotificationJobs, isPermanentProviderError } from './notifications.queue';

const log = loggerFor('notify.jobs');

function parsePayload(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

async function markDelivery(
  notificationId: number | null,
  channel: string,
  status: string,
  extra: { provider?: string; messageId?: string | null; error?: string | null; errorCode?: string | null },
): Promise<void> {
  if (!notificationId) return;
  try {
    await execute(
      `UPDATE notification_deliveries
          SET status = ?,
              provider = COALESCE(?, provider),
              provider_message_id = COALESCE(?, provider_message_id),
              error_code = COALESCE(?, error_code),
              error_message = COALESCE(?, error_message),
              attempts = attempts + 1,
              sent_at = CASE WHEN ? IN ('sent','delivered') THEN COALESCE(sent_at, CURRENT_TIMESTAMP) ELSE sent_at END,
              delivered_at = CASE WHEN ? = 'delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END
        WHERE notification_id = ? AND channel = ?
        LIMIT 1`,
      [
        status,
        extra.provider ?? null,
        extra.messageId ?? null,
        extra.errorCode ?? null,
        extra.error ? extra.error.slice(0, 500) : null,
        status,
        status,
        notificationId,
        channel,
      ],
    );
  } catch (error) {
    log.debug({ err: error }, 'delivery update skipped');
  }
}

async function deactivateTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  const placeholders = tokens.map(() => '?').join(',');
  await execute(
    `UPDATE user_devices
        SET push_token = NULL, push_provider = 'none', push_enabled = 0
      WHERE push_token IN (${placeholders})`,
    tokens,
  );
}

async function activePushTargets(userId: number): Promise<Array<{ token: string; deviceId: number }>> {
  const rows = await queryRows<Row>(
    `SELECT id, push_token FROM user_devices
      WHERE user_id = ?
        AND push_token IS NOT NULL
        AND push_token <> ''
        AND push_provider <> 'none'
        AND push_enabled = 1
        AND status = 'active'`,
    [userId],
  );
  return rows
    .map((row) => ({ token: String(row.push_token), deviceId: Number(row.id) }))
    .filter((row) => row.token.length > 0);
}

async function failJob(job: Row, errorCode: string, reason: string, permanent: boolean): Promise<void> {
  const attempts = Number(job.attempts ?? 0) + 1;
  const maxAttempts = Number(job.max_attempts ?? env.NOTIFICATION_MAX_ATTEMPTS);
  const notificationId = job.notification_id ? Number(job.notification_id) : null;
  const channel = String(job.channel);

  if (permanent || attempts >= maxAttempts) {
    await execute(
      `UPDATE notification_jobs SET status = 'failed', last_error = ?, error_code = ?, attempts = ? WHERE id = ?`,
      [reason.slice(0, 500), errorCode.slice(0, 64), attempts, Number(job.id)],
    );
    await execute(
      `INSERT INTO notification_dead_letters (job_id, notification_id, user_id, channel, error_code, reason, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [Number(job.id), notificationId, Number(job.user_id), channel, errorCode, reason.slice(0, 500), job.payload ?? null],
    );
    await markDelivery(notificationId, channel, 'failed', { error: reason, errorCode });
    await bumpMetric({ channel, failed: 1 });
    return;
  }

  const delay = backoffSeconds(attempts);
  await execute(
    `UPDATE notification_jobs
        SET status = 'retrying',
            attempts = ?,
            last_error = ?,
            error_code = ?,
            available_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND),
            locked_at = NULL
      WHERE id = ?`,
    [attempts, reason.slice(0, 500), errorCode.slice(0, 64), delay, Number(job.id)],
  );
  await markDelivery(notificationId, channel, 'retrying', { error: reason, errorCode });
  await bumpMetric({ channel, retried: 1 });
}

async function completeJob(job: Row, provider: string, messageId: string | null, delivered: boolean): Promise<void> {
  await execute(
    `UPDATE notification_jobs SET status = 'sent', attempts = attempts + 1, last_error = NULL WHERE id = ?`,
    [Number(job.id)],
  );
  const channel = String(job.channel);
  const notificationId = job.notification_id ? Number(job.notification_id) : null;
  await markDelivery(notificationId, channel, delivered ? 'delivered' : 'sent', { provider, messageId });
  await bumpMetric({ channel, sent: 1, delivered: delivered ? 1 : 0 });
}

async function processJob(job: Row): Promise<void> {
  const started = Date.now();
  const channel = String(job.channel);
  const userId = Number(job.user_id);
  const payload = parsePayload(job.payload);
  const title = String(payload.title ?? '');
  const body = String(payload.body ?? '');
  const data = (payload.data && typeof payload.data === 'object' ? payload.data : {}) as Record<string, unknown>;
  const dataStrings: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value == null) continue;
    dataStrings[key] = String(value).slice(0, 200);
  }

  try {
    if (channel === 'push' || channel === 'silent') {
      const targets = await activePushTargets(userId);
      if (targets.length === 0) {
        await completeJob(job, 'none', null, false);
        return;
      }
      const result = await messaging.sendPush({
        tokens: targets.map((item) => item.token),
        title: channel === 'silent' ? '' : title,
        body: channel === 'silent' ? '' : body,
        imageUrl: typeof payload.imageUrl === 'string' ? payload.imageUrl : undefined,
        data: dataStrings,
        collapseKey: typeof payload.collapseKey === 'string' ? payload.collapseKey : undefined,
        silent: channel === 'silent' || payload.silent === true,
        priority: String(job.priority) === 'urgent' || String(job.priority) === 'high' ? 'high' : 'normal',
      });
      if (result.invalidTokens?.length) await deactivateTokens(result.invalidTokens);
      if (result.rejected > 0 && result.accepted === 0) {
        await failJob(
          job,
          result.errorCode ?? 'PROVIDER_ERROR',
          result.error ?? 'push rejected',
          Boolean(result.permanent) || isPermanentProviderError(result.errorCode),
        );
        return;
      }
      await completeJob(job, result.provider, result.messageId, result.accepted > 0);
      await bumpMetric({ channel, latencyMs: Date.now() - started });
      return;
    }

    if (channel === 'email') {
      const to = typeof payload.email === 'string' ? payload.email : null;
      if (!to) {
        await failJob(job, 'INVALID_DESTINATION', 'missing email', true);
        return;
      }
      const result = await messaging.sendEmail({
        to,
        subject: String(payload.subject ?? title).slice(0, 255),
        text: body,
        html: `<p style="font:16px/1.5 system-ui,sans-serif">${body
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br/>')}</p>`,
      });
      if (result.rejected > 0 && result.accepted === 0) {
        await failJob(
          job,
          result.errorCode ?? 'PROVIDER_ERROR',
          result.error ?? 'email rejected',
          Boolean(result.permanent) || isPermanentProviderError(result.errorCode),
        );
        return;
      }
      await completeJob(job, result.provider, result.messageId, result.accepted > 0);
      await bumpMetric({ channel, latencyMs: Date.now() - started });
      return;
    }

    if (channel === 'sms') {
      const to = typeof payload.phone === 'string' ? payload.phone : null;
      if (!to) {
        await failJob(job, 'INVALID_DESTINATION', 'missing phone', true);
        return;
      }
      const result = await messaging.sendSms({ to, text: body.slice(0, 320) });
      if (result.rejected > 0 && result.accepted === 0) {
        await failJob(
          job,
          result.errorCode ?? 'PROVIDER_ERROR',
          result.error ?? 'sms rejected',
          Boolean(result.permanent) || isPermanentProviderError(result.errorCode),
        );
        return;
      }
      await completeJob(job, result.provider, result.messageId, result.accepted > 0);
      await bumpMetric({ channel, latencyMs: Date.now() - started });
      return;
    }

    if (channel === 'whatsapp') {
      const to = typeof payload.phone === 'string' ? payload.phone : null;
      if (!to) {
        await failJob(job, 'INVALID_DESTINATION', 'missing phone', true);
        return;
      }
      // Business-initiated WhatsApp requires an approved template; free-form
      // text is only deliverable inside a user-opened 24h window. Without a
      // template configured this is a permanent failure, not a retry.
      const template = typeof payload.whatsappTemplate === 'string' ? payload.whatsappTemplate : env.WHATSAPP_ALERT_TEMPLATE_NAME;
      if (!template) {
        await failJob(job, 'TEMPLATE_NOT_CONFIGURED', 'no approved WhatsApp template for this alert', true);
        return;
      }
      const result = await messaging.sendWhatsApp({
        to,
        text: body.slice(0, 1024),
        templateName: template,
        templateVariables: [title.slice(0, 120), body.slice(0, 512)].filter((part) => part.length > 0),
      });
      if (result.rejected > 0 && result.accepted === 0) {
        await failJob(
          job,
          result.errorCode ?? 'PROVIDER_ERROR',
          result.error ?? 'whatsapp rejected',
          Boolean(result.permanent) || isPermanentProviderError(result.errorCode),
        );
        return;
      }
      await completeJob(job, result.provider, result.messageId, result.accepted > 0);
      await bumpMetric({ channel, latencyMs: Date.now() - started });
      return;
    }

    await failJob(job, 'UNKNOWN_CHANNEL', `unsupported channel ${channel}`, true);
  } catch (error) {
    await failJob(job, 'EXCEPTION', error instanceof Error ? error.message : 'unknown', false);
  }
}

export async function processNotificationJobs(limit = env.NOTIFICATION_JOB_BATCH): Promise<number> {
  let jobs: Row[] = [];
  try {
    jobs = await claimNotificationJobs(limit);
  } catch (error) {
    log.debug({ err: error }, 'job claim skipped');
    return 0;
  }
  for (const job of jobs) {
    await processJob(job);
  }
  return jobs.length;
}

export async function dispatchDueScheduled(limit = 50): Promise<number> {
  let due: Row[] = [];
  try {
    due = await queryRows<Row>(
      `SELECT * FROM scheduled_notifications
        WHERE status = 'scheduled'
          AND scheduled_for <= CURRENT_TIMESTAMP
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        ORDER BY scheduled_for
        LIMIT ?`,
      [limit],
    );
  } catch (error) {
    log.debug({ err: error }, 'scheduled poll skipped');
    return 0;
  }

  let processed = 0;
  for (const row of due) {
    await execute(`UPDATE scheduled_notifications SET status = 'processing' WHERE id = ? AND status = 'scheduled'`, [
      Number(row.id),
    ]);
    const payload = parsePayload(row.payload);
    const userId = row.user_id ? Number(row.user_id) : null;
    if (row.audience === 'user' && userId) {
      await notifyUser({
        userId,
        categoryCode: String(row.category_code),
        eventType: String(row.category_code),
        eventId: `scheduled:${row.uuid}`,
        title: typeof payload.title === 'string' ? payload.title : undefined,
        body: typeof payload.body === 'string' ? payload.body : undefined,
        variables: payload,
        priority: String(row.priority ?? 'normal'),
        expiresAt: row.expires_at ? new Date(row.expires_at as Date) : null,
      });
      await execute(
        `UPDATE scheduled_notifications
            SET status = 'sent', sent_count = sent_count + 1, processed_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [Number(row.id)],
      );
      processed += 1;

      const cron = row.recurrence_cron as string | null;
      if (cron) {
        const next = new Date(row.scheduled_for as Date);
        next.setUTCDate(next.getUTCDate() + 1);
        await execute(
          `INSERT INTO scheduled_notifications
             (uuid, user_id, audience, category_code, template_id, channel, payload, scheduled_for,
              timezone_strategy, timezone, status, recurrence_cron, created_by, priority, expires_at)
           VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`,
          [
            uuid(),
            userId,
            String(row.category_code),
            row.template_id,
            String(row.channel),
            row.payload,
            next,
            String(row.timezone_strategy ?? 'utc'),
            row.timezone,
            cron,
            row.created_by,
            String(row.priority ?? 'normal'),
            row.expires_at,
          ],
        ).catch((error) => log.debug({ err: error }, 'recurrence insert skipped'));
      }
      continue;
    }

    // all / segment audiences are dispatched by the Admin Control Plane worker.
    await execute(`UPDATE scheduled_notifications SET status = 'scheduled' WHERE id = ? AND status = 'processing'`, [
      Number(row.id),
    ]);
    continue;
  }
  return processed;
}

export async function flushNotificationDigests(limit = 40): Promise<number> {
  let rows: Row[] = [];
  try {
    rows = await queryRows<Row>(
      `SELECT * FROM notification_digests
        WHERE sent_at IS NULL AND scheduled_for <= CURRENT_TIMESTAMP
        ORDER BY scheduled_for
        LIMIT ?`,
      [limit],
    );
  } catch {
    return 0;
  }

  let processed = 0;
  for (const row of rows) {
    const count = Number(row.item_count ?? 0);
    if (count <= 0) {
      await execute(`UPDATE notification_digests SET sent_at = CURRENT_TIMESTAMP WHERE id = ?`, [Number(row.id)]);
      continue;
    }
    await notifyUser({
      userId: Number(row.user_id),
      categoryCode: String(row.category_code),
      eventType: `${row.category_code}.digest`,
      eventId: `digest:${row.id}`,
      title: `${count} new updates`,
      body: 'A digest of marketplace alerts is ready.',
      variables: { count },
      priority: 'low',
    });
    await execute(`UPDATE notification_digests SET sent_at = CURRENT_TIMESTAMP WHERE id = ?`, [Number(row.id)]);
    processed += 1;
  }
  return processed;
}

export async function expireStaleNotifications(): Promise<number> {
  try {
    const result = await execute(
      `UPDATE notifications
          SET dismissed_at = COALESCE(dismissed_at, CURRENT_TIMESTAMP)
        WHERE expires_at IS NOT NULL
          AND expires_at < CURRENT_TIMESTAMP
          AND dismissed_at IS NULL`,
    );
    return result.affectedRows;
  } catch {
    return 0;
  }
}

export async function dispatchSubscriptionReminders(): Promise<number> {
  try {
    const rows = await queryRows<Row>(
      `SELECT us.id, us.user_id, p.code AS plan_code, us.current_period_end
         FROM user_subscriptions us
         JOIN subscription_plans p ON p.id = us.plan_id
        WHERE us.status IN ('active','trialing')
          AND us.current_period_end BETWEEN CURRENT_TIMESTAMP AND DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 3 DAY)`,
    );
    let n = 0;
    for (const row of rows) {
      await notifyUser({
        userId: Number(row.user_id),
        categoryCode: 'subscription.expiring',
        eventType: 'subscription.expiring',
        eventId: `sub-expiring:${row.id}:${String(row.current_period_end).slice(0, 10)}`,
        variables: {
          planCode: String(row.plan_code),
          endsAt: row.current_period_end,
        },
        priority: 'high',
        actionType: 'subscription',
      });
      n += 1;
    }
    return n;
  } catch {
    return 0;
  }
}
