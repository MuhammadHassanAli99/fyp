import crypto from 'node:crypto';
import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import type { DeliveryResult, WhatsAppDriver, WhatsAppMessage } from './types';

const log = loggerFor('messaging.whatsapp');

/**
 * Meta error codes that will never succeed on retry: the number is not on
 * WhatsApp, the recipient blocked the business, or the template is not
 * approved. Retrying these wastes attempts and, for paid conversations, money.
 */
const PERMANENT_META_CODES = new Set([
  131_026, // message undeliverable — recipient not on WhatsApp
  131_047, // re-engagement required, no template used
  131_051, // unsupported message type
  132_000, // template param count mismatch
  132_001, // template does not exist / not approved
  132_005, // template text too long
  132_007, // template format mismatch
  133_010, // phone number not registered
  100, // invalid parameter
]);

/**
 * WhatsApp Business Cloud API (Meta, first-party — no reseller in the path).
 *
 * Two delivery modes, and the distinction is a hard platform rule rather than a
 * preference:
 *
 *   - Free-form text only reaches a user inside the 24-hour customer service
 *     window that *they* opened by messaging the business first. Support
 *     replies use this.
 *   - Anything business-initiated — an OTP, a listing alert — must use a
 *     pre-approved template. Sending free-form text outside the window fails
 *     with 131047, it does not silently arrive.
 *
 * WhatsApp conversations are billed per conversation and are NOT free at any
 * volume; see docs/WHATSAPP_PRODUCTION_SETUP.md. Email OTP remains the default
 * so authentication never depends on a paid channel.
 */
export class WhatsAppCloudDriver implements WhatsAppDriver {
  readonly name = 'whatsapp_cloud';

  isConfigured(): boolean {
    return Boolean(env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN);
  }

  async send(message: WhatsAppMessage): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return {
        provider: this.name,
        messageId: null,
        accepted: 0,
        rejected: 1,
        error: 'whatsapp_not_configured',
        errorCode: 'REJECTED',
        permanent: true,
      };
    }

    const endpoint = `${env.WHATSAPP_API_BASE_URL}/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildPayload(message)),
        signal: AbortSignal.timeout(env.WHATSAPP_TIMEOUT_MS),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
        error?: { code?: number; message?: string; error_subcode?: number };
      };

      if (!response.ok || payload.error) {
        const code = payload.error?.code;
        const permanent = response.status === 400 || (typeof code === 'number' && PERMANENT_META_CODES.has(code));
        // Meta's message text is safe to log; the destination number is not
        // (it is PII and appears in no redaction path as a free-form string).
        log.warn(
          { httpStatus: response.status, metaCode: code, subcode: payload.error?.error_subcode, permanent },
          'whatsapp send rejected',
        );
        return {
          provider: this.name,
          messageId: null,
          accepted: 0,
          rejected: 1,
          error: payload.error?.message?.slice(0, 300) ?? `whatsapp_http_${response.status}`,
          errorCode: permanent ? 'REJECTED' : 'PROVIDER_ERROR',
          permanent,
        };
      }

      return {
        provider: this.name,
        messageId: payload.messages?.[0]?.id ?? null,
        accepted: 1,
        rejected: 0,
      };
    } catch (error) {
      log.error({ err: error }, 'whatsapp send failed');
      return {
        provider: this.name,
        messageId: null,
        accepted: 0,
        rejected: 1,
        error: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
        errorCode: 'TIMEOUT',
        permanent: false,
      };
    }
  }
}

function buildPayload(message: WhatsAppMessage): Record<string, unknown> {
  // Meta wants a bare E.164 number with no '+' or separators.
  const to = message.to.replace(/[^\d]/g, '');

  if (!message.templateName) {
    return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: message.text } };
  }

  const components: Array<Record<string, unknown>> = [];
  if (message.templateVariables && message.templateVariables.length > 0) {
    components.push({
      type: 'body',
      parameters: message.templateVariables.map((text) => ({ type: 'text', text })),
    });
  }
  // Authentication templates expose a one-tap "copy code" button whose URL
  // suffix is the code itself.
  if (message.buttonVariables && message.buttonVariables.length > 0) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: message.buttonVariables.map((text) => ({ type: 'text', text })),
    });
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: message.templateName,
      language: { code: message.templateLanguage ?? env.WHATSAPP_TEMPLATE_LANGUAGE },
      ...(components.length > 0 ? { components } : {}),
    },
  };
}

/**
 * Answers Meta's webhook subscription handshake.
 *
 * Meta issues a GET with a verify token we chose; echoing back `hub.challenge`
 * proves we own the endpoint. Compared in constant time so the token cannot be
 * recovered by timing the response.
 */
export function verifyWhatsAppSubscription(params: {
  mode?: string;
  token?: string;
  challenge?: string;
}): string | null {
  const expected = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!expected || params.mode !== 'subscribe' || !params.token) return null;

  const provided = Buffer.from(params.token);
  const target = Buffer.from(expected);
  if (provided.length !== target.length || !crypto.timingSafeEqual(provided, target)) return null;

  return params.challenge ?? null;
}

/**
 * Verifies `X-Hub-Signature-256` against the exact bytes Meta signed.
 *
 * This must run on the raw body: re-serialising the parsed JSON changes key
 * order and whitespace, which changes the HMAC. Without this check anyone who
 * learns the webhook URL can inject support tickets and delivery receipts.
 */
export function verifyWhatsAppSignature(rawBody: Buffer | string, signatureHeader: string | undefined): boolean {
  const appSecret = env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    // Fail closed in production: an unverifiable webhook is an open endpoint.
    if (env.isProduction) {
      log.error('WHATSAPP_APP_SECRET is not set; refusing to trust an unsigned webhook');
      return false;
    }
    return true;
  }
  if (!signatureHeader?.startsWith('sha256=')) return false;

  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  if (provided.length !== expected.length) return false;

  return crypto.timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
}
