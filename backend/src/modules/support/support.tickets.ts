import { execute, insertAndGetId, queryCount, queryOne, queryRows, type Row } from '../../db/query';
import { AppError, ErrorCode, badRequest, forbidden, notFound } from '../../core/errors';
import { uuid, randomHex } from '../../core/security/crypto';
import { eventBus } from '../../core/events/event-bus';
import { encodeCursor } from '../../core/http/pagination';
import { notifyUser } from '../notifications/notify';
import { emitToUser } from '../../realtime/socket';
import { loadEntitlements } from '../../middleware/entitlements';
import { hasPermission } from '../../middleware/authorize';
import type { AuthPrincipal } from '../../types/express';
import {
  canTransition,
  detectSensitiveIntent,
  parseStringArray,
  parseTags,
  slaMinutesFor,
  toDbPriority,
  toDbStatus,
  toPublicPriority,
  toPublicStatus,
  type DbPriority,
  type DbTicketStatus,
  type PublicPriority,
  type RelatedEntityType,
  type SupportChannel,
} from './support.types';
import {
  assertAgentCanAccessTicket,
  canManageTickets,
  canViewAnyTicket,
  departmentAllowedForAgent,
  isSupportAgent,
  loadAgentRoster,
  maskPii,
  requireSensitiveDepartmentAuth,
  requireStepUp,
  shouldExposeCustomerPii,
  shouldExposeFraudDetail,
  writeSupportAudit,
} from './support.authz';
import type { RelatedContextInput } from './support.schema';

const OPEN_STATUSES = ['new', 'open', 'pending_customer', 'pending_internal', 'on_hold', 'reopened'];

export interface CreateTicketInput extends Omit<
  RelatedContextInput,
  'countryId' | 'marketplaceId' | 'relatedEntityId' | 'listingId' | 'categoryId' | 'relatedEntityType'
> {
  subject: string;
  description?: string | null;
  priority?: string;
  channel?: SupportChannel;
  guestEmail?: string | null;
  guestName?: string | null;
  tags?: Record<string, unknown>;
  threadKey?: string | null;
  reuseOpen?: boolean;
  countryId?: number | null;
  marketplaceId?: number | null;
  relatedEntityId?: number | null;
  listingId?: number | null;
  categoryId?: number | null;
  relatedEntityType?: RelatedEntityType | null;
  /** Nested copy of the same related fields (AI / channel callers). */
  context?: RelatedContextInput;
}

function ticketContext(input: CreateTicketInput): RelatedContextInput {
  return {
    ...input.context,
    marketplaceCode: input.marketplaceCode ?? input.context?.marketplaceCode,
    marketplaceId: input.marketplaceId ?? input.context?.marketplaceId ?? undefined,
    categoryCode: input.categoryCode ?? input.context?.categoryCode,
    categoryId: input.categoryId ?? input.context?.categoryId ?? undefined,
    relatedEntityType: input.relatedEntityType ?? input.context?.relatedEntityType ?? undefined,
    relatedEntityId: input.relatedEntityId ?? input.context?.relatedEntityId ?? undefined,
    listingId: input.listingId ?? input.context?.listingId ?? undefined,
    listingUuid: input.listingUuid ?? input.context?.listingUuid,
    paymentId: input.paymentId ?? input.context?.paymentId,
    paymentUuid: input.paymentUuid ?? input.context?.paymentUuid,
    orderId: input.orderId ?? input.context?.orderId,
    orderUuid: input.orderUuid ?? input.context?.orderUuid,
    subscriptionId: input.subscriptionId ?? input.context?.subscriptionId,
    conversationUuid: input.conversationUuid ?? input.context?.conversationUuid,
    vehicleVin: input.vehicleVin ?? input.context?.vehicleVin,
    propertyId: input.propertyId ?? input.context?.propertyId,
    goldListingId: input.goldListingId ?? input.context?.goldListingId,
    language: input.language ?? input.context?.language,
    countryId: input.countryId ?? input.context?.countryId ?? undefined,
  };
}

async function marketplaceIdFromCode(code?: string | null): Promise<number | null> {
  if (!code) return null;
  const row = await queryOne<Row>('SELECT id FROM marketplaces WHERE code = ?', [code]);
  return row ? Number(row.id) : null;
}

async function resolveCategory(input: {
  categoryId?: number | null;
  categoryCode?: string | null;
  marketplaceId?: number | null;
  subject?: string;
  description?: string;
}): Promise<Row | null> {
  if (input.categoryId) {
    return queryOne<Row>('SELECT * FROM support_categories WHERE id = ? AND is_active = 1', [input.categoryId]);
  }
  if (input.categoryCode) {
    return queryOne<Row>('SELECT * FROM support_categories WHERE code = ? AND is_active = 1', [input.categoryCode]);
  }
  const blob = `${input.subject ?? ''} ${input.description ?? ''}`.toLowerCase();
  const guessed =
    /\b(refund|payment|invoice|billing|charge)\b/.test(blob)
      ? 'payments'
      : /\b(subscription|plan|quota)\b/.test(blob)
        ? 'subscriptions'
        : /\b(kyc|verif)\b/.test(blob)
          ? 'kyc'
          : /\b(fraud|scam|takeover)\b/.test(blob)
            ? 'fraud'
            : /\b(gold|hallmark|karat|certificate)\b/.test(blob)
              ? 'gold'
              : /\b(property|lease|rent|villa|apartment)\b/.test(blob)
                ? 'property'
                : /\b(vehicle|vin|car|dealer|import)\b/.test(blob)
                  ? 'vehicles'
                  : /\b(ad|campaign|sponsor)\b/.test(blob)
                    ? 'advertising'
                    : 'general';
  const byCode = await queryOne<Row>('SELECT * FROM support_categories WHERE code = ? AND is_active = 1', [guessed]);
  if (byCode) return byCode;
  if (input.marketplaceId) {
    return queryOne<Row>(
      'SELECT * FROM support_categories WHERE marketplace_id = ? AND parent_id IS NULL AND is_active = 1 ORDER BY sort_order LIMIT 1',
      [input.marketplaceId],
    );
  }
  return queryOne<Row>(`SELECT * FROM support_categories WHERE code = 'general' AND is_active = 1`);
}

