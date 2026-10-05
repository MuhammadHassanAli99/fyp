/**
 * Messaging transport contracts.
 *
 * These live in their own module so individual drivers can import the shapes
 * without importing the facade in `./index`, which would be a cycle
 * (facade -> driver -> facade).
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html?: string;
  text: string;
  replyTo?: string;
  templateId?: string;
  variables?: Record<string, unknown>;
}

export interface SmsMessage {
  to: string;
  text: string;
  senderId?: string;
}

export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  imageUrl?: string;
  data?: Record<string, string>;
  collapseKey?: string;
  priority?: 'normal' | 'high';
  silent?: boolean;
  badge?: number;
}

/**
 * A WhatsApp Business message. Meta only allows free-form text inside a
 * 24-hour customer service window; anything business-initiated (an OTP, a
 * listing alert) must reference a pre-approved template. `templateName` being
 * set is what distinguishes the two.
 */
export interface WhatsAppMessage {
  to: string;
  text: string;
  templateName?: string;
  templateLanguage?: string;
  templateVariables?: string[];
  /** Template buttons (e.g. WhatsApp's one-tap OTP copy button). */
  buttonVariables?: string[];
}

export interface DeliveryResult {
  provider: string;
  messageId: string | null;
  accepted: number;
  rejected: number;
  error?: string;
  errorCode?: string;
  invalidTokens?: string[];
  /**
   * True when retrying cannot help (bad address, unregistered device token,
   * rejected content). The notification worker uses this to stop burning
   * attempts on a delivery that will never succeed.
   */
  permanent?: boolean;
}

export interface EmailDriver {
  readonly name: string;
  send(message: EmailMessage): Promise<DeliveryResult>;
  verify?(): Promise<boolean>;
  close?(): Promise<void>;
}

export interface SmsDriver {
  readonly name: string;
  send(message: SmsMessage): Promise<DeliveryResult>;
}

export interface PushDriver {
  readonly name: string;
  send(message: PushMessage): Promise<DeliveryResult>;
}

export interface WhatsAppDriver {
  readonly name: string;
  send(message: WhatsAppMessage): Promise<DeliveryResult>;
}
