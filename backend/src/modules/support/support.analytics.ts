import { queryCount, queryOne, queryRows, type Row } from '../../db/query';
import { forbidden } from '../../core/errors';
import { remember } from '../../config/cache';
import { canViewAnyTicket, isSupportAgent } from './support.authz';
import type { AuthPrincipal } from '../../types/express';

const OPEN = `status IN ('new','open','pending_customer','pending_internal','on_hold','reopened')`;

export async function supportOverview(auth: AuthPrincipal) {
  if (!canViewAnyTicket(auth) && !isSupportAgent(auth)) throw forbidden('Not a support agent');
  return remember(`support:analytics:${auth.userId}:overview`, 60, async () => {
    const [total, open, pending, resolved, closed, reopened] = await Promise.all([
      queryCount(`SELECT COUNT(*) FROM support_tickets`),
      queryCount(`SELECT COUNT(*) FROM support_tickets WHERE ${OPEN}`),
      queryCount(`SELECT COUNT(*) FROM support_tickets WHERE status IN ('pending_customer','pending_internal','on_hold')`),
      queryCount(`SELECT COUNT(*) FROM support_tickets WHERE status = 'resolved'`),
      queryCount(`SELECT COUNT(*) FROM support_tickets WHERE status = 'closed'`),
      queryCount(`SELECT COUNT(*) FROM support_tickets WHERE status = 'reopened'`),
    ]);

    const frt = await queryOne<Row>(
      `SELECT AVG(TIMESTAMPDIFF(MINUTE, created_at, first_response_at)) AS minutes
         FROM support_tickets WHERE first_response_at IS NOT NULL`,
    );
    const rt = await queryOne<Row>(
      `SELECT AVG(TIMESTAMPDIFF(MINUTE, created_at, resolved_at)) AS minutes
         FROM support_tickets WHERE resolved_at IS NOT NULL`,
    );
    const csat = await queryOne<Row>(
      `SELECT AVG(satisfaction_rating) AS rating, COUNT(satisfaction_rating) AS n
         FROM support_tickets WHERE satisfaction_rating IS NOT NULL`,
    );
    const ai = await queryOne<Row>(
      `SELECT
          SUM(channel = 'chatbot') AS ai_tickets,
          SUM(channel = 'chatbot' AND status IN ('resolved','closed') AND assigned_to IS NULL) AS ai_resolved,
          SUM(chatbot_session_id IS NOT NULL AND assigned_to IS NOT NULL) AS escalated
         FROM support_tickets`,
    );
    const reopenRate = total > 0 ? reopened / total : 0;
    const aiTickets = Number(ai?.ai_tickets ?? 0);
    const aiResolved = Number(ai?.ai_resolved ?? 0);
    const escalated = Number(ai?.escalated ?? 0);

    const byCountry = await queryRows<Row>(
      `SELECT COALESCE(c.iso2, 'UN') AS country, COUNT(*) AS c
         FROM support_tickets t LEFT JOIN countries c ON c.id = t.country_id
        GROUP BY country ORDER BY c DESC LIMIT 20`,
    );
    const byMarketplace = await queryRows<Row>(
      `SELECT COALESCE(m.code, 'general') AS marketplace, COUNT(*) AS c
         FROM support_tickets t LEFT JOIN marketplaces m ON m.id = t.marketplace_id
        GROUP BY marketplace ORDER BY c DESC`,
    );
    const byCategory = await queryRows<Row>(
      `SELECT COALESCE(sc.code, 'uncategorized') AS category, COUNT(*) AS c
         FROM support_tickets t LEFT JOIN support_categories sc ON sc.id = t.category_id
        GROUP BY category ORDER BY c DESC LIMIT 20`,
    );
    const byDepartment = await queryRows<Row>(
      `SELECT COALESCE(assigned_team, 'general') AS department, COUNT(*) AS c
         FROM support_tickets GROUP BY department ORDER BY c DESC`,
    );
    const byAgent = await queryRows<Row>(
      `SELECT assigned_to AS agentId, COUNT(*) AS c, AVG(satisfaction_rating) AS csat
         FROM support_tickets WHERE assigned_to IS NOT NULL
        GROUP BY assigned_to ORDER BY c DESC LIMIT 20`,
    );

    return {
      totals: { total, open, pending, resolved, closed, reopened },
      averageFirstResponseMinutes: frt?.minutes === null ? null : Number(frt?.minutes),
      averageResolutionMinutes: rt?.minutes === null ? null : Number(rt?.minutes),
      csat: csat?.rating === null ? null : Number(Number(csat?.rating).toFixed(2)),
      csatResponses: Number(csat?.n ?? 0),
      aiResolutionRate: aiTickets > 0 ? Number((aiResolved / aiTickets).toFixed(3)) : 0,
      humanEscalationRate: aiTickets > 0 ? Number((escalated / aiTickets).toFixed(3)) : 0,
      reopenRate: Number(reopenRate.toFixed(3)),
      byCountry: byCountry.map((row) => ({ country: String(row.country), count: Number(row.c) })),
      byMarketplace: byMarketplace.map((row) => ({ marketplace: String(row.marketplace), count: Number(row.c) })),
      byCategory: byCategory.map((row) => ({ category: String(row.category), count: Number(row.c) })),
      byDepartment: byDepartment.map((row) => ({ department: String(row.department), count: Number(row.c) })),
      byAgent: byAgent.map((row) => ({
        agentId: Number(row.agentId),
        count: Number(row.c),
        csat: row.csat === null ? null : Number(Number(row.csat).toFixed(2)),
      })),
    };
  });
}

