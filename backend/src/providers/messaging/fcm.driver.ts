import crypto from 'node:crypto';
import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import type { DeliveryResult, PushDriver, PushMessage } from './types';

const log = loggerFor('messaging.fcm');

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/**
 * Errors that mean the registration token is dead: the app was uninstalled, the
 * token was rotated, or it belongs to a different Firebase project. These are
 * the only cases where we delete a token — a transient 5xx must never purge a
 * user's device or they silently stop receiving notifications.
 */
const DEAD_TOKEN_STATUSES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND', 'SENDER_ID_MISMATCH']);

interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Firebase Cloud Messaging over the HTTP v1 API.
 *
 * The legacy `key=AAAA...` server-key endpoint was decommissioned, so v1 is the
 * only option: every request needs a short-lived OAuth2 access token minted
 * from the service account's private key. We sign the JWT grant with node's
 * crypto rather than pulling in `firebase-admin` (~40MB of transitive deps for
 * one HTTP call), and the private key never leaves the server.
 *
 * v1 has no multicast endpoint — one HTTP request per token — so sends are
 * batched with bounded concurrency instead.
 */
export class FcmPushDriver implements PushDriver {
  readonly name = 'fcm';
  private account: ServiceAccount | null = null;
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor() {
    this.account = loadServiceAccount();
  }

  isConfigured(): boolean {
    return this.account !== null;
  }

  /**
   * Access tokens are valid for an hour. We refresh at 55 minutes so an
   * in-flight burst never fails on an expiry race.
   */
  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now()) return this.accessToken.value;
    const account = this.account;
    if (!account) throw new Error('fcm_not_configured');

    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: account.clientEmail,
        scope: SCOPE,
        aud: TOKEN_ENDPOINT,
        iat: now,
        exp: now + 3600,
      }),
    );
    const signature = base64url(
      crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.privateKey),
    );

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claims}.${signature}`,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      // The body carries Google's reason (clock skew, revoked key, disabled
      // account) and contains no secret material.
      throw new Error(`fcm_token_http_${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) throw new Error('fcm_token_missing');

    this.accessToken = {
      value: payload.access_token,
      expiresAt: Date.now() + Math.max(60, (payload.expires_in ?? 3600) - 300) * 1000,
    };
    return this.accessToken.value;
  }

  async send(message: PushMessage): Promise<DeliveryResult> {
    const account = this.account;
    if (!account) {
      return {
        provider: this.name,
        messageId: null,
        accepted: 0,
        rejected: message.tokens.length,
        error: 'fcm_not_configured',
        errorCode: 'REJECTED',
        permanent: true,
      };
    }

    let accessToken: string;
    try {
      accessToken = await this.token();
    } catch (error) {
      log.error({ err: error }, 'could not mint FCM access token');
      return {
        provider: this.name,
        messageId: null,
        accepted: 0,
        rejected: message.tokens.length,
        error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        errorCode: 'PROVIDER_ERROR',
        permanent: false,
      };
    }

    const endpoint = `https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`;
    const invalidTokens: string[] = [];
    let accepted = 0;
    let rejected = 0;
    let firstMessageId: string | null = null;
    let lastError: string | undefined;
    let lastErrorCode: string | undefined;

    // Bounded concurrency: enough to clear a fan-out quickly without opening a
    // socket per follower on a popular listing.
    const queue = [...message.tokens];
    const workers = Array.from({ length: Math.min(env.PUSH_CONCURRENCY, queue.length) }, async () => {
      for (let token = queue.pop(); token !== undefined; token = queue.pop()) {
        const result = await this.sendOne(endpoint, accessToken, token, message);
        if (result.ok) {
          accepted += 1;
          firstMessageId ??= result.messageId;
        } else {
          rejected += 1;
          lastError = result.error;
          lastErrorCode = result.errorCode;
          if (result.deadToken) invalidTokens.push(token);
        }
      }
    });
    await Promise.all(workers);

    return {
      provider: this.name,
      messageId: firstMessageId,
      accepted,
      rejected,
      ...(invalidTokens.length > 0 ? { invalidTokens } : {}),
      ...(lastError ? { error: lastError } : {}),
      ...(lastErrorCode ? { errorCode: lastErrorCode } : {}),
      // Only permanent when every recipient failed permanently; a partial
      // success must still count as delivered.
      permanent: accepted === 0 && rejected > 0 && invalidTokens.length === rejected,
    };
  }

  private async sendOne(
    endpoint: string,
    accessToken: string,
    token: string,
    message: PushMessage,
  ): Promise<{ ok: boolean; messageId: string | null; deadToken?: boolean; error?: string; errorCode?: string }> {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: buildFcmMessage(token, message) }),
        signal: AbortSignal.timeout(env.PUSH_TIMEOUT_MS),
      });

      if (response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { name?: string };
        return { ok: true, messageId: payload.name ?? null };
      }

      const raw = await response.text().catch(() => '');
      const status = extractFcmStatus(raw);
      const deadToken = response.status === 404 || (status !== null && DEAD_TOKEN_STATUSES.has(status));
      // Never log the token itself; a valid token can be used to spam a device.
      log.warn({ httpStatus: response.status, fcmStatus: status, deadToken }, 'fcm rejected a push');
      return {
        ok: false,
        messageId: null,
        deadToken,
        error: `fcm_http_${response.status}`,
        errorCode: deadToken ? 'REJECTED' : 'PROVIDER_ERROR',
      };
    } catch (error) {
      return {
        ok: false,
        messageId: null,
        error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        errorCode: 'TIMEOUT',
      };
    }
  }
}