function mergeTags(existing: Record<string, unknown>, extra?: Record<string, unknown>): Record<string, unknown> {
  return { ...existing, ...(extra ?? {}) };
}

function relatedFromContext(context?: RelatedContextInput): { type: RelatedEntityType | null; id: number | null } {
  if (!context) return { type: null, id: null };
  if (context.relatedEntityType && context.relatedEntityId) {
    return { type: context.relatedEntityType, id: context.relatedEntityId };
  }
  if (context.listingId) return { type: 'listing', id: context.listingId };
  if (context.paymentId) return { type: 'payment', id: context.paymentId };
  if (context.orderId) return { type: 'order', id: context.orderId };
  if (context.subscriptionId) return { type: 'subscription', id: context.subscriptionId };
  if (context.propertyId) return { type: 'property', id: context.propertyId };
  if (context.goldListingId) return { type: 'gold_listing', id: context.goldListingId };
  return { type: null, id: null };
}

async function resolveRelatedIds(context?: RelatedContextInput): Promise<{ type: RelatedEntityType | null; id: number | null }> {
  const direct = relatedFromContext(context);
  if (direct.id) return direct;
  if (!context) return direct;
  if (context.listingUuid) {
    const row = await queryOne<Row>('SELECT id FROM listings WHERE uuid = ?', [context.listingUuid]);
    if (row) return { type: 'listing', id: Number(row.id) };
  }
  if (context.paymentUuid) {
    const row = await queryOne<Row>('SELECT id FROM payment_intents WHERE uuid = ?', [context.paymentUuid]);
    if (row) return { type: 'payment', id: Number(row.id) };
  }
  if (context.orderUuid) {
    const row = await queryOne<Row>('SELECT id FROM orders WHERE uuid = ?', [context.orderUuid]);
    if (row) return { type: 'order', id: Number(row.id) };
  }
  if (context.conversationUuid) {
    const row = await queryOne<Row>('SELECT id FROM conversations WHERE uuid = ?', [context.conversationUuid]);
    if (row) return { type: 'conversation', id: Number(row.id) };
  }
  return direct;
}

export async function listCatalog(language?: string) {
  const categories = await queryRows<Row>(
    `SELECT id, code, name, description, parent_id, marketplace_id, default_priority,
            sla_first_response_minutes, sla_resolution_minutes, auto_assign_team, icon, sort_order
       FROM support_categories WHERE is_active = 1 ORDER BY sort_order, id`,
  );
  const departments = [...new Set(categories.map((row) => String(row.auto_assign_team || 'general')))];
  return {
    language: language ?? 'en',
    channels: ['in_app', 'live_chat', 'chatbot', 'email', 'phone', 'whatsapp', 'knowledge_base', 'forum'],
    departments: departments.map((code) => ({
      code,
      name: code.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()),
    })),
    categories: categories.map((row) => ({
      id: Number(row.id),
      code: String(row.code),
      name: String(row.name),
      description: (row.description as string | null) ?? null,
      parentId: row.parent_id === null ? null : Number(row.parent_id),
      marketplaceId: row.marketplace_id === null ? null : Number(row.marketplace_id),
      defaultPriority: toPublicPriority(String(row.default_priority)),
      department: (row.auto_assign_team as string | null) ?? 'general',
      slaFirstResponseMinutes: row.sla_first_response_minutes === null ? null : Number(row.sla_first_response_minutes),
      slaResolutionMinutes: row.sla_resolution_minutes === null ? null : Number(row.sla_resolution_minutes),
    })),
    statuses: [
      'NEW',
      'OPEN',
      'ASSIGNED',
      'IN_PROGRESS',
      'WAITING_FOR_CUSTOMER',
      'WAITING_INTERNAL',
      'RESOLVED',
      'CLOSED',
      'REOPENED',
    ],
    priorities: ['LOW', 'NORMAL', 'HIGH', 'URGENT', 'CRITICAL'],
  };
}

function mapTicket(row: Row, extra: Record<string, unknown> = {}) {
  const tags = parseTags(row.tags);
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    ticketNumber: String(row.ticket_number),
    subject: String(row.subject),
    status: toPublicStatus({
      status: String(row.status),
      assignedTo: row.assigned_to === null ? null : Number(row.assigned_to),
      firstResponseAt: (row.first_response_at as Date | null) ?? null,
    }),
    rawStatus: String(row.status),
    priority: toPublicPriority(String(row.priority), tags),
    categoryId: row.category_id === null ? null : Number(row.category_id),
    marketplaceId: row.marketplace_id === null ? null : Number(row.marketplace_id),
    channel: (row.channel as string | null) ?? 'in_app',
    assignedTo: row.assigned_to === null ? null : Number(row.assigned_to),
    department: (row.assigned_team as string | null) ?? null,
    relatedEntityType: (row.related_entity_type as string | null) ?? null,
    relatedEntityId: row.related_entity_id === null ? null : Number(row.related_entity_id),
    language: (row.language as string | null) ?? null,
    countryId: row.country_id === null ? null : Number(row.country_id),
    slaBreached: Boolean(row.sla_breached),
    reopenCount: Number(row.reopen_count ?? 0),
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
    resolvedAt: row.resolved_at ? (row.resolved_at as Date).toISOString() : null,
    closedAt: row.closed_at ? (row.closed_at as Date).toISOString() : null,
    firstResponseAt: row.first_response_at ? (row.first_response_at as Date).toISOString() : null,
    satisfactionRating: row.satisfaction_rating === null || row.satisfaction_rating === undefined ? null : Number(row.satisfaction_rating),
    ...extra,
  };
}

