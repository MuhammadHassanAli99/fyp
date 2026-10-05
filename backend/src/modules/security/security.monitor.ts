import { queryCount, queryRows, type Row } from '../../db/query';
import { loggerFor } from '../../config/logger';
import { recordAudit } from '../../middleware/audit';
import { AuthEvent, recordAuthEvent } from '../auth/auth.security';

const log = loggerFor('security.monitor');

export interface SecurityAlert {
  code: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  count: number;
  sample?: string | null;
}

/**
 * Detection rules over existing auth_security_events / login_attempts / audit_logs.
 * Does not create a second fraud engine — high-severity findings are recorded
 * as security events that Trust & Risk already consumes.
 */
export async function collectSecurityAlerts(): Promise<SecurityAlert[]> {
  const [bruteForce, stuffing, tokenReuse, massExport, escalation] = await Promise.all([
    queryRows<Row>(
      `SELECT identifier, COUNT(*) AS failures
         FROM login_attempts
        WHERE succeeded = 0 AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE)
        GROUP BY identifier
       HAVING COUNT(*) >= 8
        LIMIT 20`,
    ),
    queryRows<Row>(
      `SELECT COUNT(DISTINCT identifier) AS identities
         FROM login_attempts
        WHERE succeeded = 0 AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE)
        GROUP BY ip_address
       HAVING COUNT(DISTINCT identifier) >= 12
        LIMIT 20`,
    ),
    queryCount(
      `SELECT COUNT(*) FROM user_sessions
        WHERE revoked_reason = 'token_reuse_detected'
          AND revoked_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)`,
    ),
    queryCount(
      `SELECT COUNT(*) FROM audit_logs
        WHERE action IN ('privacy.export_completed','user.export','audit.export')
          AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)`,
    ),
    queryCount(
      `SELECT COUNT(*) FROM audit_logs
        WHERE action IN ('admin.role.assign','role.changed','permission.changed')
          AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)`,
    ),
  ]);

  const alerts: SecurityAlert[] = [];
  for (const row of bruteForce) {
    alerts.push({
      code: 'brute_force',
      severity: Number(row.failures) >= 20 ? 'critical' : 'high',
      count: Number(row.failures),
      sample: String(row.identifier).slice(0, 48),
    });
  }
  for (const row of stuffing) {
    alerts.push({
      code: 'credential_stuffing',
      severity: 'high',
      count: Number(row.identities),
      sample: null,
    });
  }
  if (tokenReuse > 0) alerts.push({ code: 'token_reuse', severity: 'critical', count: tokenReuse });
  if (massExport >= 20) alerts.push({ code: 'mass_data_access', severity: 'high', count: massExport });
  if (escalation >= 10) alerts.push({ code: 'permission_escalation_burst', severity: 'medium', count: escalation });
  return alerts;
}

export async function runSecurityMonitor(): Promise<{ alerts: number }> {
  const alerts = await collectSecurityAlerts();
  for (const alert of alerts.filter((item) => item.severity === 'high' || item.severity === 'critical')) {
    void recordAuthEvent({
      type: alert.code === 'brute_force' ? AuthEvent.ACCOUNT_LOCKED : AuthEvent.SUSPICIOUS_LOGIN,
      metadata: { monitor: alert.code, count: alert.count, sample: alert.sample },
    });
    void recordAudit({
      action: `security.alert.${alert.code}`,
      entityType: 'security_alert',
      actorType: 'system',
      after: alert,
    });
  }
  if (alerts.length > 0) {
    log.warn({ alerts: alerts.length, codes: alerts.map((item) => item.code) }, 'security monitor findings');
  }
  return { alerts: alerts.length };
}

export async function securityOverview() {
  const [openPrivacy, failedLogins, activeSessions, alerts] = await Promise.all([
    queryCount(`SELECT COUNT(*) FROM data_subject_requests WHERE status IN ('pending','in_progress')`),
    queryCount(
      `SELECT COUNT(*) FROM login_attempts WHERE succeeded = 0 AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)`,
    ),
    queryCount(`SELECT COUNT(*) FROM user_sessions WHERE revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`),
    collectSecurityAlerts(),
  ]);
  return {
    openPrivacyRequests: openPrivacy,
    failedLoginsLastHour: failedLogins,
    activeSessions,
    alerts,
  };
}
