import type { Request } from 'express';
import type { AuthPrincipal } from '../../types/express';
import { execute, insertAndGetId, queryCount, queryOne, queryRows, type Row } from '../../db/query';
import { forbidden, notFound } from '../../core/errors';
import { uuid } from '../../core/security/crypto';
import { where } from '../../db/sql';
import { assertResourceInScope, isUnrestricted, scopeSql, writeAdminAudit } from './admin.authz';
import type { AdminListQuery } from './admin.schema';

function salesScope(auth: AuthPrincipal) {
  const permission = isUnrestricted(auth, 'sales.view_any') || auth.permissions.includes('sales.view_any') ? 'sales.view_any' : 'sales.view';
  return scopeSql(auth, permission, {
    businessId: 'l.business_id',
    ownerId: 'l.assigned_to',
    countryId: 'l.country_id',
  });
}

export async function listLeads(auth: AuthPrincipal, q: AdminListQuery) {
  const scoped = salesScope(auth);
  const filter = where().raw(scoped.sql, ...scoped.params).eq('l.status', q.status).eq('l.business_id', q.companyId).eq('l.assigned_to', q.salesmanId);
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, '')}%`;
    filter.raw('l.title LIKE ?', like);
  }
  const built = filter.build();
  const total = await queryCount(`SELECT COUNT(*) FROM sales_leads l ${built.sql}`, built.params);
  const rows = await queryRows<Row>(
    `SELECT l.id, l.uuid, l.business_id, l.assigned_to, l.listing_id, l.status, l.title, l.expected_value, l.currency, l.next_follow_up_at, l.created_at
       FROM sales_leads l ${built.sql}
      ORDER BY l.updated_at DESC LIMIT ? OFFSET ?`,
    [...built.params, q.perPage, (q.page - 1) * q.perPage],
  );
  return {
    items: rows.map(mapLead),
    total,
    page: q.page,
    perPage: q.perPage,
  };
}

function mapLead(row: Row) {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    businessId: Number(row.business_id),
    assignedTo: row.assigned_to === null ? null : Number(row.assigned_to),
    listingId: row.listing_id === null ? null : Number(row.listing_id),
    status: String(row.status),
    title: String(row.title),
    expectedValue: row.expected_value === null ? null : Number(row.expected_value),
    currency: (row.currency as string | null) ?? null,
    nextFollowUpAt: row.next_follow_up_at ? (row.next_follow_up_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

async function loadLead(auth: AuthPrincipal, id: number) {
  const row = await queryOne<Row>(`SELECT * FROM sales_leads WHERE id = ?`, [id]);
  if (!row) throw notFound('Lead');
  assertResourceInScope(auth, auth.permissions.includes('sales.view_any') ? 'sales.view_any' : 'sales.view', {
    businessId: Number(row.business_id),
    ownerId: row.assigned_to === null ? null : Number(row.assigned_to),
    countryId: row.country_id === null ? null : Number(row.country_id),
  });
  return row;
}

export async function createLead(
  req: Request,
  input: {
    title: string;
    businessId: number;
    assignedTo?: number;
    customerUserId?: number;
    listingId?: number;
    marketplaceId?: number;
    source?: string;
    expectedValue?: number;
    currency?: string;
    notes?: string;
  },
) {
  const membership = await queryOne<Row>(
    `SELECT id FROM business_members WHERE business_id = ? AND user_id = ? AND removed_at IS NULL`,
    [input.businessId, req.auth!.userId],
  );
  if (!membership && !req.auth!.isStaff && !req.auth!.permissions.includes('*')) {
    throw forbidden('You cannot create leads for this company');
  }
  const id = await insertAndGetId(
    `INSERT INTO sales_leads (uuid, business_id, assigned_to, customer_user_id, listing_id, marketplace_id, source, title, notes, expected_value, currency, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      input.businessId,
      input.assignedTo ?? req.auth!.userId,
      input.customerUserId ?? null,
      input.listingId ?? null,
      input.marketplaceId ?? null,
      input.source ?? 'manual',
      input.title,
      input.notes ?? null,
      input.expectedValue ?? null,
      input.currency ?? null,
      req.auth!.userId,
    ],
  );
  await execute(`INSERT INTO sales_lead_events (lead_id, actor_id, event_type, body) VALUES (?, ?, 'created', ?)`, [
    id,
    req.auth!.userId,
    input.title,
  ]);
  await writeAdminAudit({ req, action: 'lead.create', entityType: 'sales_lead', entityId: id, permission: 'lead.create', organizationId: input.businessId });
  return { id };
}

export async function updateLead(req: Request, id: number, input: Record<string, unknown>) {
  const lead = await loadLead(req.auth!, id);
  await execute(
    `UPDATE sales_leads
        SET title = COALESCE(?, title), status = COALESCE(?, status), assigned_to = COALESCE(?, assigned_to),
            notes = COALESCE(?, notes), expected_value = COALESCE(?, expected_value),
            next_follow_up_at = COALESCE(?, next_follow_up_at),
            closed_at = IF(? IN ('won','lost'), COALESCE(closed_at, CURRENT_TIMESTAMP), closed_at)
      WHERE id = ?`,
    [
      input.title ?? null,
      input.status ?? null,
      input.assignedTo ?? null,
      input.notes ?? null,
      input.expectedValue ?? null,
      input.nextFollowUpAt ? new Date(String(input.nextFollowUpAt)) : null,
      input.status ?? null,
      id,
    ],
  );
  await execute(`INSERT INTO sales_lead_events (lead_id, actor_id, event_type, body) VALUES (?, ?, 'updated', ?)`, [
    id,
    req.auth!.userId,
    JSON.stringify(input).slice(0, 500),
  ]);
  return { id, businessId: Number(lead.business_id) };
}

