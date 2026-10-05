import type { Request } from 'express';
import type { AuthPrincipal } from '../../types/express';
import { execute, insertAndGetId, queryCount, queryOne, queryRows, type Row } from '../../db/query';
import { notFound } from '../../core/errors';
import { uuid } from '../../core/security/crypto';
import { where } from '../../db/sql';
import { listModerationQueue } from '../moderation/moderation.service';
import { staffDecideReview, listModerationReviews } from '../reviews/reviews.service';
import { listModerationCampaigns, staffDecideCampaign } from '../ads/ads.service';
import { riskOverview, suspiciousSubjects, multipleAccounts, listDecisions } from '../risk/risk.dashboard';
import { listKycQueue } from '../risk/risk.kyc';
import { reviewVerification } from '../verification/verification.service';
import { notifyUser } from '../notifications/notifications.orchestrator';
import { scopeSql, writeAdminAudit, effectivePermission } from './admin.authz';
import type { AdminListQuery } from './admin.schema';
import { getOverview } from '../analytics/analytics.service';

export async function adminModerationQueue(status?: string, limit = 50) {
  const [queue, reviews, ads] = await Promise.all([
    listModerationQueue({ status, limit }),
    listModerationReviews(limit),
    listModerationCampaigns(),
  ]);
  return { queue, reviews, ads };
}

export async function decideModerationItem(req: Request, id: number, decision: 'approved' | 'rejected' | 'escalated', reason?: string) {
  const row = await queryOne<Row>(`SELECT * FROM moderation_queue WHERE id = ?`, [id]);
  if (!row) throw notFound('Moderation item');
  await execute(
    `UPDATE moderation_queue SET status = ?, assigned_to = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [decision, req.auth!.userId, id],
  );
  const action =
    decision === 'approved' ? 'approve' : decision === 'rejected' ? 'reject' : 'escalate';
  await execute(
    `INSERT INTO moderation_actions (queue_id, moderator_id, entity_type, entity_id, action, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, req.auth!.userId, String(row.entity_type), Number(row.entity_id), action, reason ?? null],
  );
  await writeAdminAudit({
    req,
    action: `moderation.${decision}`,
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    permission: 'moderation.moderate',
    reason: reason ?? null,
  });
  return { id, status: decision };
}

export async function adminDecideReview(req: Request, reviewUuid: string, decision: 'approve' | 'reject' | 'hide', note?: string) {
  const result = await staffDecideReview(req.auth!.userId, reviewUuid, decision, note);
  await writeAdminAudit({ req, action: `review.${decision}`, entityType: 'review', entityId: reviewUuid, permission: 'review.moderate', reason: note ?? null });
  return result;
}

export async function adminDecideAd(req: Request, campaignUuid: string, decision: 'approve' | 'reject' | 'pause', reason?: string) {
  if (decision === 'pause') {
    const campaign = await queryOne<Row>(`SELECT id, uuid FROM ad_campaigns WHERE uuid = ?`, [campaignUuid]);
    if (!campaign) throw notFound('Campaign');
    await execute(`UPDATE ad_campaigns SET status = 'paused' WHERE id = ? AND status IN ('active','scheduled')`, [campaign.id]);
    await writeAdminAudit({ req, action: 'ad_campaign.pause', entityType: 'ad_campaign', entityId: campaignUuid, permission: 'ad_campaign.approve', reason: reason ?? null });
    return { uuid: campaignUuid, status: 'paused' };
  }
  const result = await staffDecideCampaign(req.auth!.userId, campaignUuid, decision, reason);
  await writeAdminAudit({ req, action: `ad_campaign.${decision}`, entityType: 'ad_campaign', entityId: campaignUuid, permission: 'ad_campaign.approve', reason: reason ?? null });
  return result;
}

export async function adminFraudOverview(from?: string, to?: string) {
  const overview = await riskOverview({ from, to });
  const [users, devices, ips, multiples] = await Promise.all([
    suspiciousSubjects('user', 25),
    suspiciousSubjects('device', 25),
    suspiciousSubjects('ip', 25),
    multipleAccounts(25),
  ]);
  return { overview, suspicious: { users, devices, ips }, multipleAccounts: multiples };
}

export async function adminFraudDecisions(decision?: string, riskLevel?: string) {
  return listDecisions({ decision, riskLevel, limit: 50 });
}

export async function adminKycQueue() {
  return listKycQueue(50);
}

