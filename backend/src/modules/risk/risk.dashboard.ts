import { queryCount, queryRows, type Row } from '../../db/query';

export async function riskOverview(filters: { from?: string; to?: string }) {
  const range = filters.from
    ? ['created_at >= ?', filters.from]
    : ['created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)', null];
  const where = typeof range[1] === 'string' ? 'created_at >= ?' : String(range[0]);
  const params = typeof range[1] === 'string' ? [range[1]] : [];

  const [decisions, openCases, kycPending, amlHits, blacklisted] = await Promise.all([
    queryRows<Row>(
      `SELECT decision, COUNT(*) AS c FROM risk_decisions WHERE ${where} GROUP BY decision`,
      params,
    ),
    queryCount(`SELECT COUNT(*) FROM fraud_cases WHERE status IN ('open','investigating','pending_info','escalated','appealed')`),
    queryCount(`SELECT COUNT(*) FROM kyc_records WHERE status IN ('pending','in_review','requires_update')`),
    queryCount(`SELECT COUNT(*) FROM aml_screenings WHERE result IN ('potential_match','match')`),
    queryCount(
      `SELECT COUNT(*) FROM access_lists WHERE list_kind = 'blacklist' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
    ),
  ]);

  const byLevel = await queryRows<Row>(
    `SELECT risk_level, COUNT(*) AS c FROM risk_decisions WHERE ${where} GROUP BY risk_level`,
    params,
  );

  return {
    decisions: Object.fromEntries(decisions.map((row) => [String(row.decision), Number(row.c)])),
    levels: Object.fromEntries(byLevel.map((row) => [String(row.risk_level), Number(row.c)])),
    openCases,
    kycPending,
    amlHits,
    blacklisted,
    window: filters.from ?? '7d',
  };
}

export async function suspiciousSubjects(kind: 'user' | 'device' | 'ip', limit = 50) {
  if (kind === 'user') {
    return queryRows<Row>(
      `SELECT subject_id AS id, score, band, last_event_at
         FROM risk_scores WHERE subject_kind = 'user' AND band IN ('high','critical')
        ORDER BY score DESC LIMIT ?`,
      [limit],
    );
  }
  if (kind === 'device') {
    return queryRows<Row>(
      `SELECT id, fingerprint_hash, distinct_user_count, risk_score, is_emulator, is_bot, last_seen_at
         FROM device_fingerprints
        WHERE distinct_user_count >= 3 OR is_emulator = 1 OR IFNULL(risk_score,0) >= 40
        ORDER BY distinct_user_count DESC, last_seen_at DESC
        LIMIT ?`,
      [limit],
    );
  }
  return queryRows<Row>(
    `SELECT ip_text, threat_level, is_vpn, is_proxy, is_tor, distinct_user_count, risk_score
       FROM ip_reputation
      WHERE is_abuser = 1 OR threat_level IN ('high','critical') OR distinct_user_count >= 8
      ORDER BY IFNULL(risk_score,0) DESC LIMIT ?`,
    [limit],
  );
}

export async function multipleAccounts(limit = 50) {
  return queryRows<Row>(
    `SELECT fingerprint_hash, distinct_user_count, risk_score, last_seen_at
       FROM device_fingerprints
      WHERE distinct_user_count >= 2
      ORDER BY distinct_user_count DESC
      LIMIT ?`,
    [limit],
  );
}

export async function listDecisions(params: {
  decision?: string;
  riskLevel?: string;
  limit?: number;
}) {
  const clauses = ['1=1'];
  const values: unknown[] = [];
  if (params.decision) {
    clauses.push('decision = ?');
    values.push(params.decision);
  }
  if (params.riskLevel) {
    clauses.push('risk_level = ?');
    values.push(params.riskLevel);
  }
  values.push(params.limit ?? 50);
  return queryRows<Row>(
    `SELECT uuid, event_type, subject_kind, subject_id, user_id, risk_score, risk_level, decision,
            requires_review, model_id, model_version, created_at
       FROM risk_decisions
      WHERE ${clauses.join(' AND ')}
      ORDER BY id DESC
      LIMIT ?`,
    values,
  );
}
