import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import type { DeliveryResult, EmailDriver, EmailMessage } from './types';

const log = loggerFor('messaging.smtp');

/**
 * SMTP email over nodemailer.
 *
 * This is the no-cost production path: any mailbox that speaks SMTP works
 * (self-hosted Postfix, a domain mailbox, or a provider's SMTP bridge), so
 * transactional email does not require signing up for an HTTP email API.
 *
 * Permanent-vs-transient classification matters more than it looks: the
 * notification worker retries transient failures and burns attempts on
 * permanent ones. SMTP encodes that in the reply code's first digit — 5xx is
 * permanent (bad mailbox, rejected content), 4xx is a temporary deferral.
 */
export class SmtpEmailDriver implements EmailDriver {
  readonly name = 'smtp';
  private transporter: Transporter | null = null;

  private transport(): Transporter {
    if (this.transporter) return this.transporter;
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // Implicit TLS on 465; STARTTLS upgrade on 587/25.
      secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
      requireTLS: env.SMTP_REQUIRE_TLS,
      connectionTimeout: env.SMTP_TIMEOUT_MS,
      greetingTimeout: env.SMTP_TIMEOUT_MS,
      socketTimeout: env.SMTP_TIMEOUT_MS,
      pool: true,
      maxConnections: env.SMTP_MAX_CONNECTIONS,
      maxMessages: 100,
    });
    return this.transporter;
  }

  async send(message: EmailMessage): Promise<DeliveryResult> {
    try {
      const info = await this.transport().sendMail({
        from: env.EMAIL_FROM,
        sender: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo ?? env.EMAIL_REPLY_TO,
        // Transactional mail must never land in a bulk folder or trigger
        // auto-responder loops back into the support inbox.
        headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
      });

      const rejected = info.rejected?.length ?? 0;
      return {
        provider: this.name,
        messageId: info.messageId ?? null,
        accepted: info.accepted?.length ?? 0,
        rejected,
        ...(rejected > 0 ? { error: 'recipient_rejected', errorCode: 'REJECTED', permanent: true } : {}),
      };
    } catch (error) {
      const code = (error as { responseCode?: number }).responseCode;
      const permanent = typeof code === 'number' && code >= 500 && code < 600;
      // The address is intentionally absent: recipients are PII and the
      // logger's redaction list does not cover a free-form message string.
      log.error({ err: error, responseCode: code, permanent }, 'smtp send failed');
      return {
        provider: this.name,
        messageId: null,
        accepted: 0,
        rejected: 1,
        error: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
        errorCode: permanent ? 'REJECTED' : 'PROVIDER_ERROR',
        permanent,
      };
    }
  }

  /** Used by the readiness probe so a broken relay surfaces before users hit it. */
  async verify(): Promise<boolean> {
    try {
      await this.transport().verify();
      return true;
    } catch (error) {
      log.error({ err: error }, 'smtp verification failed');
      return false;
    }
  }

  async close(): Promise<void> {
    this.transporter?.close();
    this.transporter = null;
  }
}
