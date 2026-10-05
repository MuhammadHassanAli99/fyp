import type { Request } from 'express';
import { queryCount, queryOne, queryRows, type Row } from '../../db/query';
import { remember } from '../../config/cache';
import { env } from '../../config/env';
import type { RiskSignalHit } from './risk.types';

const catalogueWeight = async (code: string, fallback: number): Promise<number> => {
  const map = await remember('risk:signal-weights', 120, async () => {
    const rows = await queryRows<Row>('SELECT code, weight FROM risk_signals WHERE is_active = 1');
    const out: Record<string, number> = {};
    for (const row of rows) out[String(row.code)] = Number(row.weight);
    return out;
  }).catch(() => ({}) as Record<string, number>);
  return map[code] ?? fallback;
};

const hit = async (code: string, fallback: number, detail?: string, category?: string): Promise<RiskSignalHit> => ({
  code,
  weight: await catalogueWeight(code, fallback),
  detail,
  category,
});

const listed = (listKind: 'blacklist' | 'whitelist', entryKind: string, value: string | null) =>
  value
    ? remember(`risk:${listKind}:${entryKind}:${value}`, 60, async () => {
        const count = await queryCount(
          `SELECT COUNT(*) FROM access_lists
            WHERE list_kind = ? AND entry_kind = ? AND value_text = ?
              AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
              AND (source <> 'development' OR ? = 'development')`,
          [listKind, entryKind, value, env.NODE_ENV],
        );
        return count > 0;
      })
    : Promise.resolve(false);

export async function collectRequestSignals(req: Request): Promise<RiskSignalHit[]> {
  const signals: RiskSignalHit[] = [];
  const ip = req.context.ip;
  const fingerprint = req.device.fingerprintHash;

  const [ipBanned, deviceBanned, userBanned, userTrusted, deviceTrusted] = await Promise.all([
    listed('blacklist', 'ip', ip),
    listed('blacklist', 'device', fingerprint),
    req.auth ? listed('blacklist', 'user', String(req.auth.userId)) : Promise.resolve(false),
    req.auth ? listed('whitelist', 'user', String(req.auth.userId)) : Promise.resolve(false),
    listed('whitelist', 'device', fingerprint),
  ]);

  if (ipBanned) signals.push(await hit('ip_blacklisted', 100, undefined, 'network'));
  if (deviceBanned) signals.push(await hit('device_blacklisted', 100, undefined, 'device'));
  if (userBanned) signals.push(await hit('user_blacklisted', 100, undefined, 'identity'));

  if (req.device.isEmulator) signals.push(await hit('device_emulator', 22, undefined, 'device'));
  if (req.device.isRooted) signals.push(await hit('device_rooted', 15, undefined, 'device'));
  if (req.device.isJailbroken) signals.push(await hit('device_jailbroken', 15, undefined, 'device'));
  if (req.device.isDebugging) signals.push(await hit('device_debugging', 12, undefined, 'device'));
  if (req.device.isAutomation) signals.push(await hit('device_automation', 18, undefined, 'device'));

  if (fingerprint) {
    const fp = await queryOne<Row>(
      'SELECT distinct_user_count, is_bot FROM device_fingerprints WHERE fingerprint_hash = ?',
      [fingerprint],
    );
    if (fp?.is_bot === 1) signals.push(await hit('device_bot', 40, undefined, 'device'));
    const shared = Number(fp?.distinct_user_count ?? 0);
    if (shared >= 10) signals.push(await hit('device_many_accounts', 35, String(shared), 'identity'));
    else if (shared >= 5) signals.push(await hit('device_several_accounts', 18, String(shared), 'identity'));
    else if (shared >= 2) signals.push(await hit('shared_device_accounts', 14, String(shared), 'identity'));
  }

  if (req.auth) {
    const standing = await queryOne<Row>(
      `SELECT score, band FROM risk_scores WHERE subject_kind = 'user' AND subject_id = ?`,
      [req.auth.userId],
    );
    if (standing) {
      if (standing.band === 'critical') signals.push(await hit('user_risk_critical', 60, undefined, 'identity'));
      else if (standing.band === 'high') signals.push(await hit('user_risk_high', 35, undefined, 'identity'));
      else if (Number(standing.score) >= 40) signals.push(await hit('user_risk_medium', 12, undefined, 'identity'));
    }

    const user = await queryOne<Row>('SELECT created_at, failed_login_count FROM users WHERE id = ?', [req.auth.userId]);
    if (user?.created_at) {
      const ageHours = (Date.now() - new Date(user.created_at as Date).getTime()) / 3_600_000;
      if (ageHours < 1) signals.push(await hit('account_very_new', 8, undefined, 'identity'));
    }
    if (Number(user?.failed_login_count ?? 0) >= 3) {
      signals.push(await hit('recent_failures', 10, undefined, 'behavior'));
    }

    const lastSession = await queryOne<Row>(
      `SELECT created_at, country_id FROM user_sessions
        WHERE user_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1`,
      [req.auth.userId],
    );
    if (
      lastSession?.country_id &&
      req.context.countryId &&
      Number(lastSession.country_id) !== req.context.countryId &&
      lastSession.created_at &&
      Date.now() - new Date(lastSession.created_at as Date).getTime() < 2 * 3_600_000
    ) {
      signals.push(await hit('impossible_travel', 28, undefined, 'geo'));
    }

    const sanctioned = await queryCount(
      `SELECT COUNT(*) FROM user_sanctions
        WHERE user_id = ? AND lifted_at IS NULL
          AND (is_permanent = 1 OR ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP)
          AND kind IN ('suspension','ban','posting_ban')`,
      [req.auth.userId],
    );
    if (sanctioned > 0) signals.push(await hit('active_sanction', 100, undefined, 'identity'));

    const verifiedBusiness = await queryCount(
      `SELECT COUNT(*) FROM business_members m
         JOIN business_profiles b ON b.id = m.business_id
        WHERE m.user_id = ? AND m.removed_at IS NULL AND b.verified_at IS NOT NULL`,
      [req.auth.userId],
    );
    if (verifiedBusiness > 0) signals.push(await hit('whitelist_verified_business', -12, undefined, 'identity'));
  }

  if (userTrusted) signals.push(await hit('whitelist_trusted_user', -20, undefined, 'identity'));
  if (deviceTrusted) signals.push(await hit('whitelist_trusted_device', -15, undefined, 'device'));

  return signals;
}

export { listed as isListed, catalogueWeight, hit as signalHit };
