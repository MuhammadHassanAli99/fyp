import type { Request } from 'express';
import { AppError, ErrorCode, forbidden, unauthenticated } from '../../core/errors';
import { hasPermission } from '../../middleware/authorize';
import { recordAudit } from '../../middleware/audit';
import { queryOne, type Row } from '../../db/query';
import type { AuthPrincipal } from '../../types/express';
import { isSensitiveCategoryCode, parseStringArray, SENSITIVE_DEPARTMENTS } from './support.types';

export function isSupportAgent(auth: AuthPrincipal | null | undefined): boolean {
  if (!auth) return false;
  return (
    hasPermission(auth.permissions, 'ticket.view_any') ||
    hasPermission(auth.permissions, 'ticket.manage') ||
    auth.roles.some((role) =>
      [
        'support_agent',
        'support_manager',
        'support_admin',
        'senior_support_agent',
        'support_supervisor',
        'billing_agent',
        'fraud_agent',
        'kyc_agent',
        'technical_agent',
        'marketplace_specialist',
      ].includes(role),
    )
  );
}

export function canViewAnyTicket(auth: AuthPrincipal): boolean {
  return hasPermission(auth.permissions, 'ticket.view_any') || hasPermission(auth.permissions, 'ticket.manage');
}

export function canManageTickets(auth: AuthPrincipal): boolean {
  return hasPermission(auth.permissions, 'ticket.manage');
}

export function requireStepUp(auth: AuthPrincipal | null, reason: string): void {
  if (!auth) throw unauthenticated();
  if (!auth.mfaSatisfied) {
    throw new AppError('Additional verification required for this support action', {
      status: 401,
      code: ErrorCode.MFA_REQUIRED,
      expected: true,
      details: { reason },
    });
  }
}

export function assertAgentCanAccessTicket(
  auth: AuthPrincipal,
  ticket: Row,
  roster?: Row | null,
): void {
  if (canManageTickets(auth)) return;
  if (!canViewAnyTicket(auth)) throw forbidden('Not a support agent');
  const assignedTo = ticket.assigned_to === null || ticket.assigned_to === undefined ? null : Number(ticket.assigned_to);
  if (assignedTo === auth.userId) return;
  if (assignedTo === null) return;
  const teams = parseStringArray(roster?.teams);
  const ticketTeam = ticket.assigned_team ? String(ticket.assigned_team) : null;
  if (ticketTeam && teams.includes(ticketTeam)) return;
  throw forbidden('This ticket is assigned to another agent');
}

export async function loadAgentRoster(userId: number): Promise<Row | null> {
  return queryOne<Row>('SELECT * FROM support_agents WHERE user_id = ? AND is_active = 1', [userId]);
}

export function maskPii(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    if (!local || !domain) return '***';
    return `${local.slice(0, 1)}***@${domain}`;
  }
  if (value.length > 4) return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
  return '****';
}

export function shouldExposeCustomerPii(auth: AuthPrincipal, assignedTo: number | null): boolean {
  if (hasPermission(auth.permissions, 'user.view_any') && (assignedTo === auth.userId || canManageTickets(auth))) {
    return true;
  }
  return false;
}

export function shouldExposeFraudDetail(auth: AuthPrincipal): boolean {
  return (
    hasPermission(auth.permissions, 'fraud_case.view') ||
    hasPermission(auth.permissions, 'fraud_case.view_any') ||
    auth.roles.includes('fraud_agent') ||
    auth.roles.includes('fraud_analyst')
  );
}

export function departmentAllowedForAgent(roster: Row | null, department: string | null): boolean {
  if (!department) return true;
  if (!roster) return true;
  const teams = parseStringArray(roster.teams);
  if (teams.length === 0) return true;
  return teams.includes(department);
}

export function requireSensitiveDepartmentAuth(auth: AuthPrincipal, department: string | null, categoryCode?: string | null): void {
  if (!department && !categoryCode) return;
  if (SENSITIVE_DEPARTMENTS.has(department ?? '') || isSensitiveCategoryCode(categoryCode)) {
    requireStepUp(auth, 'sensitive_support_operation');
  }
}

export async function writeSupportAudit(params: {
  req?: Request;
  actorId?: number | null;
  action: string;
  entityId?: string | number | null;
  permission?: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  await recordAudit({
    action: params.action,
    entityType: 'support_ticket',
    entityId: params.entityId,
    actorType: params.req?.auth?.isStaff ? 'admin' : params.req?.auth ? 'user' : 'system',
    actorId: params.actorId ?? params.req?.auth?.userId ?? null,
    permissionCode: params.permission ?? null,
    roleCode: params.req?.auth?.roles[0] ?? null,
    reason: params.reason ?? null,
    before: params.before,
    after: params.after,
  });
}
