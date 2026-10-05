import { execute, queryRows, type Row } from '../../db/query';

export type GraphKind =
  | 'user'
  | 'device'
  | 'ip'
  | 'account'
  | 'listing'
  | 'review'
  | 'payment'
  | 'vin'
  | 'property'
  | 'gold_certificate'
  | 'email'
  | 'phone';

/**
 * Relationship strength is a 0..1 score of how tightly two entities are
 * linked, not a fraud verdict. Family / office / dealership sharing is
 * expected and must stay below the "likely coordinated abuse" band.
 */
export function relationshipStrength(input: {
  sharedDevices: number;
  sharedIps: number;
  sharedPayments: number;
  accountAgeHoursA: number;
  accountAgeHoursB: number;
  sameListingBurst: boolean;
}): number {
  let strength = 0;
  if (input.sharedDevices >= 1) strength += 0.25;
  if (input.sharedDevices >= 3) strength += 0.2;
  if (input.sharedIps >= 1) strength += 0.1;
  if (input.sharedIps >= 5) strength += 0.15;
  if (input.sharedPayments >= 1) strength += 0.35;
  if (input.sameListingBurst) strength += 0.2;
  const bothNew = input.accountAgeHoursA < 48 && input.accountAgeHoursB < 48;
  if (bothNew && input.sharedDevices >= 1) strength += 0.2;
  return Math.min(1, Number(strength.toFixed(4)));
}

export function isLikelyLegitimateShare(strength: number, extra: { sameFamilyOfficeHint?: boolean; verifiedBusiness?: boolean }): boolean {
  if (extra.verifiedBusiness) return strength < 0.85;
  if (extra.sameFamilyOfficeHint) return strength < 0.7;
  return strength < 0.45;
}

export async function upsertRelationship(params: {
  fromKind: GraphKind;
  fromKey: string;
  toKind: GraphKind;
  toKey: string;
  relType: string;
  strength: number;
  evidence?: Record<string, unknown>;
}): Promise<void> {
  await execute(
    `INSERT INTO risk_relationships (from_kind, from_key, to_kind, to_key, rel_type, strength, evidence)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       strength = GREATEST(strength, VALUES(strength)),
       evidence = VALUES(evidence),
       last_seen = CURRENT_TIMESTAMP`,
    [
      params.fromKind,
      params.fromKey.slice(0, 128),
      params.toKind,
      params.toKey.slice(0, 128),
      params.relType.slice(0, 48),
      params.strength,
      JSON.stringify(params.evidence ?? {}),
    ],
  ).catch(() => undefined);
}

export async function relatedUsersFor(kind: GraphKind, key: string): Promise<Array<{ userId: number; relType: string; strength: number }>> {
  const rows = await queryRows<Row>(
    `SELECT to_key, rel_type, strength FROM risk_relationships
      WHERE from_kind = ? AND from_key = ? AND to_kind = 'user'
     UNION ALL
     SELECT from_key, rel_type, strength FROM risk_relationships
      WHERE to_kind = ? AND to_key = ? AND from_kind = 'user'`,
    [kind, key, kind, key],
  );
  return rows
    .map((row) => ({
      userId: Number(row.to_key ?? row.from_key),
      relType: String(row.rel_type),
      strength: Number(row.strength),
    }))
    .filter((row) => Number.isFinite(row.userId));
}

export async function touchUserDeviceGraph(userId: number, fingerprintHash: string | null, ip: string | null): Promise<void> {
  if (fingerprintHash) {
    await upsertRelationship({
      fromKind: 'user',
      fromKey: String(userId),
      toKind: 'device',
      toKey: fingerprintHash,
      relType: 'USER_USES_DEVICE',
      strength: 0.4,
    });
  }
  if (ip) {
    await upsertRelationship({
      fromKind: 'user',
      fromKey: String(userId),
      toKind: 'ip',
      toKey: ip.slice(0, 45),
      relType: 'USER_USES_IP',
      strength: 0.2,
    });
  }
}
