import { createHmac } from 'node:crypto';
import { execute, insertAndGetId, queryOne, type Row } from '../../db/query';
import { env } from '../../config/env';
import { safeEqual, uuid } from '../../core/security/crypto';
import { badRequest, forbidden } from '../../core/errors';
import { loggerFor } from '../../config/logger';
import { createTicket, ingestCase, loadTicketRow, replyToTicket } from './support.tickets';
import { ticketNumberFromSubject } from './support.types';

const log = loggerFor('support.channels');

function webhookSecret(): string | undefined {
  return env.SUPPORT_WEBHOOK_SECRET;
}

export function verifySupportWebhook(rawBody: string, signature: string | undefined): void {
  const secret = webhookSecret();
  if (!secret) {
    if (env.isProduction) throw forbidden('Support webhook secret is not configured');
    return;
  }
  if (!signature) throw forbidden('Missing webhook signature');
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signature.replace(/^sha256=/i, '');
  if (!safeEqual(expected, provided)) throw forbidden('Invalid webhook signature');
}

async function findUserByEmail(email: string): Promise<number | null> {
  const row = await queryOne<Row>('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL', [email.toLowerCase()]);
  return row ? Number(row.id) : null;
}

async function findUserByPhone(phone: string): Promise<number | null> {
  const digits = phone.replace(/[^\d+]/g, '');
  const row = await queryOne<Row>(
    `SELECT id FROM users WHERE phone_e164 = ? OR phone_e164 = CONCAT('+', ?) AND deleted_at IS NULL LIMIT 1`,
    [digits, digits.replace(/^\+/, '')],
  );
  return row ? Number(row.id) : null;
}

export async function ingestEmail(input: {
  from: string;
  to?: string;
  subject: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
}) {
  const body = (input.text || input.html || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 8000) || input.subject;
  const ticketNumber = ticketNumberFromSubject(input.subject);
  if (ticketNumber) {
    const existing = await queryOne<Row>('SELECT uuid, user_id FROM support_tickets WHERE ticket_number = ?', [ticketNumber]);
    if (existing) {
      const userId = existing.user_id ? Number(existing.user_id) : (await findUserByEmail(input.from)) ?? 0;
      if (userId > 0) await replyToTicket(userId, String(existing.uuid), body, 'email');
      else {
        const row = await loadTicketRow(String(existing.uuid));
        await execute(
          `INSERT INTO support_ticket_messages (ticket_id, author_kind, body, channel) VALUES (?, 'customer', ?, 'email')`,
          [row.id, body],
        );
      }
      return { ticketUuid: String(existing.uuid), reused: true, channel: 'email' };
    }
  }
  if (input.inReplyTo) {
    const byRef = await queryOne<Row>(
      `SELECT uuid FROM support_tickets WHERE JSON_UNQUOTE(JSON_EXTRACT(tags, '$.emailMessageId')) = ? LIMIT 1`,
      [input.inReplyTo],
    );
    if (byRef) {
      const userId = (await findUserByEmail(input.from)) ?? 0;
      if (userId) await replyToTicket(userId, String(byRef.uuid), body, 'email');
      return { ticketUuid: String(byRef.uuid), reused: true, channel: 'email' };
    }
  }

  const userId = await findUserByEmail(input.from);
  const ticket = await ingestCase(userId, {
    subject: input.subject.slice(0, 255),
    description: body,
    channel: 'email',
    guestEmail: userId ? null : input.from,
    guestName: input.from.split('@')[0],
    threadKey: input.messageId ?? `email:${input.from.toLowerCase()}`,
    tags: { emailMessageId: input.messageId ?? null, emailInReplyTo: input.inReplyTo ?? null },
    reuseOpen: true,
  });
  return { ticketUuid: ticket.uuid, reused: Boolean((ticket as { reused?: boolean }).reused), channel: 'email' };
}

export async function ingestWhatsApp(input: {
  from: string;
  text?: string;
  mediaUrl?: string;
  messageId?: string;
  profileName?: string;
}) {
  const body = (input.text || (input.mediaUrl ? `Media: ${input.mediaUrl}` : '')).trim();
  if (!body) throw badRequest('Empty WhatsApp message');
  const userId = await findUserByPhone(input.from);
  const ticket = await ingestCase(userId, {
    subject: `WhatsApp: ${(body || 'conversation').slice(0, 80)}`,
    description: body,
    channel: 'whatsapp',
    guestName: input.profileName ?? null,
    threadKey: `whatsapp:${input.from.replace(/\D/g, '')}`,
    tags: { whatsappFrom: input.from, whatsappMessageId: input.messageId ?? null },
    reuseOpen: true,
  });
  return { ticketUuid: ticket.uuid, reused: Boolean((ticket as { reused?: boolean }).reused), channel: 'whatsapp' };
}

