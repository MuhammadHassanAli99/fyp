import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import type { DeliveryResult, EmailDriver, SmsDriver, WhatsAppDriver } from './types';

const log = loggerFor('messaging.otp');

export type OtpChannel = 'email' | 'sms' | 'whatsapp';

export interface OtpDispatch {
  channel: OtpChannel;
  destination: string;
  code: string;
  purpose: string;
  language: string;
  ttlMinutes: number;
}

/**
 * One OTP channel.
 *
 * Authentication logic depends on this interface and never on a concrete
 * provider, so swapping Twilio for Vonage, or SMTP for SES, is an env change in
 * `src/providers/messaging` — `auth.service` does not move.
 */
export interface OtpProvider {
  readonly channel: OtpChannel;
  readonly providerName: string;
  isConfigured(): boolean;
  send(dispatch: OtpDispatch): Promise<DeliveryResult>;
}

/** Result of a dispatch, including which channel actually carried the code. */
export interface OtpSendOutcome extends DeliveryResult {
  channel: OtpChannel;
  /** Set when the requested channel was unavailable and a fallback was used. */
  substitutedFrom?: OtpChannel;
}

interface OtpCopy {
  subject: string;
  body: (code: string, ttl: number, app: string) => string;
}

/**
 * Copy lives with the dispatcher so every channel says the same thing and the
 * "never share this" warning cannot be forgotten on one path. Anti-phishing
 * wording is deliberate: it is the cheapest defence against OTP relay scams.
 */
const OTP_COPY: Record<string, OtpCopy> = {
  login: {
    subject: 'Your sign-in code',
    body: (code, ttl, app) =>
      `${code} is your ${app} sign-in code. It expires in ${ttl} minutes. Never share it with anyone.`,
  },
  register: {
    subject: 'Confirm your account',
    body: (code, ttl, app) => `${code} is your ${app} verification code. It expires in ${ttl} minutes.`,
  },
  verify_email: {
    subject: 'Verify your email address',
    body: (code, ttl, app) => `${code} is your ${app} email verification code. It expires in ${ttl} minutes.`,
  },
  verify_phone: {
    subject: 'Verify your phone number',
    body: (code, ttl, app) => `${code} is your ${app} phone verification code. It expires in ${ttl} minutes.`,
  },
  reset_password: {
    subject: 'Reset your password',
    body: (code, ttl, app) =>
      `${code} is your ${app} password reset code. It expires in ${ttl} minutes. If you did not request this, ignore this message and your password will stay unchanged.`,
  },
  mfa: {
    subject: 'Your verification code',
    body: (code, ttl, app) => `${code} is your ${app} two-factor code. It expires in ${ttl} minutes.`,
  },
  device_verify: {
    subject: 'Confirm a new device',
    body: (code, ttl, app) =>
      `${code} is your ${app} device confirmation code. If you did not just sign in on a new device, change your password immediately.`,
  },
};

const copyFor = (purpose: string): OtpCopy => OTP_COPY[purpose] ?? OTP_COPY.login!;

export class EmailOtpProvider implements OtpProvider {
  readonly channel = 'email' as const;
  constructor(private readonly driver: EmailDriver) {}
  get providerName(): string {
    return this.driver.name;
  }
  isConfigured(): boolean {
    return this.driver.name !== 'log';
  }
  async send(dispatch: OtpDispatch): Promise<DeliveryResult> {
    const copy = copyFor(dispatch.purpose);
    const text = copy.body(dispatch.code, dispatch.ttlMinutes, env.APP_NAME);
    return this.driver.send({
      to: dispatch.destination,
      subject: copy.subject,
      text,
      html: `<p style="font:16px/1.5 system-ui,sans-serif">${text.replace(
        dispatch.code,
        `<strong style="font-size:24px;letter-spacing:3px">${dispatch.code}</strong>`,
      )}</p>`,
    });
  }
}

export class SmsOtpProvider implements OtpProvider {
  readonly channel = 'sms' as const;
  constructor(private readonly driver: SmsDriver) {}
  get providerName(): string {
    return this.driver.name;
  }
  isConfigured(): boolean {
    return this.driver.name !== 'log';
  }
  async send(dispatch: OtpDispatch): Promise<DeliveryResult> {
    return this.driver.send({
      to: dispatch.destination,
      text: copyFor(dispatch.purpose).body(dispatch.code, dispatch.ttlMinutes, env.APP_NAME),
      ...(env.SMS_SENDER_ID ? { senderId: env.SMS_SENDER_ID } : {}),
    });
  }
}

