import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { SmtpEmailDriver } from './smtp.driver';
import { FcmPushDriver } from './fcm.driver';
import { WhatsAppCloudDriver } from './whatsapp.driver';
import {
  EmailOtpProvider,
  OtpRouter,
  SmsOtpProvider,
  WhatsAppOtpProvider,
  type OtpDispatch,
  type OtpSendOutcome,
} from './otp.provider';
import type {
  DeliveryResult,
  EmailDriver,
  EmailMessage,
  PushDriver,
  PushMessage,
  SmsDriver,
  SmsMessage,
  WhatsAppDriver,
  WhatsAppMessage,
} from './types';

const log = loggerFor('messaging');

/**
 * Outbound messaging behind one interface (§14 Notifications, §2 OTP).
 *
 * Nothing in the domain imports nodemailer/FCM/Meta. Swapping a provider is an
 * env change, and the `log` driver means the whole auth and notification flow
 * is fully exercisable locally with no external accounts.
 *
 * The `log` drivers are a *development* convenience. Leaving them selected in
 * production means OTPs and notifications are written to stdout instead of
 * being delivered, so `assertMessagingReadiness()` refuses to boot on them —
 * see src/config/env.ts.
 */

export type {
  DeliveryResult,
  EmailDriver,
  EmailMessage,
  PushDriver,
  PushMessage,
  SmsDriver,
  SmsMessage,
  WhatsAppDriver,
  WhatsAppMessage,
} from './types';
export type { OtpChannel, OtpDispatch, OtpProvider, OtpSendOutcome } from './otp.provider';
export { verifyWhatsAppSignature, verifyWhatsAppSubscription } from './whatsapp.driver';

/* -------------------------------------------------------------------------- */
/* Log drivers — the local default                                            */
/* -------------------------------------------------------------------------- */

const maskEmail = (value: string) => {
  const [local, domain] = value.split('@');
  if (!domain) return 'redacted';
  return `${(local ?? '').slice(0, 1)}***@${domain}`;
};
const maskPhone = (value: string) => (value.length <= 4 ? '****' : `***${value.slice(-4)}`);

class LogEmailDriver implements EmailDriver {
  readonly name = 'log';
  async send(message: EmailMessage): Promise<DeliveryResult> {
    log.info(
      {
        to: maskEmail(message.to),
        subject: message.subject,
        ...(env.isProduction ? {} : { preview: message.text }),
      },
      'email (log driver)',
    );
    return { provider: this.name, messageId: `log-${Date.now()}`, accepted: 1, rejected: 0 };
  }
}

class LogSmsDriver implements SmsDriver {
  readonly name = 'log';
  async send(message: SmsMessage): Promise<DeliveryResult> {
    log.info(
      {
        to: maskPhone(message.to),
        length: message.text.length,
        ...(env.isProduction ? {} : { preview: message.text }),
      },
      'sms (log driver)',
    );
    return { provider: this.name, messageId: `log-${Date.now()}`, accepted: 1, rejected: 0 };
  }
}

class LogPushDriver implements PushDriver {
  readonly name = 'log';
  async send(message: PushMessage): Promise<DeliveryResult> {
    log.info(
      { tokens: message.tokens.length, title: message.title, silent: Boolean(message.silent) },
      'push (log driver)',
    );
    return { provider: this.name, messageId: `log-${Date.now()}`, accepted: message.tokens.length, rejected: 0 };
  }
}