async function notifyTicket(userId: number | null, categoryCode: string, title: string, body: string, ticketUuid: string) {
  if (!userId) return;
  await notifyUser({
    userId,
    categoryCode,
    title,
    body,
    actionType: 'support',
    entityType: 'support',
    entityId: ticketUuid,
    deepLink: `/support/tickets/${ticketUuid}`,
    eventType: categoryCode,
  }).catch(() => undefined);
}

function emitTicket(userId: number | null | undefined, payload: Record<string, unknown>) {
  if (!userId) return;
  emitToUser(userId, 'ticket:updated', payload);
}

async function incrementAgentLoad(userId: number, delta: number) {
  await execute(
    `UPDATE support_agents
        SET current_ticket_count = GREATEST(0, current_ticket_count + ?)
      WHERE user_id = ?`,
    [delta, userId],
  ).catch(() => undefined);
}

export async function routeTicket(ticketId: number): Promise<{ assignedTo: number | null; department: string | null }> {
  const ticket = await queryOne<Row>(
    `SELECT t.*, c.auto_assign_team, c.marketplace_id AS cat_marketplace_id
       FROM support_tickets t
       LEFT JOIN support_categories c ON c.id = t.category_id
      WHERE t.id = ?`,
    [ticketId],
  );
  if (!ticket) return { assignedTo: null, department: null };

  const department = String(ticket.assigned_team || ticket.auto_assign_team || 'general');
  const language = (ticket.language as string | null) ?? 'en';
  const marketplaceId = ticket.marketplace_id === null ? null : Number(ticket.marketplace_id);

  const agents = await queryRows<Row>(
    `SELECT user_id, teams, languages, marketplaces, current_ticket_count, max_concurrent_tickets
       FROM support_agents
      WHERE is_active = 1 AND status = 'available' AND current_ticket_count < max_concurrent_tickets
      ORDER BY current_ticket_count ASC, avg_resolution_minutes IS NULL, avg_resolution_minutes ASC
      LIMIT 25`,
  );

  const match = agents.find((agent) => {
    const teamsArr = parseStringArray(agent.teams);
    if (teamsArr.length > 0 && !teamsArr.includes(department)) return false;
    const languages = parseStringArray(agent.languages);
    if (languages.length > 0 && !languages.includes(language) && !languages.includes(language.split('-')[0]!)) return false;
    const marketplaces = parseStringArray(agent.marketplaces).map(Number);
    if (marketplaceId && marketplaces.length > 0 && !marketplaces.includes(marketplaceId)) return false;
    return true;
  });

  if (!match) {
    await execute(`UPDATE support_tickets SET assigned_team = ? WHERE id = ?`, [department, ticketId]);
    return { assignedTo: null, department };
  }

  const agentId = Number(match.user_id);
  await execute(
    `UPDATE support_tickets SET assigned_to = ?, assigned_team = ?, status = IF(status = 'new', 'open', status) WHERE id = ?`,
    [agentId, department, ticketId],
  );
  await incrementAgentLoad(agentId, 1);
  await execute(
    `INSERT INTO support_ticket_messages (ticket_id, author_kind, body, is_internal_note)
     VALUES (?, 'system', ?, 1)`,
    [ticketId, `Routed to department ${department} and assigned to agent ${agentId}.`],
  );
  return { assignedTo: agentId, department };
}

async function findReusableTicket(params: {
  userId?: number | null;
  guestEmail?: string | null;
  threadKey?: string | null;
  relatedType?: string | null;
  relatedId?: number | null;
  channel?: string;
}): Promise<Row | null> {
  if (params.threadKey) {
    const byThread = await queryOne<Row>(
      `SELECT * FROM support_tickets
        WHERE JSON_UNQUOTE(JSON_EXTRACT(tags, '$.threadKey')) = ?
          AND status IN ('new','open','pending_customer','pending_internal','on_hold','reopened')
        ORDER BY updated_at DESC LIMIT 1`,
      [params.threadKey],
    );
    if (byThread) return byThread;
  }
  if (params.userId && params.relatedType && params.relatedId) {
    return queryOne<Row>(
      `SELECT * FROM support_tickets
        WHERE user_id = ? AND related_entity_type = ? AND related_entity_id = ?
          AND status IN ('new','open','pending_customer','pending_internal','on_hold','reopened')
        ORDER BY updated_at DESC LIMIT 1`,
      [params.userId, params.relatedType, params.relatedId],
    );
  }
  if (params.guestEmail && params.channel) {
    return queryOne<Row>(
      `SELECT * FROM support_tickets
        WHERE guest_email = ? AND channel = ?
          AND status IN ('new','open','pending_customer','pending_internal','on_hold','reopened')
        ORDER BY updated_at DESC LIMIT 1`,
      [params.guestEmail, params.channel],
    );
  }
  return null;
}