/**
 * WhatsApp OTP.
 *
 * Always sent as an approved *authentication* template: an OTP is
 * business-initiated, so free-form text is rejected by Meta unless the user
 * messaged us in the last 24 hours. The code is passed both as the body
 * variable and as the copy-code button variable, which is the shape Meta's
 * authentication template category requires.
 */
export class WhatsAppOtpProvider implements OtpProvider {
  readonly channel = 'whatsapp' as const;
  constructor(private readonly driver: WhatsAppDriver & { isConfigured?: () => boolean }) {}
  get providerName(): string {
    return this.driver.name;
  }
  isConfigured(): boolean {
    return (this.driver.isConfigured?.() ?? this.driver.name !== 'log') && Boolean(env.WHATSAPP_OTP_TEMPLATE_NAME);
  }
  async send(dispatch: OtpDispatch): Promise<DeliveryResult> {
    return this.driver.send({
      to: dispatch.destination,
      text: copyFor(dispatch.purpose).body(dispatch.code, dispatch.ttlMinutes, env.APP_NAME),
      templateName: env.WHATSAPP_OTP_TEMPLATE_NAME,
      templateLanguage: languageTagFor(dispatch.language),
      templateVariables: [dispatch.code],
      buttonVariables: [dispatch.code],
    });
  }
}

/**
 * Meta template languages are locale tags (`en_US`, `ar`), not bare ISO-639
 * codes. An unknown language must fall back to the configured default rather
 * than fail the send — a user gets their code in English instead of nothing.
 */
function languageTagFor(language: string): string {
  const normalised = language.replace('-', '_');
  if (env.WHATSAPP_TEMPLATE_LANGUAGES.includes(normalised)) return normalised;
  const base = normalised.split('_')[0] ?? normalised;
  const match = env.WHATSAPP_TEMPLATE_LANGUAGES.find((tag) => tag.split('_')[0] === base);
  return match ?? env.WHATSAPP_TEMPLATE_LANGUAGE;
}

/**
 * Routes an OTP to the right provider.
 *
 * The previous implementation sent `channel: 'whatsapp'` through the SMS
 * driver, so a user who chose WhatsApp got an SMS and the response still
 * claimed WhatsApp. Delivery now always reports the channel that actually
 * carried the code, and a substitution is explicit in the return value so the
 * client can say "we texted you instead".
 *
 * Fallback is only ever WhatsApp -> SMS, because those two share one
 * destination (the user's phone). We never cross to email: that is a different
 * identifier and would leak a phone-verification code to a mailbox.
 */
export class OtpRouter {
  private readonly providers: Map<OtpChannel, OtpProvider>;

  constructor(providers: OtpProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.channel, provider]));
  }

  providerFor(channel: OtpChannel): OtpProvider | undefined {
    return this.providers.get(channel);
  }

  /** Channels that can actually deliver right now — drives the login UI. */
  configuredChannels(): OtpChannel[] {
    return [...this.providers.values()].filter((provider) => provider.isConfigured()).map((p) => p.channel);
  }

  async send(dispatch: OtpDispatch): Promise<OtpSendOutcome> {
    let channel = dispatch.channel;
    let substitutedFrom: OtpChannel | undefined;

    if (channel === 'whatsapp') {
      const whatsapp = this.providers.get('whatsapp');
      if (!whatsapp?.isConfigured() && env.OTP_WHATSAPP_FALLBACK_TO_SMS) {
        log.warn('whatsapp OTP requested but not configured; falling back to SMS on the same number');
        substitutedFrom = 'whatsapp';
        channel = 'sms';
      }
    }

    const provider = this.providers.get(channel);
    if (!provider) {
      return {
        channel,
        provider: 'none',
        messageId: null,
        accepted: 0,
        rejected: 1,
        error: `no_provider_for_${channel}`,
        errorCode: 'REJECTED',
        permanent: true,
        ...(substitutedFrom ? { substitutedFrom } : {}),
      };
    }

    const result = await provider.send({ ...dispatch, channel });
    return { ...result, channel, ...(substitutedFrom ? { substitutedFrom } : {}) };
  }
}