class LogWhatsAppDriver implements WhatsAppDriver {
  readonly name = 'log';
  async send(message: WhatsAppMessage): Promise<DeliveryResult> {
    log.info(
      {
        to: maskPhone(message.to),
        template: message.templateName ?? null,
        ...(env.isProduction ? {} : { preview: message.text }),
      },
      'whatsapp (log driver)',
    );
    return { provider: this.name, messageId: `log-${Date.now()}`, accepted: 1, rejected: 0 };
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP drivers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Generic HTTP relay, configured by env. Credentials never appear in logs.
 *
 * This is an escape hatch for a self-hosted relay that accepts our own JSON
 * shape. It is deliberately NOT a provider SDK: pointing it at SendGrid or
 * Twilio directly will not work, because their request bodies differ. Use
 * EMAIL_DRIVER=smtp / PUSH_DRIVER=fcm for first-party integrations.
 */
class HttpJsonDriver {
  constructor(
    readonly name: string,
    private readonly endpoint: string,
    private readonly apiKey: string,
  ) {}

  async post(body: unknown): Promise<DeliveryResult> {
    if (!this.endpoint) {
      return {
        provider: this.name,
        messageId: null,
        accepted: 0,
        rejected: 1,
        error: 'endpoint_not_configured',
        errorCode: 'REJECTED',
        permanent: true,
      };
    }
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        id?: string;
        errorCode?: string;
        invalidTokens?: string[];
      };
      if (!response.ok) {
        const permanent = response.status === 400 || response.status === 410 || response.status === 422;
        return {
          provider: this.name,
          messageId: null,
          accepted: 0,
          rejected: 1,
          error: `http_${response.status}`,
          errorCode: payload.errorCode ?? (permanent ? 'REJECTED' : 'PROVIDER_ERROR'),
          invalidTokens: payload.invalidTokens,
          permanent,
        };
      }
      return {
        provider: this.name,
        messageId: payload.id ?? null,
        accepted: 1,
        rejected: 0,
        invalidTokens: payload.invalidTokens,
      };
    } catch (error) {
      log.error({ err: error, driver: this.name }, 'provider send failed');
      return {
        provider: this.name,
        messageId: null,
        accepted: 0,
        rejected: 1,
        error: error instanceof Error ? error.message : 'unknown',
        errorCode: 'TIMEOUT',
      };
    }
  }
}

class HttpEmailDriver implements EmailDriver {
  readonly name: string;
  private readonly http: HttpJsonDriver;
  constructor(name: string, endpoint: string, apiKey: string) {
    this.name = name;
    this.http = new HttpJsonDriver(name, endpoint, apiKey);
  }
  send(message: EmailMessage): Promise<DeliveryResult> {
    return this.http.post({ ...message, from: env.EMAIL_FROM, to: message.to });
  }
}

class HttpSmsDriver implements SmsDriver {
  readonly name: string;
  private readonly http: HttpJsonDriver;
  constructor(name: string, endpoint: string, apiKey: string) {
    this.name = name;
    this.http = new HttpJsonDriver(name, endpoint, apiKey);
  }
  send(message: SmsMessage): Promise<DeliveryResult> {
    return this.http.post({ to: message.to, text: message.text, senderId: message.senderId ?? env.SMS_SENDER_ID });
  }
}

class HttpPushDriver implements PushDriver {
  readonly name: string;
  private readonly http: HttpJsonDriver;
  constructor(name: string, endpoint: string, apiKey: string) {
    this.name = name;
    this.http = new HttpJsonDriver(name, endpoint, apiKey);
  }
  send(message: PushMessage): Promise<DeliveryResult> {
    return this.http.post(message);
  }
}

/* -------------------------------------------------------------------------- */
/* Driver selection                                                          */
/* -------------------------------------------------------------------------- */

function selectEmailDriver(): EmailDriver {
  switch (env.EMAIL_DRIVER) {
    case 'smtp': {
      if (!env.SMTP_HOST) {
        log.error('EMAIL_DRIVER=smtp requires SMTP_HOST; falling back to the log driver');
        return new LogEmailDriver();
      }
      return new SmtpEmailDriver();
    }
    case 'ses':
    case 'sendgrid':
    case 'http': {
      if (!env.EMAIL_API_URL) {
        log.error({ driver: env.EMAIL_DRIVER }, 'email driver selected without EMAIL_API_URL; falling back to log');
        return new LogEmailDriver();
      }
      return new HttpEmailDriver(env.EMAIL_DRIVER, env.EMAIL_API_URL, env.EMAIL_API_KEY ?? '');
    }
    default:
      return new LogEmailDriver();
  }
}

function selectSmsDriver(): SmsDriver {
  if (env.SMS_DRIVER === 'log') return new LogSmsDriver();
  if (!env.SMS_API_URL) {
    log.error({ driver: env.SMS_DRIVER }, 'sms driver selected without SMS_API_URL; falling back to log');
    return new LogSmsDriver();
  }
  return new HttpSmsDriver(env.SMS_DRIVER, env.SMS_API_URL, env.SMS_API_KEY ?? '');
}

function selectPushDriver(): PushDriver {
  switch (env.PUSH_DRIVER) {
    case 'fcm': {
      const driver = new FcmPushDriver();
      if (!driver.isConfigured()) {
        log.error(
          'PUSH_DRIVER=fcm requires FCM_SERVICE_ACCOUNT_JSON (or FCM_PROJECT_ID + FCM_CLIENT_EMAIL + FCM_PRIVATE_KEY); falling back to log',
        );
        return new LogPushDriver();
      }
      return driver;
    }
    case 'apns':
    case 'webpush':
    case 'http': {
      if (!env.PUSH_API_URL) {
        log.error({ driver: env.PUSH_DRIVER }, 'push driver selected without PUSH_API_URL; falling back to log');
        return new LogPushDriver();
      }
      return new HttpPushDriver(env.PUSH_DRIVER, env.PUSH_API_URL, env.PUSH_API_KEY ?? '');
    }
    default:
      return new LogPushDriver();
  }
}

