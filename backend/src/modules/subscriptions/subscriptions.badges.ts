import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { loadEntitlements } from '../../middleware/entitlements';

/**
 * Dealer / Agency / Premium badges require:
 *   verification (business or identity) + entitlement + matching business kind.
 * A plan name alone never grants a badge.
 */
export async function syncSubscriptionBadges(userId: number): Promise<void> {
  const entitlements = await loadEntitlements(userId);
  const businesses = await queryRows<Row>(
    `SELECT kind, verified_at, status FROM business_profiles WHERE user_id = ?`,
    [userId],
  );

  const verifiedDealer = businesses.some(
    (row) => String(row.kind) === 'dealer' && row.verified_at && String(row.status) === 'active',
  );
  const verifiedAgency = businesses.some(
    (row) => String(row.kind) === 'agency' && row.verified_at && String(row.status) === 'active',
  );

  const grant: string[] = [];
  if (entitlements.features.premium_badge?.enabled) grant.push('premium');
  if (entitlements.features.dealer_badge?.enabled && verifiedDealer) grant.push('dealer');
  if (entitlements.features.agency_badge?.enabled && verifiedAgency) grant.push('agency');

  const subscriptionBadges = await queryRows<Row>(
    `SELECT id, code FROM badges WHERE kind = 'subscription' AND code IN ('premium','dealer','agency')`,
  );

  for (const badge of subscriptionBadges) {
    const code = String(badge.code);
    if (grant.includes(code)) {
      await execute(
        `INSERT INTO user_badges (user_id, badge_id)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE awarded_at = CURRENT_TIMESTAMP`,
        [userId, badge.id],
      );
    } else {
      await execute(`DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?`, [userId, badge.id]);
    }
  }
}

export async function isEligibleForBadge(userId: number, badgeCode: 'dealer' | 'agency' | 'premium'): Promise<boolean> {
  const entitlements = await loadEntitlements(userId);
  if (badgeCode === 'premium') return Boolean(entitlements.features.premium_badge?.enabled);
  const row = await queryOne<Row>(
    `SELECT id FROM business_profiles
      WHERE user_id = ? AND kind = ? AND verified_at IS NOT NULL AND status = 'active' LIMIT 1`,
    [userId, badgeCode === 'dealer' ? 'dealer' : 'agency'],
  );
  const feature = badgeCode === 'dealer' ? entitlements.features.dealer_badge : entitlements.features.agency_badge;
  return Boolean(feature?.enabled && row);
}