export async function adminReviewKyc(req: Request, requestUuid: string, decision: 'approved' | 'rejected', reason?: string) {
  const result = await reviewVerification(req.auth!.userId, requestUuid, { decision, reason });
  await writeAdminAudit({ req, action: `kyc.${decision}`, entityType: 'verification_request', entityId: requestUuid, permission: 'kyc.review', reason: reason ?? null });
  return result;
}

export async function listCmsPages(q: AdminListQuery) {
  const filter = where().eq('status', q.status);
  if (q.q) filter.contains('title', q.q);
  const built = filter.build();
  const total = await queryCount(`SELECT COUNT(*) FROM cms_pages ${built.sql}`, built.params);
  const rows = await queryRows<Row>(
    `SELECT id, uuid, slug, title, kind, status, visibility, published_at, updated_at FROM cms_pages ${built.sql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    [...built.params, q.perPage, (q.page - 1) * q.perPage],
  );
  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      slug: String(row.slug),
      title: String(row.title),
      kind: String(row.kind),
      status: String(row.status),
      visibility: String(row.visibility),
      publishedAt: row.published_at ? (row.published_at as Date).toISOString() : null,
      updatedAt: (row.updated_at as Date).toISOString(),
    })),
    total,
    page: q.page,
    perPage: q.perPage,
  };
}

export async function upsertCmsPage(
  req: Request,
  input: {
    id?: number;
    slug?: string;
    title: string;
    body?: string;
    kind?: string;
    status?: string;
    visibility?: string;
    seoTitle?: string;
    seoDescription?: string;
    marketplaceId?: number;
    scheduledAt?: string;
  },
) {
  if (input.id) {
    const current = await queryOne<Row>(`SELECT * FROM cms_pages WHERE id = ?`, [input.id]);
    if (!current) throw notFound('CMS page');
    const version = await queryCount(`SELECT COUNT(*) FROM cms_page_versions WHERE page_id = ?`, [input.id]);
    await execute(
      `INSERT INTO cms_page_versions (page_id, version, title, body, status, editor_id) VALUES (?, ?, ?, ?, ?, ?)`,
      [input.id, version + 1, String(current.title), current.body, String(current.status), req.auth!.userId],
    );
    await execute(
      `UPDATE cms_pages
          SET title = ?, body = COALESCE(?, body), kind = COALESCE(?, kind), status = COALESCE(?, status),
              visibility = COALESCE(?, visibility), seo_title = COALESCE(?, seo_title), seo_description = COALESCE(?, seo_description),
              marketplace_id = COALESCE(?, marketplace_id), scheduled_at = ?,
              published_at = IF(? = 'published', COALESCE(published_at, CURRENT_TIMESTAMP), published_at)
        WHERE id = ?`,
      [
        input.title,
        input.body ?? null,
        input.kind ?? null,
        input.status ?? null,
        input.visibility ?? null,
        input.seoTitle ?? null,
        input.seoDescription ?? null,
        input.marketplaceId ?? null,
        input.scheduledAt ? new Date(input.scheduledAt) : null,
        input.status ?? null,
        input.id,
      ],
    );
    await writeAdminAudit({ req, action: 'cms.update', entityType: 'cms_page', entityId: input.id, permission: 'cms_page.update', after: input });
    return { id: input.id };
  }
  const slug = (input.slug ?? input.title).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 200);
  const id = await insertAndGetId(
    `INSERT INTO cms_pages (uuid, slug, title, body, kind, status, visibility, seo_title, seo_description, marketplace_id, author_id, scheduled_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? = 'published', CURRENT_TIMESTAMP, NULL))`,
    [
      uuid(),
      slug,
      input.title,
      input.body ?? null,
      input.kind ?? 'page',
      input.status ?? 'draft',
      input.visibility ?? 'public',
      input.seoTitle ?? null,
      input.seoDescription ?? null,
      input.marketplaceId ?? null,
      req.auth!.userId,
      input.scheduledAt ? new Date(input.scheduledAt) : null,
      input.status ?? 'draft',
    ],
  );
  await writeAdminAudit({ req, action: 'cms.create', entityType: 'cms_page', entityId: id, permission: 'cms_page.create', after: input });
  return { id, slug };
}

export async function listBanners() {
  const rows = await queryRows<Row>(
    `SELECT id, uuid, name, placement, title, is_active, priority, starts_at, ends_at FROM cms_banners ORDER BY priority, id DESC LIMIT 200`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    uuid: String(row.uuid),
    name: String(row.name),
    placement: String(row.placement),
    title: (row.title as string | null) ?? null,
    isActive: row.is_active === 1,
    priority: Number(row.priority ?? 0),
  }));
}

export async function upsertBanner(req: Request, input: Record<string, unknown>) {
  const id = await insertAndGetId(
    `INSERT INTO cms_banners (uuid, name, placement, title, subtitle, image_url, cta_label, cta_url, marketplace_id, is_active, priority, starts_at, ends_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      input.name,
      input.placement,
      input.title ?? null,
      input.subtitle ?? null,
      input.imageUrl ?? null,
      input.ctaLabel ?? null,
      input.ctaUrl ?? null,
      input.marketplaceId ?? null,
      input.isActive === false ? 0 : 1,
      input.priority ?? 100,
      input.startsAt ? new Date(String(input.startsAt)) : null,
      input.endsAt ? new Date(String(input.endsAt)) : null,
      req.auth!.userId,
    ],
  );
  await writeAdminAudit({ req, action: 'banner.create', entityType: 'cms_banner', entityId: id, permission: 'banner.create', after: input });
  return { id };
}

