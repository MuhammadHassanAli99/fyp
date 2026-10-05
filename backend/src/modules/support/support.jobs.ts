import { execute, queryRows, type Row } from '../../db/query';
import { loggerFor } from '../../config/logger';
import { eventBus } from '../../core/events/event-bus';
import { notifyUser } from '../notifications/notify';
import { slaMinutesFor, parseTags, type DbPriority } from './support.types';
import { loadEntitlements } from '../../middleware/entitlements';

const log = loggerFor('support.jobs');

async function planFlags(userId: number | null): Promise<{ priority: boolean; dedicated: boolean }> {
  if (!userId) return { priority: false, dedicated: false };
  const entitlements = await loadEntitlements(userId).catch(() => null);
  return {
    priority: Boolean(entitlements?.features.priority_support?.enabled),
    dedicated: Boolean(entitlements?.features.dedicated_support?.enabled),
  };
}

/**
 * Marks SLA breaches and escalates: unassign overloaded first-line, bump priority,
 * notify the assigned agent and any available supervisor in the same department.
 */
export async function runSupportSlaSweep(): Promise<number> {
  const open = await queryRows<Row>(
    `SELECT t.id, t.uuid, t.ticket_number, t.user_id, t.assigned_to, t.assigned_team, t.priority, t.tags,
            t.created_at, t.first_response_at, t.status, t.sla_breached,
            c.sla_first_response_minutes, c.sla_resolution_minutes
       FROM support_tickets t
       LEFT JOIN support_categories c ON c.id = t.category_id
      WHERE t.status IN ('new','open','pending_customer','pending_internal','on_hold','reopened')
      LIMIT 200`,
  );

  let processed = 0;
  for (const ticket of open) {
    const flags = await planFlags(ticket.user_id === null ? null : Number(ticket.user_id));
    const tags = parseTags(ticket.tags);
    const priority = String(ticket.priority) as DbPriority;
    const firstLimit = slaMinutesFor({
      baseMinutes: Number(ticket.sla_first_response_minutes ?? 240),
      priority,
      critical: tags.severity === 'critical',
      hasPrioritySupport: flags.priority,
      hasDedicatedSupport: flags.dedicated,
    });
    const resolveLimit = slaMinutesFor({
      baseMinutes: Number(ticket.sla_resolution_minutes ?? 1440),
      priority,
      critical: tags.severity === 'critical',
      hasPrioritySupport: flags.priority,
      hasDedicatedSupport: flags.dedicated,
    });
    const created = new Date(ticket.created_at as Date).getTime();
    const ageMinutes = Math.round((Date.now() - created) / 60000);
    const waitingFirst = !ticket.first_response_at && firstLimit !== null && ageMinutes > firstLimit;
    const waitingResolve = Boolean(ticket.first_response_at) && resolveLimit !== null && ageMinutes > resolveLimit;
    if (!waitingFirst && !waitingResolve) continue;

    processed += 1;
    if (!ticket.sla_breached) {
      await execute(`UPDATE support_tickets SET sla_breached = 1 WHERE id = ?`, [ticket.id]);
      const overdue = waitingFirst ? ageMinutes - (firstLimit ?? 0) : ageMinutes - (resolveLimit ?? 0);
      const event = await eventBus.enqueueNow('ticket.sla_breached', 'support_ticket', Number(ticket.id), {
        ticketId: Number(ticket.id),
        minutesOverdue: Math.max(0, overdue),
      });
      void eventBus.publishAfterCommit(event);
      await execute(
        `INSERT INTO support_ticket_messages (ticket_id, author_kind, body, is_internal_note)
         VALUES (?, 'system', ?, 1)`,
        [ticket.id, `SLA ${waitingFirst ? 'first response' : 'resolution'} breached (${ageMinutes}m). Escalating.`],
      );
    }

    const nextPriority = priority === 'low' ? 'normal' : priority === 'normal' ? 'high' : 'urgent';
    await execute(`UPDATE support_tickets SET priority = ? WHERE id = ?`, [nextPriority, ticket.id]);

    const supervisors = await queryRows<Row>(
      `SELECT user_id FROM support_agents
        WHERE is_active = 1 AND status IN ('available','busy')
          AND (teams IS NULL OR JSON_CONTAINS(teams, JSON_QUOTE(?)) OR JSON_CONTAINS(teams, JSON_QUOTE('general')))
        ORDER BY current_ticket_count ASC LIMIT 3`,
      [String(ticket.assigned_team || 'general')],
    );
    for (const agent of supervisors) {
      await notifyUser({
        userId: Number(agent.user_id),
        categoryCode: 'support.sla_warning',
        title: 'SLA warning',
        body: `${ticket.ticket_number} needs escalation.`,
        actionType: 'support',
        entityType: 'support',
        entityId: String(ticket.uuid),
        deepLink: `/support/tickets/${ticket.uuid}`,
        priority: 'urgent',
      }).catch(() => undefined);
    }
  }
  if (processed > 0) log.info({ processed }, 'support SLA sweep');
  return processed;
}

export async function runSupportMaintenance(): Promise<number> {
  const { affectedRows } = await import('../../db/query');
  return affectedRows(
    `UPDATE support_tickets
        SET status = 'closed', closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP)
      WHERE status = 'resolved' AND resolved_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)`,
  );
}