function selectWhatsAppDriver(): WhatsAppDriver {
  if (env.WHATSAPP_DRIVER === 'cloud') {
    const driver = new WhatsAppCloudDriver();
    if (!driver.isConfigured()) {
      log.error(
        'WHATSAPP_DRIVER=cloud requires WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN; falling back to log',
      );
      return new LogWhatsAppDriver();
    }
    return driver;
  }
  return new LogWhatsAppDriver();
}

const emailDriver = selectEmailDriver();
const smsDriver = selectSmsDriver();
const pushDriver = selectPushDriver();
const whatsappDriver = selectWhatsAppDriver();

/* -------------------------------------------------------------------------- */
/* OTP routing                                                                */
/* -------------------------------------------------------------------------- */

const otpRouter = new OtpRouter([
  new EmailOtpProvider(emailDriver),
  new SmsOtpProvider(smsDriver),
  new WhatsAppOtpProvider(whatsappDriver),
]);

/** Spec names — same instances as messaging.email / .sms / .push. */
export type EmailProvider = EmailDriver;
export type SmsProvider = SmsDriver;
export type PushProvider = PushDriver;
export const emailProvider: EmailProvider = emailDriver;
export const smsProvider: SmsProvider = smsDriver;
export const pushProvider: PushProvider = pushDriver;
export const whatsappProvider: WhatsAppDriver = whatsappDriver;

/** Which drivers are live. Surfaced by /health/deep and the boot guard. */
export function messagingStatus() {
  return {
    email: emailDriver.name,
    sms: smsDriver.name,
    push: pushDriver.name,
    whatsapp: whatsappDriver.name,
    otpChannels: otpRouter.configuredChannels(),
  };
}

/**
 * Channels that are still on the log driver. Empty is the only acceptable
 * answer for email in production — everything else is a product decision
 * (a marketplace may legitimately ship without SMS).
 */
export function unconfiguredMessagingChannels(): string[] {
  const unconfigured: string[] = [];
  if (emailDriver.name === 'log') unconfigured.push('email');
  if (smsDriver.name === 'log') unconfigured.push('sms');
  if (pushDriver.name === 'log') unconfigured.push('push');
  if (whatsappDriver.name === 'log') unconfigured.push('whatsapp');
  return unconfigured;
}

export const messaging = {
  email: emailDriver,
  sms: smsDriver,
  push: pushDriver,
  whatsapp: whatsappDriver,
  otp: otpRouter,

  /**
   * Single entry point for OTP delivery, so copy and throttling live in one
   * place. Returns the channel that actually carried the code — a WhatsApp
   * request may be substituted to SMS on the same number.
   */
  async sendOtp(dispatch: OtpDispatch): Promise<OtpSendOutcome> {
    // Pino redacts `*.code` / `*.otp`, so local sign-in needs a stdout banner.
    // Guarded on isDevelopment (not `!isProduction`) so a staging box running
    // NODE_ENV=test never prints live codes.
    if (env.isDevelopment) {
      process.stdout.write(
        `\n\x1b[33m========== DEV OTP ==========\n` +
          `purpose: ${dispatch.purpose}\n` +
          `channel: ${dispatch.channel}\n` +
          `to:      ${dispatch.destination}\n` +
          `code:    ${dispatch.code}\n` +
          `expires: ${dispatch.ttlMinutes} min\n` +
          `=============================\x1b[0m\n\n`,
      );
    }

    return otpRouter.send(dispatch);
  },

  async sendEmail(message: EmailMessage): Promise<DeliveryResult> {
    return emailDriver.send(message);
  },

  async sendSms(message: SmsMessage): Promise<DeliveryResult> {
    return smsDriver.send(message);
  },

  async sendWhatsApp(message: WhatsAppMessage): Promise<DeliveryResult> {
    return whatsappDriver.send(message);
  },

  async sendPush(message: PushMessage): Promise<DeliveryResult> {
    if (message.tokens.length === 0) {
      return { provider: pushDriver.name, messageId: null, accepted: 0, rejected: 0 };
    }
    return pushDriver.send(message);
  },

  /** Closes pooled transports during graceful shutdown. */
  async close(): Promise<void> {
    await emailDriver.close?.();
  },
};