/**
 * Unified case ingest. Same customer moving AI → live chat → email must not
 * spawn unrelated tickets when a thread key or related entity already exists.
 */
export async function ingestCase(userId: number | null, input: CreateTicketInput) {
  const ctx = ticketContext(input);
  const marketplaceId = input.marketplaceId ?? ctx.marketplaceId ?? (await marketplaceIdFromCode(input.marketplaceCode ?? ctx.marketplaceCode));
  const related = await resolveRelatedIds(ctx);
  const relatedType = (input.relatedEntityType as RelatedEntityType | null) ?? related.type;
  const relatedId = input.relatedEntityId ?? related.id;
  const existing =
    input.reuseOpen === false
      ? null
      : await findReusableTicket({
          userId,
          guestEmail: input.guestEmail ?? null,
          threadKey: input.threadKey ?? null,
          relatedType,
          relatedId,
          channel: input.channel,
        });
  if (existing) {
    if (input.description) {
      await execute(
        `INSERT INTO support_ticket_messages (ticket_id, author_id, author_kind, body, channel)
         VALUES (?, ?, ?, ?, ?)`,
        [existing.id, userId, userId ? 'customer' : 'system', input.description, input.channel ?? existing.channel],
      );
      await execute(`UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [existing.id]);
    }
    return mapTicket(existing, { reused: true });
  }
  return createTicket(
    userId ?? 0,
    {
      ...input,
      marketplaceId: marketplaceId ?? undefined,
      relatedEntityType: relatedType ?? undefined,
      relatedEntityId: relatedId ?? undefined,
    },
    { allowGuest: !userId },
  );
}

export async function createTicket(
  userId: number,
  input: CreateTicketInput,
  options: { allowGuest?: boolean } = {},
) {
  const ctx = ticketContext(input);
  const marketplaceId = input.marketplaceId ?? ctx.marketplaceId ?? (await marketplaceIdFromCode(input.marketplaceCode ?? ctx.marketplaceCode));
  const related = await resolveRelatedIds(ctx);
  const category = await resolveCategory({
    categoryId: input.categoryId ?? ctx.categoryId,
    categoryCode: input.categoryCode ?? ctx.categoryCode,
    marketplaceId,
    subject: input.subject,
    description: input.description ?? undefined,
  });

  const requested = toDbPriority(input.priority ?? String(category?.default_priority ?? 'normal'));
  const channel: SupportChannel = input.channel ?? 'in_app';
  const intent = detectSensitiveIntent(`${input.subject} ${input.description ?? ''}`);
  const department = String(category?.auto_assign_team || 'general');
  const tags = mergeTags(input.tags ?? {}, {
    intent,
    threadKey: input.threadKey ?? null,
    severity: requested.critical ? 'critical' : undefined,
    context: ctx,
  });

  const ticketUuid = uuid();
  const ticketNumber = `SUP-${new Date().getFullYear()}-${randomHex(3).toUpperCase()}`;
  const ownerId = userId > 0 ? userId : null;
  if (!ownerId && !options.allowGuest) throw forbidden('Sign in to open a ticket');

  const id = await insertAndGetId(
    `INSERT INTO support_tickets
       (uuid, ticket_number, user_id, guest_email, guest_name, category_id, marketplace_id, subject, description,
        channel, priority, status, assigned_team, related_entity_type, related_entity_id, language, country_id, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)`,
    [
      ticketUuid,
      ticketNumber,
      ownerId,
      input.guestEmail ?? null,
      input.guestName ?? null,
      category ? Number(category.id) : null,
      marketplaceId,
      input.subject,
      input.description ?? null,
      channel,
      requested.priority,
      department,
      (input.relatedEntityType as string | null) ?? related.type,
      input.relatedEntityId ?? related.id,
      input.language ?? ctx.language ?? null,
      input.countryId ?? ctx.countryId ?? null,
      JSON.stringify(tags),
    ],
  );

  if (input.description) {
    await execute(
      `INSERT INTO support_ticket_messages (ticket_id, author_id, author_kind, body, channel)
       VALUES (?, ?, ?, ?, ?)`,
      [id, ownerId, ownerId ? 'customer' : 'system', input.description, channel],
    );
  }

  const routed = await routeTicket(id);
  const row = await queryOne<Row>('SELECT * FROM support_tickets WHERE id = ?', [id]);
  const mapped = mapTicket(row!);

  const event = await eventBus.enqueueNow('ticket.created', 'support_ticket', id, {
    ticketId: id,
    userId: ownerId,
    priority: requested.priority,
    categoryId: category ? Number(category.id) : null,
  });
  void eventBus.publishAfterCommit(event);

  await notifyTicket(ownerId, 'support.ticket_created', 'Support ticket opened', `${ticketNumber}: ${input.subject}`, ticketUuid);
  if (routed.assignedTo) {
    await notifyTicket(
      routed.assignedTo,
      'support.agent_assigned',
      'Ticket assigned to you',
      `${ticketNumber}: ${input.subject}`,
      ticketUuid,
    );
    emitTicket(routed.assignedTo, { uuid: ticketUuid, status: mapped.status });
  }
  emitTicket(ownerId, { uuid: ticketUuid, status: mapped.status });
  await writeSupportAudit({ actorId: ownerId, action: 'ticket.created', entityId: ticketUuid, after: { department: routed.department, intent } });
  return mapped;
}

export async function listTickets(
  userId: number,
  query: { page?: number; perPage?: number; cursor?: string; status?: string; priority?: string; marketplaceId?: number; categoryId?: number } = {},
) {
  const perPage = Math.min(query.perPage ?? 20, 50);
  const page = query.page ?? 1;
  const filters: string[] = ['user_id = ?'];
  const params: unknown[] = [userId];
  if (query.status) {
    filters.push('status = ?');
    params.push(toDbStatus(query.status));
  }
  if (query.marketplaceId) {
    filters.push('marketplace_id = ?');
    params.push(query.marketplaceId);
  }
  if (query.categoryId) {
    filters.push('category_id = ?');
    params.push(query.categoryId);
  }
  const where = `WHERE ${filters.join(' AND ')}`;
  const total = await queryCount(`SELECT COUNT(*) FROM support_tickets ${where}`, params);
  const rows = await queryRows<Row>(
    `SELECT id, uuid, ticket_number, subject, status, priority, category_id, marketplace_id, channel,
            assigned_to, assigned_team, related_entity_type, related_entity_id, tags,
            sla_breached, reopen_count, created_at, updated_at, resolved_at, closed_at, first_response_at, satisfaction_rating
       FROM support_tickets ${where}
      ORDER BY updated_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage],
  );
  const items = rows.map((row) => mapTicket(row));
  const last = rows[rows.length - 1];
  return {
    items,
    total,
    page,
    perPage,
    nextCursor: last ? encodeCursor({ id: Number(last.id), value: (last.updated_at as Date).toISOString() }) : null,
    hasMore: page * perPage < total,
  };
}

async function loadTicketRow(ticketUuid: string): Promise<Row> {
  const row = await queryOne<Row>('SELECT * FROM support_tickets WHERE uuid = ?', [ticketUuid]);
  if (!row) throw notFound('Ticket');
  return row;
}

export async function getTicket(userId: number, ticketUuid: string, asAgent = false) {
  const row = await loadTicketRow(ticketUuid);
  if (!asAgent && Number(row.user_id) !== userId) throw forbidden('Not your ticket');

  const messages = await queryRows<Row>(
    `SELECT id, author_kind, author_id, body, is_internal_note, channel, created_at
       FROM support_ticket_messages
      WHERE ticket_id = ? AND is_internal_note = 0
      ORDER BY id ASC
      LIMIT 200`,
    [row.id],
  );
  const attachments = await queryRows<Row>(
    `SELECT id, file_url, file_name, mime_type, size_bytes, created_at
       FROM support_ticket_attachments WHERE ticket_id = ? ORDER BY id DESC LIMIT 50`,
    [row.id],
  );

  return {
    ...mapTicket(row),
    description: (row.description as string | null) ?? null,
    satisfactionComment: (row.satisfaction_comment as string | null) ?? null,
    messages: messages.map((msg) => ({
      id: Number(msg.id),
      authorKind: String(msg.author_kind),
      authorId: msg.author_id === null ? null : Number(msg.author_id),
      body: String(msg.body),
      channel: (msg.channel as string | null) ?? null,
      createdAt: (msg.created_at as Date).toISOString(),
    })),
    attachments: attachments.map((item) => ({
      id: Number(item.id),
      fileUrl: String(item.file_url),
      fileName: (item.file_name as string | null) ?? null,
      mimeType: (item.mime_type as string | null) ?? null,
      sizeBytes: item.size_bytes === null ? null : Number(item.size_bytes),
      createdAt: (item.created_at as Date).toISOString(),
    })),
  };
}

export async function getAgentTicket(auth: AuthPrincipal, ticketUuid: string) {
  const row = await loadTicketRow(ticketUuid);
  const roster = await loadAgentRoster(auth.userId);
  assertAgentCanAccessTicket(auth, row, roster);
  await writeSupportAudit({ actorId: auth.userId, action: 'ticket.viewed', entityId: ticketUuid, permission: 'ticket.view_any' });

  const includeInternal = true;
  const messages = await queryRows<Row>(
    `SELECT id, author_kind, author_id, body, is_internal_note, channel, created_at
       FROM support_ticket_messages
      WHERE ticket_id = ? ${includeInternal ? '' : 'AND is_internal_note = 0'}
      ORDER BY id ASC LIMIT 300`,
    [row.id],
  );

  const exposePii = shouldExposeCustomerPii(auth, row.assigned_to === null ? null : Number(row.assigned_to));
  let customer: Record<string, unknown> | null = null;
  if (row.user_id) {
    const user = await queryOne<Row>(
      `SELECT u.id, u.uuid, u.email, u.phone_e164, u.username, p.display_name
         FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`,
      [row.user_id],
    );
    if (user) {
      customer = {
        id: Number(user.id),
        uuid: String(user.uuid),
        username: (user.username as string | null) ?? null,
        displayName: (user.display_name as string | null) ?? null,
        email: exposePii ? (user.email as string | null) : maskPii(user.email as string | null),
        phone: exposePii ? (user.phone_e164 as string | null) : maskPii(user.phone_e164 as string | null),
      };
    }
  }

  let risk: Record<string, unknown> | null = null;
  if (row.user_id) {
    const score = await queryOne<Row>(
      `SELECT score, band, signal_count FROM risk_scores WHERE subject_kind = 'user' AND subject_id = ?`,
      [row.user_id],
    );
    if (score) {
      risk = shouldExposeFraudDetail(auth)
        ? { band: String(score.band), score: Number(score.score), signalCount: Number(score.signal_count) }
        : { band: String(score.band), restricted: true };
    }
  }

  return {
    ...mapTicket(row),
    description: (row.description as string | null) ?? null,
    guestEmail: exposePii ? (row.guest_email as string | null) : maskPii(row.guest_email as string | null),
    guestName: (row.guest_name as string | null) ?? null,
    tags: parseTags(row.tags),
    customer,
    risk,
    messages: messages.map((msg) => ({
      id: Number(msg.id),
      authorKind: String(msg.author_kind),
      authorId: msg.author_id === null ? null : Number(msg.author_id),
      body: String(msg.body),
      internal: Boolean(msg.is_internal_note),
      channel: (msg.channel as string | null) ?? null,
      createdAt: (msg.created_at as Date).toISOString(),
    })),
  };
}

export async function replyToTicket(userId: number, ticketUuid: string, body: string, channel?: SupportChannel) {
  const ticket = await loadTicketRow(ticketUuid);
  if (Number(ticket.user_id) !== userId) throw forbidden('Not your ticket');
  if (['closed'].includes(String(ticket.status))) {
    throw new AppError('This ticket is closed. Reopen it to reply.', {
      status: 409,
      code: ErrorCode.INVALID_STATE_TRANSITION,
      expected: true,
    });
  }

  const messageId = await insertAndGetId(
    `INSERT INTO support_ticket_messages (ticket_id, author_kind, author_id, body, channel)
     VALUES (?, 'customer', ?, ?, ?)`,
    [ticket.id, userId, body, channel ?? ticket.channel],
  );

  if (ticket.status === 'pending_customer' || ticket.status === 'resolved') {
    await execute(`UPDATE support_tickets SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [ticket.id]);
  }

  const event = await eventBus.enqueueNow('ticket.replied', 'support_ticket', Number(ticket.id), {
    ticketId: Number(ticket.id),
    authorKind: 'customer',
    messageId,
  });
  void eventBus.publishAfterCommit(event);
  if (ticket.assigned_to) {
    await notifyTicket(Number(ticket.assigned_to), 'support.customer_replied', 'Customer replied', String(ticket.ticket_number), ticketUuid);
    emitTicket(Number(ticket.assigned_to), { uuid: ticketUuid, event: 'customer_replied' });
  }
  return getTicket(userId, ticketUuid);
}

export async function agentReply(auth: AuthPrincipal, ticketUuid: string, body: string, internal = false) {
  const ticket = await loadTicketRow(ticketUuid);
  const roster = await loadAgentRoster(auth.userId);
  assertAgentCanAccessTicket(auth, ticket, roster);

  await insertAndGetId(
    `INSERT INTO support_ticket_messages (ticket_id, author_id, author_kind, body, is_internal_note)
     VALUES (?, ?, 'agent', ?, ?)`,
    [ticket.id, auth.userId, body, internal ? 1 : 0],
  );

  if (!internal) {
    await execute(
      `UPDATE support_tickets
          SET status = IF(status IN ('new','reopened'), 'open', status),
              first_response_at = COALESCE(first_response_at, CURRENT_TIMESTAMP)
        WHERE id = ?`,
      [ticket.id],
    );
    if (ticket.user_id) {
      await notifyTicket(Number(ticket.user_id), 'support.agent_replied', 'Support replied', String(ticket.ticket_number), ticketUuid);
      emitTicket(Number(ticket.user_id), { uuid: ticketUuid, event: 'agent_replied' });
    }
  }
  await writeSupportAudit({
    actorId: auth.userId,
    action: internal ? 'ticket.internal_note' : 'ticket.agent_replied',
    entityId: ticketUuid,
    permission: 'ticket.update',
  });
  return getAgentTicket(auth, ticketUuid);
}

export async function changeStatus(auth: AuthPrincipal, ticketUuid: string, publicStatus: string, reason?: string) {
  const ticket = await loadTicketRow(ticketUuid);
  const isOwner = Number(ticket.user_id) === auth.userId;
  const agent = isSupportAgent(auth);
  if (!isOwner && !agent) throw forbidden('Not your ticket');

  const next = toDbStatus(publicStatus);
  if (!canTransition(String(ticket.status), next)) {
    throw new AppError(`Cannot change ticket from ${ticket.status} to ${next}`, {
      status: 409,
      code: ErrorCode.INVALID_STATE_TRANSITION,
      expected: true,
    });
  }
  if (agent) {
    const roster = await loadAgentRoster(auth.userId);
    assertAgentCanAccessTicket(auth, ticket, roster);
    const category = ticket.category_id
      ? await queryOne<Row>('SELECT code, auto_assign_team FROM support_categories WHERE id = ?', [ticket.category_id])
      : null;
    requireSensitiveDepartmentAuth(auth, (ticket.assigned_team as string | null) ?? (category?.auto_assign_team as string | null), category?.code as string);
  } else if (!['reopened', 'closed'].includes(next)) {
    throw forbidden('Customers can only reopen or close their tickets');
  }

  const nowBits: string[] = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
  const params: unknown[] = [next];
  if (next === 'resolved') nowBits.push('resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)');
  if (next === 'closed') nowBits.push('closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP)');
  if (next === 'reopened') {
    nowBits.push('reopen_count = reopen_count + 1');
    nowBits.push('resolved_at = NULL');
    nowBits.push('closed_at = NULL');
  }
  await execute(`UPDATE support_tickets SET ${nowBits.join(', ')} WHERE id = ?`, [...params, ticket.id]);
  await execute(
    `INSERT INTO support_ticket_messages (ticket_id, author_id, author_kind, body, is_internal_note)
     VALUES (?, ?, 'system', ?, 1)`,
    [ticket.id, auth.userId, `Status changed to ${next}${reason ? `: ${reason}` : ''}`],
  );

  if (next === 'resolved') {
    const event = await eventBus.enqueueNow('ticket.resolved', 'support_ticket', Number(ticket.id), {
      ticketId: Number(ticket.id),
      resolvedBy: auth.userId,
      satisfactionRating: null,
    });
    void eventBus.publishAfterCommit(event);
    if (ticket.user_id) {
      await notifyTicket(Number(ticket.user_id), 'support.ticket_resolved', 'Ticket resolved', String(ticket.ticket_number), ticketUuid);
    }
    if (ticket.assigned_to) await incrementAgentLoad(Number(ticket.assigned_to), -1);
  }
  if (next === 'reopened' && ticket.user_id) {
    await notifyTicket(Number(ticket.user_id), 'support.ticket_reopened', 'Ticket reopened', String(ticket.ticket_number), ticketUuid);
  }

  await writeSupportAudit({
    actorId: auth.userId,
    action: 'ticket.status_changed',
    entityId: ticketUuid,
    permission: agent ? 'ticket.update' : 'ticket.view',
    reason: reason ?? null,
    before: { status: ticket.status },
    after: { status: next },
  });
  emitTicket(ticket.user_id ? Number(ticket.user_id) : null, { uuid: ticketUuid, status: publicStatus });
  return agent ? getAgentTicket(auth, ticketUuid) : getTicket(auth.userId, ticketUuid);
}

export async function assignTicket(
  auth: AuthPrincipal,
  ticketUuid: string,
  input: { assignedTo?: number; assignedTeam?: string; status?: string; priority?: string; note?: string },
) {
  if (!hasPermission(auth.permissions, 'ticket.update') && !canManageTickets(auth)) {
    throw forbidden('Cannot assign tickets');
  }
  const ticket = await loadTicketRow(ticketUuid);
  const nextStatus = input.status ? toDbStatus(input.status) : undefined;
  if (nextStatus && !canTransition(String(ticket.status), nextStatus)) {
    throw new AppError(`Cannot change ticket from ${ticket.status} to ${nextStatus}`, {
      status: 409,
      code: ErrorCode.INVALID_STATE_TRANSITION,
      expected: true,
    });
  }
  const nextPriority = input.priority ? toDbPriority(input.priority) : null;
  const previousAssignee = ticket.assigned_to === null ? null : Number(ticket.assigned_to);

  await execute(
    `UPDATE support_tickets
        SET assigned_to = COALESCE(?, assigned_to),
            assigned_team = COALESCE(?, assigned_team),
            status = COALESCE(?, status),
            priority = COALESCE(?, priority)
      WHERE id = ?`,
    [
      input.assignedTo ?? null,
      input.assignedTeam ?? null,
      nextStatus ?? null,
      nextPriority?.priority ?? null,
      ticket.id,
    ],
  );
  if (nextPriority?.critical) {
    const tags = parseTags(ticket.tags);
    tags.severity = 'critical';
    await execute(`UPDATE support_tickets SET tags = ? WHERE id = ?`, [JSON.stringify(tags), ticket.id]);
  }
  if (input.assignedTo && input.assignedTo !== previousAssignee) {
    if (previousAssignee) await incrementAgentLoad(previousAssignee, -1);
    await incrementAgentLoad(input.assignedTo, 1);
    await notifyTicket(input.assignedTo, 'support.agent_assigned', 'Ticket assigned to you', String(ticket.ticket_number), ticketUuid);
  }
  if (input.note) {
    await execute(
      `INSERT INTO support_ticket_messages (ticket_id, author_id, author_kind, body, is_internal_note)
       VALUES (?, ?, 'agent', ?, 1)`,
      [ticket.id, auth.userId, input.note],
    );
  }
  await writeSupportAudit({
    actorId: auth.userId,
    action: 'ticket.assigned',
    entityId: ticketUuid,
    permission: 'ticket.update',
    after: input,
  });
  return getAgentTicket(auth, ticketUuid);
}

export async function addAttachment(
  userId: number,
  ticketUuid: string,
  input: { fileUrl: string; fileName?: string; mimeType?: string; sizeBytes?: number },
  asAgent = false,
) {
  const ticket = await loadTicketRow(ticketUuid);
  if (!asAgent && Number(ticket.user_id) !== userId) throw forbidden('Not your ticket');
  const allowed = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'video/mp4',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  if (input.mimeType && !allowed.includes(input.mimeType)) {
    throw badRequest('This file type is not accepted on support tickets');
  }
  if ((input.sizeBytes ?? 0) > 25 * 1024 * 1024) throw badRequest('Attachment is too large');
  const id = await insertAndGetId(
    `INSERT INTO support_ticket_attachments (ticket_id, file_url, file_name, mime_type, size_bytes, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ticket.id, input.fileUrl, input.fileName ?? null, input.mimeType ?? null, input.sizeBytes ?? null, userId],
  );
  return { id, fileUrl: input.fileUrl };
}

export async function submitFeedback(userId: number, ticketUuid: string, rating: number, comment?: string) {
  const ticket = await loadTicketRow(ticketUuid);
  if (Number(ticket.user_id) !== userId) throw forbidden('Not your ticket');
  if (!['resolved', 'closed'].includes(String(ticket.status))) {
    throw badRequest('Feedback is collected after the ticket is resolved');
  }
  await execute(
    `UPDATE support_tickets SET satisfaction_rating = ?, satisfaction_comment = ? WHERE id = ?`,
    [rating, comment ?? null, ticket.id],
  );
  if (ticket.assigned_to) {
    await execute(
      `UPDATE support_agents
          SET satisfaction_avg = (
            SELECT AVG(satisfaction_rating) FROM support_tickets
             WHERE assigned_to = ? AND satisfaction_rating IS NOT NULL
          )
        WHERE user_id = ?`,
      [ticket.assigned_to, ticket.assigned_to],
    ).catch(() => undefined);
  }
  return getTicket(userId, ticketUuid);
}

export async function listAgentQueue(
  auth: AuthPrincipal,
  query: {
    page?: number;
    perPage?: number;
    status?: string;
    priority?: string;
    department?: string;
    assignedTo?: 'me' | 'unassigned' | number;
    marketplaceId?: number;
    countryId?: number;
    q?: string;
  },
) {
  if (!canViewAnyTicket(auth) && !isSupportAgent(auth)) throw forbidden('Not a support agent');
  const roster = await loadAgentRoster(auth.userId);
  const perPage = Math.min(query.perPage ?? 20, 50);
  const page = query.page ?? 1;
  const filters: string[] = ['1=1'];
  const params: unknown[] = [];
  if (query.status) {
    filters.push('t.status = ?');
    params.push(toDbStatus(query.status));
  } else {
    filters.push(`t.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`);
    params.push(...OPEN_STATUSES);
  }
  if (query.department) {
    if (!departmentAllowedForAgent(roster, query.department) && !canManageTickets(auth)) {
      throw forbidden('Outside your department');
    }
    filters.push('t.assigned_team = ?');
    params.push(query.department);
  }
  if (query.assignedTo === 'me') {
    filters.push('t.assigned_to = ?');
    params.push(auth.userId);
  } else if (query.assignedTo === 'unassigned') {
    filters.push('t.assigned_to IS NULL');
  } else if (typeof query.assignedTo === 'number') {
    filters.push('t.assigned_to = ?');
    params.push(query.assignedTo);
  }
  if (query.marketplaceId) {
    filters.push('t.marketplace_id = ?');
    params.push(query.marketplaceId);
  }
  if (query.countryId) {
    filters.push('t.country_id = ?');
    params.push(query.countryId);
  }
  if (query.q) {
    const like = `%${query.q.replace(/[\\%_]/g, '')}%`;
    filters.push('(t.subject LIKE ? OR t.ticket_number LIKE ?)');
    params.push(like, like);
  }
  const where = `WHERE ${filters.join(' AND ')}`;
  const total = await queryCount(`SELECT COUNT(*) FROM support_tickets t ${where}`, params);
  const rows = await queryRows<Row>(
    `SELECT t.id, t.uuid, t.ticket_number, t.subject, t.status, t.priority, t.assigned_to, t.assigned_team,
            t.user_id, t.marketplace_id, t.category_id, t.channel, t.sla_breached, t.tags,
            t.created_at, t.updated_at, t.first_response_at
       FROM support_tickets t ${where}
      ORDER BY t.sla_breached DESC, FIELD(t.priority,'urgent','high','normal','low'), t.created_at ASC
      LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage],
  );
  return {
    items: rows.map((row) => mapTicket(row)),
    total,
    page,
    perPage,
    hasMore: page * perPage < total,
  };
}

export async function setAgentPresence(userId: number, status: 'available' | 'busy' | 'away' | 'offline') {
  await execute(
    `INSERT INTO support_agents (user_id, status, is_active)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE status = VALUES(status), is_active = 1`,
    [userId, status],
  );
  return { status };
}

export async function listMacros(language = 'en') {
  const rows = await queryRows<Row>(
    `SELECT id, code, title, body, language, category_id, usage_count
       FROM support_canned_responses WHERE is_active = 1 AND language IN (?, 'en')
       ORDER BY usage_count DESC LIMIT 100`,
    [language],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    code: String(row.code),
    title: String(row.title),
    body: String(row.body),
    language: String(row.language),
    categoryId: row.category_id === null ? null : Number(row.category_id),
  }));
}

export async function slaSnapshot(ticket: Row, userId: number | null) {
  const category = ticket.category_id
    ? await queryOne<Row>(
        'SELECT sla_first_response_minutes, sla_resolution_minutes FROM support_categories WHERE id = ?',
        [ticket.category_id],
      )
    : null;
  let hasPriority = false;
  let hasDedicated = false;
  if (userId) {
    const entitlements = await loadEntitlements(userId).catch(() => null);
    hasPriority = Boolean(entitlements?.features.priority_support?.enabled);
    hasDedicated = Boolean(entitlements?.features.dedicated_support?.enabled);
  }
  const priority = String(ticket.priority) as DbPriority;
  const tags = parseTags(ticket.tags);
  return {
    firstResponseMinutes: slaMinutesFor({
      baseMinutes: category?.sla_first_response_minutes === null ? 240 : Number(category?.sla_first_response_minutes ?? 240),
      priority,
      critical: tags.severity === 'critical',
      hasPrioritySupport: hasPriority,
      hasDedicatedSupport: hasDedicated,
    }),
    resolutionMinutes: slaMinutesFor({
      baseMinutes: category?.sla_resolution_minutes === null ? 1440 : Number(category?.sla_resolution_minutes ?? 1440),
      priority,
      critical: tags.severity === 'critical',
      hasPrioritySupport: hasPriority,
      hasDedicatedSupport: hasDedicated,
    }),
  };
}

export { mapTicket, loadTicketRow, OPEN_STATUSES };
export type { DbTicketStatus, PublicPriority };
