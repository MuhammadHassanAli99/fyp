import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { uuid, referenceCode } from '../../core/security/crypto';
import { emitToUser } from '../../realtime/socket';

export async function openFraudCase(params: {
  subjectKind: string;
  subjectId: number;
  userId?: number | null;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  summary: string;
}): Promise<number> {
  const existing = await queryOne<Row>(
    `SELECT id FROM fraud_cases
      WHERE subject_kind = ? AND subject_id = ? AND status IN ('open','investigating','pending_info','escalated','appealed')
      LIMIT 1`,
    [params.subjectKind, params.subjectId],
  );
  if (existing) return Number(existing.id);

  const id = await insertAndGetId(
    `INSERT INTO fraud_cases
       (uuid, case_number, subject_kind, subject_id, user_id, category, severity, status, risk_score, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    [
      uuid(),
      referenceCode('FRD'),
      params.subjectKind,
      params.subjectId,
      params.userId ?? null,
      params.category,
      params.severity,
      params.riskScore,
      params.summary.slice(0, 500),
    ],
  );
  await addCaseEvent(id, 'opened', null, { summary: params.summary });
  return id;
}

export async function addCaseEvent(
  caseId: number,
  eventType: string,
  actorId: number | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await execute(
    `INSERT INTO fraud_case_events (case_id, event_type, actor_id, payload) VALUES (?, ?, ?, ?)`,
    [caseId, eventType.slice(0, 64), actorId, JSON.stringify(payload)],
  );
}

export async function updateFraudCase(params: {
  caseId: number;
  actorId: number;
  status?: string;
  assignedTo?: number | null;
  findings?: string | null;
  resolution?: string | null;
  isFalsePositive?: boolean;
}): Promise<void> {
  const row = await queryOne<Row>('SELECT id, user_id, status FROM fraud_cases WHERE id = ?', [params.caseId]);
  if (!row) return;
  await execute(
    `UPDATE fraud_cases
        SET status = COALESCE(?, status),
            assigned_to = COALESCE(?, assigned_to),
            findings = COALESCE(?, findings),
            resolution = COALESCE(?, resolution),
            resolved_at = IF(? IN ('resolved','closed','false_positive','confirmed'), CURRENT_TIMESTAMP, resolved_at),
            resolved_by = IF(? IN ('resolved','closed','false_positive','confirmed'), ?, resolved_by)
      WHERE id = ?`,
    [
      params.status ?? null,
      params.assignedTo ?? null,
      params.findings ?? null,
      params.resolution ?? null,
      params.status ?? '',
      params.status ?? '',
      params.actorId,
      params.caseId,
    ],
  );
  if (params.isFalsePositive) {
    await execute(`UPDATE fraud_cases SET status = 'false_positive' WHERE id = ?`, [params.caseId]);
  }
  await addCaseEvent(params.caseId, params.status ?? 'updated', params.actorId, {
    findings: params.findings ?? null,
  });
  if (row.user_id) {
    emitToUser(Number(row.user_id), 'risk:case', {
      caseId: params.caseId,
      status: params.status ?? row.status,
    });
  }
}

export async function listFraudCases(params: {
  status?: string;
  marketplace?: string;
  limit?: number;
}) {
  const clauses = ['1=1'];
  const values: unknown[] = [];
  if (params.status) {
    clauses.push('status = ?');
    values.push(params.status);
  }
  values.push(params.limit ?? 50);
  return queryRows<Row>(
    `SELECT id, uuid, case_number, subject_kind, subject_id, user_id, category, severity, status,
            risk_score, summary, assigned_to, opened_at, resolved_at
       FROM fraud_cases
      WHERE ${clauses.join(' AND ')}
      ORDER BY FIELD(severity,'critical','high','medium','low'), opened_at ASC
      LIMIT ?`,
    values,
  );
}

export async function getFraudCase(id: number) {
  const row = await queryOne<Row>('SELECT * FROM fraud_cases WHERE id = ?', [id]);
  if (!row) return null;
  const events = await queryRows<Row>(
    `SELECT id, event_type, actor_id, payload, created_at FROM fraud_case_events WHERE case_id = ? ORDER BY id`,
    [id],
  );
  const notes = await queryRows<Row>(
    `SELECT id, author_id, note, is_internal, created_at FROM fraud_case_notes WHERE case_id = ? ORDER BY id`,
    [id],
  );
  return { case: row, events, notes };
}