export async function ingestPhone(input: {
  callId: string;
  from?: string;
  to?: string;
  agentId?: number;
  durationSeconds?: number;
  outcome?: string;
  recordingUrl?: string;
  consent?: boolean;
  ticketUuid?: string;
  notes?: string;
}) {
  const userId = input.from ? await findUserByPhone(input.from) : null;
  let ticketUuid = input.ticketUuid ?? null;
  if (!ticketUuid) {
    const ticket = await ingestCase(userId, {
      subject: `Phone call ${input.callId}`,
      description: input.notes || `Inbound call ${input.outcome ?? 'answered'} (${input.durationSeconds ?? 0}s)`,
      channel: 'phone',
      threadKey: `phone:${input.from ?? input.callId}`,
      tags: {
        callId: input.callId,
        outcome: input.outcome ?? null,
        durationSeconds: input.durationSeconds ?? null,
        recordingUrl: input.consent ? input.recordingUrl ?? null : null,
        recordingConsent: Boolean(input.consent),
      },
      reuseOpen: true,
    });
    ticketUuid = ticket.uuid;
  } else {
    const row = await loadTicketRow(ticketUuid);
    await execute(
      `INSERT INTO support_ticket_messages (ticket_id, author_id, author_kind, body, channel)
       VALUES (?, ?, 'system', ?, 'phone')`,
      [
        row.id,
        input.agentId ?? userId,
        `Call ${input.callId}: ${input.outcome ?? 'logged'} (${input.durationSeconds ?? 0}s)${input.notes ? ` — ${input.notes}` : ''}`,
      ],
    );
  }
  if (input.recordingUrl && !input.consent) {
    log.info({ callId: input.callId }, 'call recording omitted — no consent');
  }
  return {
    ticketUuid,
    callId: input.callId,
    recordingStored: Boolean(input.consent && input.recordingUrl),
    channel: 'phone',
  };
}

export async function ingestContactForm(input: {
  name: string;
  email: string;
  phone?: string;
  subject?: string;
  message: string;
  source?: string;
  countryId?: number | null;
  ip?: Buffer | null;
}) {
  const userId = await findUserByEmail(input.email);
  const ticket = await createTicket(userId ?? 0, {
    subject: input.subject || `Contact: ${input.name}`,
    description: input.message,
    channel: 'web_form',
    guestEmail: userId ? null : input.email,
    guestName: input.name,
    countryId: input.countryId ?? null,
  }, { allowGuest: true });

  await insertAndGetId(
    `INSERT INTO contact_submissions (name, email, phone, subject, message, country_id, source, status, ticket_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
    [
      input.name,
      input.email,
      input.phone ?? null,
      input.subject ?? null,
      input.message,
      input.countryId ?? null,
      input.source ?? 'web_form',
      ticket.id,
    ],
  ).catch(() => 0);

  return { ticketUuid: ticket.uuid, ticketNumber: ticket.ticketNumber };
}

export async function openSupportConversation(params: {
  userId: number;
  subject?: string;
  message?: string;
  ticketUuid?: string;
  marketplaceId?: number | null;
  listingId?: number | null;
}) {
  const { openListingConversation } = await import('../chat/chat.service');
  void openListingConversation;
  const existing = await queryOne<Row>(
    `SELECT c.uuid
       FROM conversations c
       JOIN conversation_participants p ON p.conversation_id = c.id AND p.user_id = ? AND p.left_at IS NULL
      WHERE c.conversation_type = 'support' AND c.status = 'active'
        AND JSON_UNQUOTE(JSON_EXTRACT(c.metadata, '$.ticketUuid')) = ?
      LIMIT 1`,
    [params.userId, params.ticketUuid ?? ''],
  ).catch(() => null);

  if (existing && params.ticketUuid) {
    return { conversationUuid: String(existing.uuid), ticketUuid: params.ticketUuid, reused: true };
  }

  const ticket = params.ticketUuid
    ? await loadTicketRow(params.ticketUuid)
    : null;
  const created =
    ticket ??
    (await (async () => {
      const mapped = await createTicket(params.userId, {
        subject: params.subject || 'Live chat with support',
        description: params.message ?? 'Live chat started',
        channel: 'live_chat',
        marketplaceId: params.marketplaceId ?? null,
        relatedEntityType: params.listingId ? 'listing' : undefined,
        relatedEntityId: params.listingId ?? undefined,
      });
      return loadTicketRow(mapped.uuid);
    })());

  const agentId = created.assigned_to === null ? null : Number(created.assigned_to);
  const conversationUuid = uuid();
  const conversationId = await insertAndGetId(
    `INSERT INTO conversations
       (uuid, marketplace_id, listing_id, kind, conversation_type, subject, created_by, status, metadata)
     VALUES (?, ?, ?, 'support', 'support', ?, ?, 'active', ?)`,
    [
      conversationUuid,
      created.marketplace_id ?? params.marketplaceId ?? null,
      params.listingId ?? null,
      String(created.subject).slice(0, 191),
      params.userId,
      JSON.stringify({ ticketUuid: String(created.uuid), ticketId: Number(created.id) }),
    ],
  );

  if (agentId) {
    await execute(
      `INSERT INTO conversation_participants (conversation_id, user_id, participant_role)
       VALUES (?, ?, 'member'), (?, ?, 'owner')`,
      [conversationId, params.userId, conversationId, agentId],
    );
  } else {
    await execute(
      `INSERT INTO conversation_participants (conversation_id, user_id, participant_role)
       VALUES (?, ?, 'member')`,
      [conversationId, params.userId],
    );
  }

  const tags = { ...(typeof created.tags === 'object' ? {} : {}), conversationUuid };
  try {
    const current = created.tags ? JSON.parse(typeof created.tags === 'string' ? created.tags : JSON.stringify(created.tags)) : {};
    await execute(`UPDATE support_tickets SET tags = ?, related_entity_type = 'conversation', related_entity_id = ? WHERE id = ?`, [
      JSON.stringify({ ...current, conversationUuid }),
      conversationId,
      created.id,
    ]);
    void tags;
  } catch {
    await execute(`UPDATE support_tickets SET related_entity_type = 'conversation', related_entity_id = ? WHERE id = ?`, [
      conversationId,
      created.id,
    ]);
  }

  return { conversationUuid, ticketUuid: String(created.uuid), reused: false };
}