export async function createBroadcast(
  req: Request,
  input: {
    title: string;
    body: string;
    channels: string[];
    audience: string;
    countryId?: number;
    cityId?: number;
    marketplaceId?: number;
    categoryId?: number;
    companyId?: number;
    roleCode?: string;
    userIds?: number[];
    scheduledFor?: string;
    categoryCode?: string;
  },
) {
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : new Date();
  const immediate = !input.scheduledFor || scheduledFor.getTime() <= Date.now();
  const categoryCode = input.categoryCode ?? 'account.welcome';
  const segment = {
    audience: input.audience,
    countryId: input.countryId ?? null,
    cityId: input.cityId ?? null,
    marketplaceId: input.marketplaceId ?? null,
    categoryId: input.categoryId ?? null,
    companyId: input.companyId ?? null,
    roleCode: input.roleCode ?? null,
    userIds: input.userIds ?? [],
    title: input.title,
    body: input.body,
    channels: input.channels,
  };

  if (immediate && input.audience === 'users' && input.userIds && input.userIds.length > 0) {
    for (const userId of input.userIds.slice(0, 500)) {
      await notifyUser({
        userId,
        categoryCode,
        title: input.title,
        body: input.body,
        eventType: 'admin.broadcast',
        eventId: `broadcast:${uuid()}`,
      });
    }
    await writeAdminAudit({ req, action: 'notification.send', entityType: 'broadcast', permission: 'notification.create', after: { count: input.userIds.length } });
    return { status: 'sent', count: input.userIds.length };
  }

  const id = await insertAndGetId(
    `INSERT INTO scheduled_notifications
       (uuid, audience, segment_query, category_code, channel, payload, scheduled_for, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
    [
      uuid(),
      input.audience === 'users' || input.audience === 'all' ? (input.audience === 'all' ? 'all' : 'user') : 'segment',
      JSON.stringify(segment),
      categoryCode,
      input.channels[0] ?? 'in_app',
      JSON.stringify({ title: input.title, body: input.body, channels: input.channels }),
      scheduledFor,
      req.auth!.userId,
    ],
  );
  await writeAdminAudit({ req, action: 'notification.schedule', entityType: 'scheduled_notification', entityId: id, permission: 'notification.create', after: input });
  return { id, status: 'scheduled' };
}

export async function listAdminTickets(auth: AuthPrincipal, q: AdminListQuery) {
  const permission = effectivePermission(auth, ['ticket.view_any', 'ticket.view']);
  const scoped = scopeSql(auth, permission, { countryId: 't.country_id', marketplaceId: 't.marketplace_id' });
  const filter = where().raw(scoped.sql, ...scoped.params).eq('t.status', q.status).eq('t.country_id', q.countryId).eq('t.marketplace_id', q.marketplaceId);
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, '')}%`;
    filter.raw('(t.subject LIKE ? OR t.ticket_number LIKE ?)', like, like);
  }
  const built = filter.build();
  const total = await queryCount(`SELECT COUNT(*) FROM support_tickets t ${built.sql}`, built.params);
  const rows = await queryRows<Row>(
    `SELECT t.id, t.uuid, t.ticket_number, t.subject, t.status, t.priority, t.assigned_to, t.assigned_team, t.user_id, t.created_at, t.updated_at
       FROM support_tickets t ${built.sql}
      ORDER BY FIELD(t.priority,'urgent','high','normal','low'), t.created_at DESC
      LIMIT ? OFFSET ?`,
    [...built.params, q.perPage, (q.page - 1) * q.perPage],
  );
  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      number: String(row.ticket_number),
      subject: String(row.subject),
      status: mapTicketStatus(String(row.status), row.assigned_to === null ? null : Number(row.assigned_to)),
      rawStatus: String(row.status),
      priority: String(row.priority),
      assignedTo: row.assigned_to === null ? null : Number(row.assigned_to),
      assignedTeam: (row.assigned_team as string | null) ?? null,
      userId: row.user_id === null ? null : Number(row.user_id),
      createdAt: (row.created_at as Date).toISOString(),
    })),
    total,
    page: q.page,
    perPage: q.perPage,
  };
}

