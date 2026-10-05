import type { Request } from 'express';
import { AppError, ErrorCode, forbidden, notFound } from '../../core/errors';
import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { writeAdminAudit } from './admin.authz';

const FOUR_EYES = new Set(['user.ban', 'user.delete', 'setting.manage', 'payout.approve']);
export const HIGH_RISK_REFUND = 1000;

export function needsFourEyes(permission: string, amount?: number): boolean {
  if (FOUR_EYES.has(permission)) return true;
  if (
    (permission === 'refund.approve' || permission === 'refund.create') &&
    amount != null &&
    amount >= HIGH_RISK_REFUND
  ) {
    return true;
  }
  return false;
}

export async function gatePrivileged(
  req: Request,
  opts: {
    permission: string;
    action: string;
    resourceType: string;
    resourceId?: string | number | null;
    reason: string;
    confirm?: boolean;
    approvalRequestUuid?: string;
    amount?: number;
    payload?: unknown;
  },
): Promise<{ queued: true; request: Awaited<ReturnType<typeof createApprovalRequest>> } | { queued: false }> {
  if (!opts.confirm) {
    throw new AppError('Confirm this action to continue', {
      status: 403,
      code: ErrorCode.CONFIRMATION_REQUIRED,
      expected: true,
    });
  }
  if (needsMfa(opts.permission, opts.amount) && !req.auth!.mfaSatisfied) {
    throw new AppError('Additional verification required', { status: 401, code: ErrorCode.MFA_REQUIRED });
  }
  if (needsFourEyes(opts.permission, opts.amount) && !opts.approvalRequestUuid) {
    return {
      queued: true,
      request: await createApprovalRequest(req, {
        action: opts.action,
        permission: opts.permission,
        resourceType: opts.resourceType,
        resourceId: opts.resourceId,
        payload: opts.payload,
        reason: opts.reason,
      }),
    };
  }
  await assertApproved(req, opts.approvalRequestUuid, opts.action);
  return { queued: false };
}

export function needsMfa(permission: string, amount?: number): boolean {
  return needsFourEyes(permission, amount) || permission === 'role.assign' || permission === 'refund.create';
}

export async function createApprovalRequest(
  req: Request,
  input: {
    action: string;
    permission: string;
    resourceType: string;
    resourceId?: string | number | null;
    payload?: unknown;
    reason: string;
  },
) {
  const id = await insertAndGetId(
    `INSERT INTO privileged_action_requests
       (uuid, action, permission_code, resource_type, resource_id, payload_json, reason, requested_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 24 HOUR))`,
    [
      uuid(),
      input.action,
      input.permission,
      input.resourceType,
      input.resourceId != null ? String(input.resourceId) : null,
      input.payload === undefined ? null : JSON.stringify(input.payload),
      input.reason,
      req.auth!.userId,
    ],
  );
  const row = await queryOne<Row>(`SELECT uuid FROM privileged_action_requests WHERE id = ?`, [id]);
  await writeAdminAudit({
    req,
    action: 'approval.request',
    entityType: input.resourceType,
    entityId: input.resourceId ?? id,
    permission: input.permission,
    reason: input.reason,
  });
  return {
    status: 'pending_approval' as const,
    requestUuid: String(row?.uuid),
    action: input.action,
    message: 'A second administrator must approve this action before it executes',
  };
}

export async function assertApproved(req: Request, approvalRequestUuid: string | undefined, action: string): Promise<void> {
  if (!approvalRequestUuid) return;
  const row = await queryOne<Row>(
    `SELECT * FROM privileged_action_requests WHERE uuid = ? AND action = ?`,
    [approvalRequestUuid, action],
  );
  if (!row) throw notFound('Approval request');
  if (String(row.status) !== 'approved') throw forbidden('This request has not been approved');
  if (Number(row.requested_by) !== req.auth!.userId) throw forbidden('Only the original requester can execute an approved action');
}

export async function markExecuted(approvalRequestUuid: string | undefined): Promise<void> {
  if (!approvalRequestUuid) return;
  await execute(
    `UPDATE privileged_action_requests SET status = 'executed', executed_at = CURRENT_TIMESTAMP WHERE uuid = ? AND status = 'approved'`,
    [approvalRequestUuid],
  );
}

export async function listApprovals(status = 'pending') {
  const rows = await queryRows<Row>(
    `SELECT uuid, action, permission_code, resource_type, resource_id, reason, status, requested_by, created_at
       FROM privileged_action_requests WHERE status = ? ORDER BY id DESC LIMIT 100`,
    [status],
  );
  return rows.map((row) => ({
    uuid: String(row.uuid),
    action: String(row.action),
    permission: String(row.permission_code),
    resourceType: String(row.resource_type),
    resourceId: (row.resource_id as string | null) ?? null,
    reason: String(row.reason),
    status: String(row.status),
    requestedBy: Number(row.requested_by),
    createdAt: (row.created_at as Date).toISOString(),
  }));
}

export async function decideApproval(req: Request, requestUuid: string, decision: 'approved' | 'rejected', reason: string) {
  const row = await queryOne<Row>(`SELECT * FROM privileged_action_requests WHERE uuid = ?`, [requestUuid]);
  if (!row) throw notFound('Approval request');
  if (String(row.status) !== 'pending') throw forbidden('This request is no longer pending');
  if (Number(row.requested_by) === req.auth!.userId) throw forbidden('A second administrator must decide this request');
  await execute(
    `UPDATE privileged_action_requests
        SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP, decision_reason = ?
      WHERE id = ?`,
    [decision, req.auth!.userId, reason, row.id],
  );
  await writeAdminAudit({
    req,
    action: `approval.${decision}`,
    entityType: 'privileged_action_request',
    entityId: requestUuid,
    permission: 'approval.decide',
    reason,
  });
  return { uuid: requestUuid, status: decision };
}
