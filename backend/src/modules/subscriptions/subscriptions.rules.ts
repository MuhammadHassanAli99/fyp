/**
 * Pure subscription rules. Entitlement decisions never branch on plan name.
 */

export const ACTIVE_SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'grace_period',
] as const;

export type ActiveSubscriptionStatus = (typeof ACTIVE_SUBSCRIPTION_STATUSES)[number];

export const BILLING_INTERVALS = ['monthly', 'quarterly', 'semi_annual', 'yearly', 'lifetime'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export function isActiveStatus(status: string): boolean {
  return (ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

export function isUpgrade(fromTier: number, toTier: number): boolean {
  return toTier > fromTier;
}

export function isDowngrade(fromTier: number, toTier: number): boolean {
  return toTier < fromTier;
}

export function isSamePlan(fromCode: string, toCode: string): boolean {
  return fromCode === toCode;
}

export function periodDays(interval: BillingInterval): number {
  switch (interval) {
    case 'monthly':
      return 30;
    case 'quarterly':
      return 90;
    case 'semi_annual':
      return 182;
    case 'yearly':
      return 365;
    case 'lifetime':
      return 36500;
    default:
      return 30;
  }
}

export function addPeriod(from: Date, interval: BillingInterval): Date {
  const next = new Date(from.getTime());
  switch (interval) {
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next;
    case 'quarterly':
      next.setUTCMonth(next.getUTCMonth() + 3);
      return next;
    case 'semi_annual':
      next.setUTCMonth(next.getUTCMonth() + 6);
      return next;
    case 'yearly':
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      return next;
    case 'lifetime':
      next.setUTCFullYear(next.getUTCFullYear() + 100);
      return next;
    default:
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next;
  }
}

export interface FeatureState {
  enabled: boolean;
  limit: number | null;
  unlimited: boolean;
}

export function mergeFeature(
  base: FeatureState | undefined,
  override: FeatureState | undefined,
): FeatureState | undefined {
  if (!override) return base;
  if (!base) return override;
  return {
    enabled: override.enabled,
    limit: override.unlimited ? null : override.limit,
    unlimited: override.unlimited,
  };
}

export function remainingOf(used: number, limit: number | null, unlimited: boolean): number | null {
  if (unlimited || limit === null) return null;
  return Math.max(0, limit - used);
}

export function exceedsLimit(currentUsage: number, newLimit: number | null, unlimited: boolean): boolean {
  if (unlimited || newLimit === null) return false;
  return currentUsage > newLimit;
}

export function overLimitMessage(featureCode: string, used: number, newLimit: number): string {
  return `Your current usage exceeds your new plan limit (${used} ${featureCode}, limit ${newLimit}). Existing resources are kept. New creation is restricted until you upgrade or reduce usage.`;
}

export type WebhookOutcome =
  | 'payment_succeeded'
  | 'payment_failed'
  | 'refund_succeeded'
  | 'subscription_created'
  | 'subscription_renewed'
  | 'subscription_cancelled'
  | 'subscription_paused'
  | 'subscription_resumed'
  | 'subscription_expired'
  | 'chargeback'
  | 'unknown';

export function classifyWebhookType(rawType: string): WebhookOutcome {
  const type = rawType.toLowerCase();
  if (type.includes('chargeback') || type.includes('dispute')) return 'chargeback';
  if (type.includes('refund')) return 'refund_succeeded';
  if (type.includes('fail') || type.includes('unpaid')) return 'payment_failed';
  if (type.includes('paused')) return 'subscription_paused';
  if (type.includes('resumed') || type.includes('reactiv')) return 'subscription_resumed';
  if (type.includes('expired')) return 'subscription_expired';
  if (type.includes('cancel') || (type.includes('subscription') && type.includes('delet'))) {
    return 'subscription_cancelled';
  }
  if (type.includes('renew')) return 'subscription_renewed';
  if (type.includes('subscription') && (type.includes('creat') || type.includes('started'))) {
    return 'subscription_created';
  }
  if (type.includes('succe') || type.includes('paid') || type.includes('captured')) return 'payment_succeeded';
  return 'unknown';
}

export function rankingBoostFromEntitlement(hasHigherRanking: boolean, featured: boolean, boosted: boolean): number {
  let boost = 0;
  if (hasHigherRanking) boost += 0.08;
  if (featured) boost += 0.04;
  if (boosted) boost += 0.03;
  return boost;
}
