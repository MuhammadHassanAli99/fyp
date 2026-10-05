import { z } from 'zod';

/**
 * Normalises Meta's WhatsApp Cloud API webhook envelope.
 *
 * Meta does not post a flat message. It posts an account-level batch:
 *
 *   { object, entry: [ { changes: [ { field, value: {
 *       contacts: [{ profile: { name }, wa_id }],
 *       messages: [{ from, id, type, text: { body } , image: { id } ... }],
 *       statuses: [{ id, status, recipient_id }]
 *   } } ] } ] }
 *
 * One request can carry several messages, and `statuses` (delivery receipts)
 * arrive on the same endpoint as inbound messages. Flattening here keeps the
 * ingest function working on one message at a time and keeps Meta's payload
 * shape out of the ticket domain.
 */

const metaTextSchema = z.object({ body: z.string() }).partial();

const metaMediaSchema = z
  .object({ id: z.string(), mime_type: z.string(), sha256: z.string(), caption: z.string() })
  .partial();

const metaMessageSchema = z
  .object({
    from: z.string(),
    id: z.string(),
    timestamp: z.string(),
    type: z.string(),
    text: metaTextSchema,
    image: metaMediaSchema,
    document: metaMediaSchema,
    audio: metaMediaSchema,
    video: metaMediaSchema,
    button: z.object({ text: z.string(), payload: z.string() }).partial(),
    interactive: z.unknown(),
  })
  .partial();

const metaValueSchema = z
  .object({
    messaging_product: z.string(),
    metadata: z.object({ display_phone_number: z.string(), phone_number_id: z.string() }).partial(),
    contacts: z.array(z.object({ profile: z.object({ name: z.string() }).partial(), wa_id: z.string() }).partial()),
    messages: z.array(metaMessageSchema),
    statuses: z.array(
      z.object({ id: z.string(), status: z.string(), recipient_id: z.string(), timestamp: z.string() }).partial(),
    ),
  })
  .partial();

export const metaWhatsAppEnvelopeSchema = z.object({
  object: z.string(),
  entry: z.array(
    z
      .object({
        id: z.string(),
        changes: z.array(z.object({ field: z.string(), value: metaValueSchema }).partial()),
      })
      .partial(),
  ),
});

/** The flat shape `ingestWhatsApp` consumes. */
export interface NormalisedWhatsAppMessage {
  from: string;
  text?: string;
  mediaUrl?: string;
  messageId?: string;
  profileName?: string;
}

export interface WhatsAppWebhookBatch {
  messages: NormalisedWhatsAppMessage[];
  /** Delivery receipts, used to reconcile outbound sends. */
  statuses: Array<{ messageId: string; status: string; recipient: string }>;
}

const isMetaEnvelope = (payload: unknown): boolean =>
  typeof payload === 'object' && payload !== null && Array.isArray((payload as { entry?: unknown }).entry);

/**
 * Accepts either Meta's envelope or the flat internal shape.
 *
 * The flat shape is kept so an existing relay (or a provider other than Meta)
 * keeps working without a migration — this endpoint predates the Cloud API
 * integration.
 */
export function normaliseWhatsAppWebhook(payload: unknown): WhatsAppWebhookBatch {
  if (!isMetaEnvelope(payload)) {
    const flat = z
      .object({
        from: z.string().trim().min(5).max(32),
        text: z.string().trim().max(4000).optional(),
        mediaUrl: z.string().url().max(512).optional(),
        messageId: z.string().trim().max(191).optional(),
        profileName: z.string().trim().max(128).optional(),
      })
      .safeParse(payload);
    return flat.success ? { messages: [flat.data], statuses: [] } : { messages: [], statuses: [] };
  }

  const parsed = metaWhatsAppEnvelopeSchema.safeParse(payload);
  if (!parsed.success) return { messages: [], statuses: [] };

  const messages: NormalisedWhatsAppMessage[] = [];
  const statuses: WhatsAppWebhookBatch['statuses'] = [];

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // wa_id -> display name, so a ticket shows "Sara" rather than a number.
      const profileNames = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        if (contact.wa_id && contact.profile?.name) profileNames.set(contact.wa_id, contact.profile.name);
      }

      for (const message of value.messages ?? []) {
        if (!message.from) continue;
        const media = message.image ?? message.document ?? message.audio ?? message.video;
        const text = message.text?.body ?? message.button?.text ?? media?.caption;

        messages.push({
          from: message.from,
          ...(text ? { text: text.slice(0, 4000) } : {}),
          // Cloud API returns a media *id* that must be exchanged for a
          // short-lived URL via the Graph API; it is not a fetchable URL.
          ...(media?.id ? { mediaUrl: `whatsapp-media:${media.id}` } : {}),
          ...(message.id ? { messageId: message.id.slice(0, 191) } : {}),
          ...(profileNames.get(message.from) ? { profileName: profileNames.get(message.from)!.slice(0, 128) } : {}),
        });
      }

      for (const status of value.statuses ?? []) {
        if (!status.id || !status.status) continue;
        statuses.push({ messageId: status.id, status: status.status, recipient: status.recipient_id ?? '' });
      }
    }
  }

  return { messages, statuses };
}
