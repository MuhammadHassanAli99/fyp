import { execute, queryOne, type Row } from '../../db/query';
import { packIp } from '../../core/security/crypto';
import { loggerFor } from '../../config/logger';
import { ipReputationDriver } from '../../providers/ip-reputation';
import { signalHit } from './risk.signals';
import type { RiskSignalHit } from './risk.types';

const log = loggerFor('risk.ip');

export async function cachedIpSignals(ip: string | null): Promise<RiskSignalHit[]> {
  if (!ip) return [];
  const packed = packIp(ip);
  if (!packed) return [];

  const row = await queryOne<Row>(
    `SELECT is_vpn, is_proxy, is_tor, is_datacenter, is_abuser, threat_level
       FROM ip_reputation WHERE ip_address = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
    [packed],
  );
  if (!row) return [];
  return signalsFromReputation({
    isVpn: row.is_vpn === 1,
    isProxy: row.is_proxy === 1,
    isTor: row.is_tor === 1,
    isDatacenter: row.is_datacenter === 1,
    isAbuser: row.is_abuser === 1,
    threatLevel: String(row.threat_level ?? 'none'),
  });
}

export async function refreshIpReputation(ip: string): Promise<void> {
  const packed = packIp(ip);
  if (!packed) return;
  try {
    const lookup = await ipReputationDriver().lookup(ip);
    if (!lookup) return;
    const expires = new Date(Date.now() + lookup.ttlSeconds * 1000);
    await execute(
      `INSERT INTO ip_reputation
         (ip_address, ip_text, asn, asn_org, is_vpn, is_proxy, is_tor, is_datacenter, is_relay, is_abuser,
          threat_level, risk_score, provider, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         asn = VALUES(asn), asn_org = VALUES(asn_org), is_vpn = VALUES(is_vpn), is_proxy = VALUES(is_proxy),
         is_tor = VALUES(is_tor), is_datacenter = VALUES(is_datacenter), is_relay = VALUES(is_relay),
         is_abuser = VALUES(is_abuser), threat_level = VALUES(threat_level), risk_score = VALUES(risk_score),
         provider = VALUES(provider), checked_at = CURRENT_TIMESTAMP, expires_at = VALUES(expires_at)`,
      [
        packed,
        ip.slice(0, 45),
        lookup.asn ?? null,
        lookup.asnOrg ?? null,
        lookup.isVpn ? 1 : 0,
        lookup.isProxy ? 1 : 0,
        lookup.isTor ? 1 : 0,
        lookup.isDatacenter ? 1 : 0,
        lookup.isRelay ? 1 : 0,
        lookup.isAbuser ? 1 : 0,
        lookup.threatLevel,
        lookup.riskScore,
        lookup.provider,
        expires,
      ],
    );
  } catch (error) {
    log.warn({ err: error }, 'IP reputation lookup failed');
  }
}

export async function signalsFromReputation(rep: {
  isVpn: boolean;
  isProxy: boolean;
  isTor: boolean;
  isDatacenter: boolean;
  isAbuser: boolean;
  threatLevel: string;
}): Promise<RiskSignalHit[]> {
  const signals: RiskSignalHit[] = [];
  if (rep.isTor) signals.push(await signalHit('ip_tor', 35, undefined, 'network'));
  if (rep.isProxy) signals.push(await signalHit('ip_proxy', 20, undefined, 'network'));
  if (rep.isVpn) signals.push(await signalHit('ip_vpn', 12, undefined, 'network'));
  if (rep.isDatacenter) signals.push(await signalHit('ip_datacenter', 18, undefined, 'network'));
  if (rep.isAbuser) signals.push(await signalHit('ip_abuser', 45, undefined, 'network'));
  if (rep.threatLevel === 'critical') signals.push(await signalHit('ip_threat_critical', 50, undefined, 'network'));
  else if (rep.threatLevel === 'high') signals.push(await signalHit('ip_threat_high', 30, undefined, 'network'));
  return signals;
}