function mapTicketStatus(status: string, assignedTo?: number | null, firstResponseAt?: Date | string | null): string {
  switch (status) {
    case 'new':
      return 'NEW';
    case 'open':
      if (assignedTo && firstResponseAt) return 'IN_PROGRESS';
      if (assignedTo) return 'ASSIGNED';
      return 'OPEN';
    case 'pending_customer':
      return 'WAITING_FOR_CUSTOMER';
    case 'pending_internal':
    case 'on_hold':
      return 'WAITING_INTERNAL';
    case 'resolved':
      return 'RESOLVED';
    case 'closed':
      return 'CLOSED';
    case 'reopened':
      return 'REOPENED';
    default:
      return status.toUpperCase();
  }
}

export async function getAdminTicket(uuidValue: string) {
  const row = await queryOne<Row>(`SELECT * FROM support_tickets WHERE uuid = ?`, [uuidValue]);
  if (!row) throw notFound('Ticket');
  const messages = await queryRows<Row>(
    `SELECT id, author_id, author_kind, body, is_internal_note, created_at
       FROM support_ticket_messages WHERE ticket_id = ? ORDER BY created_at`,
    [row.id],
  );
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    number: String(row.ticket_number),
    subject: String(row.subject),
    description: (row.description as string | null) ?? null,
    status: mapTicketStatus(
      String(row.status),
      row.assigned_to === null ? null : Number(row.assigned_to),
      (row.first_response_at as Date | null) ?? null,
    ),
    rawStatus: String(row.status),
    priority: String(row.priority),
    assignedTo: row.assigned_to === null ? null : Number(row.assigned_to),
    messages: messages.map((item) => ({
      id: Number(item.id),
      authorId: item.author_id === null ? null : Number(item.author_id),
      kind: String(item.author_kind),
      body: String(item.body),
      internal: item.is_internal_note === 1,
      createdAt: (item.created_at as Date).toISOString(),
    })),
  };
}

export async function assignTicket(req: Request, ticketUuid: string, input: { assignedTo?: number; assignedTeam?: string; status?: string; priority?: string; note?: string }) {
  const { assignTicket: assignSupportTicket } = await import('../support/support.tickets');
  return assignSupportTicket(req.auth!, ticketUuid, input);
}

export async function replyTicket(req: Request, ticketUuid: string, body: string, internal = false) {
  const { agentReply } = await import('../support/support.tickets');
  return agentReply(req.auth!, ticketUuid, body, internal);
}

export async function listAuditLogs(q: AdminListQuery) {
  const filter = where().eq('entity_type', q.status);
  if (q.q) filter.contains('action', q.q);
  const built = filter.build();
  const total = await queryCount(`SELECT COUNT(*) FROM audit_logs ${built.sql}`, built.params);
  const rows = await queryRows<Row>(
    `SELECT id, actor_id, actor_type, action, entity_type, entity_id, role_code, permission_code, reason, request_id, created_at
       FROM audit_logs ${built.sql}
      ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...built.params, q.perPage, (q.page - 1) * q.perPage],
  );
  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      actorId: row.actor_id === null ? null : Number(row.actor_id),
      actorType: String(row.actor_type),
      action: String(row.action),
      entityType: String(row.entity_type),
      entityId: (row.entity_id as string | null) ?? null,
      role: (row.role_code as string | null) ?? null,
      permission: (row.permission_code as string | null) ?? null,
      reason: (row.reason as string | null) ?? null,
      requestId: (row.request_id as string | null) ?? null,
      createdAt: (row.created_at as Date).toISOString(),
    })),
    total,
    page: q.page,
    perPage: q.perPage,
    appendOnly: true,
  };
}

export async function adminAnalytics(auth: AuthPrincipal, from?: string) {
  const today = new Date().toISOString().slice(0, 10);
  const overview = await getOverview(auth, {
    period: from ? 'custom' : '30d',
    from,
    to: from ? today : undefined,
  });
  return {
    ...overview,
    users: overview.series.users,
    listings: overview.series.dau,
    revenue: overview.series.sales,
    support: [],
  };
}