export async function agentSearch(auth: AuthPrincipal, q: string, kind = 'auto') {
  if (!canViewAnyTicket(auth) && !isSupportAgent(auth)) throw forbidden('Not a support agent');
  const query = q.trim();
  const looksUuid = /^[0-9a-f-]{36}$/i.test(query);
  const looksTicket = /^SUP-\d{4}-/i.test(query);
  const looksEmail = query.includes('@');
  const looksPhone = /^\+?\d[\d\s-]{7,}$/.test(query);
  const looksVin = /^[A-HJ-NPR-Z0-9]{11,17}$/i.test(query) && !looksEmail;
  const inferred =
    kind !== 'auto'
      ? kind
      : looksTicket
        ? 'ticket'
        : looksUuid
          ? 'uuid'
          : looksEmail
            ? 'email'
            : looksPhone
              ? 'phone'
              : looksVin
                ? 'vin'
                : 'mixed';

  const tickets =
    inferred === 'ticket' || inferred === 'uuid' || inferred === 'mixed'
      ? await queryRows<Row>(
          `SELECT uuid, ticket_number, subject, status, priority
             FROM support_tickets
            WHERE ticket_number = ? OR uuid = ? OR subject LIKE ?
            ORDER BY updated_at DESC LIMIT 10`,
          [query.toUpperCase(), query, `%${query.slice(0, 80)}%`],
        )
      : [];

  const users =
    inferred === 'email' || inferred === 'phone' || inferred === 'mixed'
      ? await queryRows<Row>(
          `SELECT id, uuid, email, phone_e164, username
             FROM users
            WHERE deleted_at IS NULL AND (email = ? OR phone_e164 = ? OR username = ? OR id = ?)
            LIMIT 10`,
          [query.toLowerCase(), query.replace(/\s/g, ''), query, Number(query) || 0],
        )
      : [];

  const listings =
    inferred === 'listing' || inferred === 'uuid' || inferred === 'mixed'
      ? await queryRows<Row>(
          `SELECT id, uuid, title, status FROM listings WHERE deleted_at IS NULL AND (uuid = ? OR id = ?) LIMIT 8`,
          [query, Number(query) || 0],
        )
      : [];

  const payments =
    inferred === 'payment' || inferred === 'order' || inferred === 'uuid'
      ? await queryRows<Row>(
          `SELECT uuid, status, amount, currency FROM payment_intents WHERE uuid = ? LIMIT 5`,
          [query],
        ).catch(() => [] as Row[])
      : [];

  const orders =
    inferred === 'order' || inferred === 'uuid'
      ? await queryRows<Row>(`SELECT uuid, status FROM orders WHERE uuid = ? LIMIT 5`, [query]).catch(() => [] as Row[])
      : [];

  const subscriptions =
    inferred === 'subscription' || inferred === 'uuid'
      ? await queryRows<Row>(
          `SELECT us.id, p.code AS plan FROM user_subscriptions us JOIN subscription_plans p ON p.id = us.plan_id
            WHERE us.id = ? OR us.uuid = ? LIMIT 5`,
          [Number(query) || 0, query],
        ).catch(() => [] as Row[])
      : [];

  const vehicles =
    inferred === 'vin' || inferred === 'mixed'
      ? await queryRows<Row>(
          `SELECT l.id, l.uuid, l.title, v.vin
             FROM vehicle_listing_details v JOIN listings l ON l.id = v.listing_id
            WHERE v.vin = ? LIMIT 5`,
          [query.toUpperCase()],
        ).catch(() => [] as Row[])
      : [];

  const conversations =
    inferred === 'conversation' || inferred === 'uuid'
      ? await queryRows<Row>(`SELECT uuid, subject, conversation_type FROM conversations WHERE uuid = ? LIMIT 5`, [query])
      : [];

  return {
    query,
    kind: inferred,
    tickets: tickets.map((row) => ({
      uuid: String(row.uuid),
      ticketNumber: String(row.ticket_number),
      subject: String(row.subject),
      status: String(row.status),
      priority: String(row.priority),
    })),
    users: users.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      username: (row.username as string | null) ?? null,
    })),
    listings: listings.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      title: String(row.title),
      status: String(row.status),
    })),
    payments: payments.map((row) => ({ uuid: String(row.uuid), status: String(row.status) })),
    orders: orders.map((row) => ({ uuid: String(row.uuid), status: String(row.status) })),
    subscriptions: subscriptions.map((row) => ({ id: Number(row.id), plan: String(row.plan) })),
    vehicles: vehicles.map((row) => ({
      listingId: Number(row.id),
      uuid: String(row.uuid),
      title: String(row.title),
      vin: String(row.vin),
    })),
    conversations: conversations.map((row) => ({
      uuid: String(row.uuid),
      subject: (row.subject as string | null) ?? null,
      type: String(row.conversation_type),
    })),
  };
}