/**
 * Maps our transport-neutral shape onto FCM's per-platform blocks.
 *
 * Silent pushes deliberately omit `notification` entirely: including it makes
 * iOS render a banner regardless of `content-available`, which is exactly what
 * a background sync must not do.
 */
function buildFcmMessage(token: string, message: PushMessage): Record<string, unknown> {
  const highPriority = message.priority === 'high';

  if (message.silent) {
    return {
      token,
      data: message.data ?? {},
      android: { priority: 'HIGH', ...(message.collapseKey ? { collapse_key: message.collapseKey } : {}) },
      apns: {
        headers: { 'apns-priority': '5', 'apns-push-type': 'background' },
        payload: { aps: { 'content-available': 1 } },
      },
    };
  }

  return {
    token,
    notification: {
      title: message.title,
      body: message.body,
      ...(message.imageUrl ? { image: message.imageUrl } : {}),
    },
    data: message.data ?? {},
    android: {
      priority: highPriority ? 'HIGH' : 'NORMAL',
      ...(message.collapseKey ? { collapse_key: message.collapseKey } : {}),
      notification: {
        ...(env.PUSH_ANDROID_CHANNEL_ID ? { channel_id: env.PUSH_ANDROID_CHANNEL_ID } : {}),
        ...(message.imageUrl ? { image: message.imageUrl } : {}),
        default_sound: true,
      },
    },
    apns: {
      headers: { 'apns-priority': highPriority ? '10' : '5', 'apns-push-type': 'alert' },
      payload: {
        aps: {
          sound: 'default',
          ...(typeof message.badge === 'number' ? { badge: message.badge } : {}),
          ...(message.imageUrl ? { 'mutable-content': 1 } : {}),
        },
      },
    },
    webpush: {
      headers: { Urgency: highPriority ? 'high' : 'normal' },
      notification: {
        title: message.title,
        body: message.body,
        ...(message.imageUrl ? { image: message.imageUrl } : {}),
        ...(env.PUSH_WEB_ICON_URL ? { icon: env.PUSH_WEB_ICON_URL } : {}),
      },
      ...(env.WEB_URL ? { fcm_options: { link: env.WEB_URL } } : {}),
    },
  };
}

/** Pulls `error.status` out of an FCM error body without trusting its shape. */
function extractFcmStatus(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { error?: { status?: string; details?: Array<{ errorCode?: string }> } };
    return parsed.error?.status ?? parsed.error?.details?.[0]?.errorCode ?? null;
  } catch {
    return null;
  }
}

/**
 * Reads the service account from either a JSON blob or discrete env vars.
 *
 * The blob form is what secret managers hand you verbatim; the discrete form is
 * friendlier in CI. `\n` in the private key is unescaped because every
 * dashboard and `.env` file mangles real newlines.
 */
function loadServiceAccount(): ServiceAccount | null {
  const raw = env.FCM_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim().length > 0) {
    try {
      const json = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
      if (json.project_id && json.client_email && json.private_key) {
        return {
          projectId: json.project_id,
          clientEmail: json.client_email,
          privateKey: json.private_key.replace(/\\n/g, '\n'),
        };
      }
      log.error('FCM_SERVICE_ACCOUNT_JSON is missing project_id, client_email, or private_key');
    } catch {
      log.error('FCM_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
    return null;
  }

  if (env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY) {
    return {
      projectId: env.FCM_PROJECT_ID,
      clientEmail: env.FCM_CLIENT_EMAIL,
      privateKey: env.FCM_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }

  return null;
}