export async function addNote(req: Request, input: { leadId?: number; listingId?: number; body: string; businessId: number }) {
  const id = await insertAndGetId(
    `INSERT INTO sales_notes (lead_id, listing_id, business_id, author_id, body) VALUES (?, ?, ?, ?, ?)`,
    [input.leadId ?? null, input.listingId ?? null, input.businessId, req.auth!.userId, input.body],
  );
  if (input.leadId) {
    await execute(`INSERT INTO sales_lead_events (lead_id, actor_id, event_type, body) VALUES (?, ?, 'note', ?)`, [
      input.leadId,
      req.auth!.userId,
      input.body.slice(0, 500),
    ]);
  }
  return { id };
}

export async function createAppointment(
  req: Request,
  input: { leadId: number; listingId?: number; scheduledFor: string; location?: string; notes?: string },
) {
  const lead = await loadLead(req.auth!, input.leadId);
  const id = await insertAndGetId(
    `INSERT INTO sales_appointments (uuid, lead_id, business_id, listing_id, salesman_id, customer_user_id, scheduled_for, location, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      input.leadId,
      lead.business_id,
      input.listingId ?? lead.listing_id,
      req.auth!.userId,
      lead.customer_user_id,
      new Date(input.scheduledFor),
      input.location ?? null,
      input.notes ?? null,
    ],
  );
  await execute(`UPDATE sales_leads SET status = IF(status = 'new', 'appointment', status) WHERE id = ?`, [input.leadId]);
  return { id };
}

export async function createQuote(
  req: Request,
  input: { leadId: number; listingId?: number; amount: number; currency: string; validUntil?: string; notes?: string },
) {
  const lead = await loadLead(req.auth!, input.leadId);
  const id = await insertAndGetId(
    `INSERT INTO sales_quotes (uuid, lead_id, business_id, listing_id, salesman_id, amount, currency, status, valid_until, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)`,
    [
      uuid(),
      input.leadId,
      lead.business_id,
      input.listingId ?? lead.listing_id,
      req.auth!.userId,
      input.amount,
      input.currency,
      input.validUntil ?? null,
      input.notes ?? null,
    ],
  );
  await execute(`UPDATE sales_leads SET status = 'quoted' WHERE id = ?`, [input.leadId]);
  return { id };
}

export async function listCommissions(auth: AuthPrincipal, q: AdminListQuery) {
  const permission = auth.permissions.includes('commission.view_any') ? 'commission.view_any' : 'commission.view';
  const scoped = scopeSql(auth, permission, { businessId: 'c.business_id', ownerId: 'c.salesman_id' });
  const filter = where().raw(scoped.sql, ...scoped.params).eq('c.business_id', q.companyId).eq('c.salesman_id', q.salesmanId);
  const built = filter.build();
  const total = await queryCount(`SELECT COUNT(*) FROM sales_commissions c ${built.sql}`, built.params);
  const rows = await queryRows<Row>(
    `SELECT c.id, c.uuid, c.business_id, c.salesman_id, c.amount, c.currency, c.status, c.created_at
       FROM sales_commissions c ${built.sql}
      ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    [...built.params, q.perPage, (q.page - 1) * q.perPage],
  );
  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      businessId: Number(row.business_id),
      salesmanId: Number(row.salesman_id),
      amount: Number(row.amount),
      currency: String(row.currency),
      status: String(row.status),
      createdAt: (row.created_at as Date).toISOString(),
    })),
    total,
    page: q.page,
    perPage: q.perPage,
  };
}

export async function salesAnalytics(auth: AuthPrincipal, businessId?: number) {
  const permission = auth.permissions.includes('sales.view_any') ? 'sales.view_any' : 'sales.view';
  const scoped = scopeSql(auth, permission, { businessId: 'l.business_id', ownerId: 'l.assigned_to' });
  const filter = where().raw(scoped.sql, ...scoped.params).eq('l.business_id', businessId);
  const built = filter.build();
  const byStatus = await queryRows<Row>(
    `SELECT l.status, COUNT(*) AS c FROM sales_leads l ${built.sql} GROUP BY l.status`,
    built.params,
  );
  const wonBuilder = where().raw(scoped.sql, ...scoped.params).eq('l.business_id', businessId).eq('l.status', 'won');
  const wonBuilt = wonBuilder.build();
  const won = await queryCount(`SELECT COUNT(*) FROM sales_leads l ${wonBuilt.sql}`, wonBuilt.params);
  return {
    byStatus: Object.fromEntries(byStatus.map((row) => [String(row.status), Number(row.c)])),
    won,
  };
}