export async function upsertCategory(input: {
  code: string;
  name: string;
  description?: string;
  parentId?: number | null;
  marketplaceId?: number | null;
  defaultPriority?: string;
  slaFirstResponseMinutes?: number | null;
  slaResolutionMinutes?: number | null;
  autoAssignTeam?: string | null;
  isActive?: boolean;
}) {
  const existing = await queryOne<Row>('SELECT id FROM support_categories WHERE code = ?', [input.code]);
  if (existing) {
    const { execute } = await import('../../db/query');
    await execute(
      `UPDATE support_categories
          SET name = ?, description = COALESCE(?, description), parent_id = ?, marketplace_id = ?,
              default_priority = COALESCE(?, default_priority),
              sla_first_response_minutes = ?, sla_resolution_minutes = ?,
              auto_assign_team = ?, is_active = COALESCE(?, is_active)
        WHERE id = ?`,
      [
        input.name,
        input.description ?? null,
        input.parentId ?? null,
        input.marketplaceId ?? null,
        input.defaultPriority ?? null,
        input.slaFirstResponseMinutes ?? null,
        input.slaResolutionMinutes ?? null,
        input.autoAssignTeam ?? null,
        input.isActive === undefined ? null : input.isActive ? 1 : 0,
        existing.id,
      ],
    );
    return { id: Number(existing.id), updated: true };
  }
  const { insertAndGetId } = await import('../../db/query');
  const id = await insertAndGetId(
    `INSERT INTO support_categories
       (code, name, description, parent_id, marketplace_id, default_priority,
        sla_first_response_minutes, sla_resolution_minutes, auto_assign_team, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.code,
      input.name,
      input.description ?? null,
      input.parentId ?? null,
      input.marketplaceId ?? null,
      input.defaultPriority ?? 'normal',
      input.slaFirstResponseMinutes ?? null,
      input.slaResolutionMinutes ?? null,
      input.autoAssignTeam ?? null,
      input.isActive === false ? 0 : 1,
    ],
  );
  return { id, updated: false };
}
