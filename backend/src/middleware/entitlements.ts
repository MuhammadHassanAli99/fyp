import type { RequestHandler } from 'express';
import { AppError, ErrorCode, unauthenticated } from '../core/errors';
import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../db/query';
import type { PoolConnection } from '../db/pool';
import { cache, cacheKeys, remember } from '../config/cache';
import { uuid } from '../core/security/crypto';
import { addPeriod, isActiveStatus, mergeFeature, remainingOf, type FeatureState } from '../modules/subscriptions/subscriptions.rules';

/**
 * Subscription feature gating (§16).
 *
 * Two distinct questions, answered separately:
 *   - Is the feature *available* on my plan?  → `requireFeature` / `hasFeature`
 *   - Do I have *quota left* this period?      → `consumeQuota`
 *
 * Availability is cached; quota is not, because it changes on every use.
 * Application code must ask for an entitlement code, never a plan name.
 */
export interface Entitlements {
  planCode: string;
  planTier: number;
  subscriptionId: number | null;
  status: string;
  overLimit: boolean;
  features: Record<string, { enabled: boolean; limit: number | null; unlimited: boolean }>;
}

interface PlanRow extends Row {
  subscription_id: number | null;
  plan_id: number;
  plan_code: string;
  tier: number;
  status: string;
}

interface FeatureRow extends Row {
  feature_code: string;
  limit_value: string | null;
  is_unlimited: number;
  is_enabled: number;
}

const ACTIVE_SQL = `'trialing','active','past_due','grace_period'`;

export async function ensureDefaultSubscription(
  userId: number,
  executor?: PoolConnection,
): Promise<number | null> {
  const existing = await queryOne<Row>(
    `SELECT id FROM user_subscriptions
      WHERE user_id = ? AND status IN (${ACTIVE_SQL})
      ORDER BY id DESC LIMIT 1`,
    [userId],
    executor,
  );
  if (existing) return Number(existing.id);

  const plan = await queryOne<Row>(
    `SELECT id FROM subscription_plans WHERE is_default = 1 AND is_active = 1 ORDER BY tier ASC LIMIT 1`,
    [],
    executor,
  );
  if (!plan) return null;

  const start = new Date();
  const end = addPeriod(start, 'monthly');
  const id = await insertAndGetId(
    `INSERT INTO user_subscriptions
       (uuid, user_id, plan_id, status, quantity, current_period_start, current_period_end, auto_renew)
     VALUES (?, ?, ?, 'active', 1, ?, ?, 1)`,
    [uuid(), userId, plan.id, formatSql(start), formatSql(end)],
    executor,
  );
  await execute(
    `INSERT INTO subscription_history (subscription_id, from_plan_id, to_plan_id, change_kind, reason)
     VALUES (?, NULL, ?, 'create', 'default free plan')`,
    [id, plan.id],
    executor,
  );
  return id;
}

const formatSql = (date: Date): string => date.toISOString().slice(0, 19).replace('T', ' ');

/** Falls back to the default (free) plan when the user has no subscription. */
export async function loadEntitlements(userId: number): Promise<Entitlements> {
  return remember(cacheKeys.entitlements(userId), 120, async () => {
    await ensureDefaultSubscription(userId);

    const active = await queryOne<PlanRow>(
      `SELECT us.id AS subscription_id, p.id AS plan_id, p.code AS plan_code, p.tier, us.status
         FROM user_subscriptions us
         JOIN subscription_plans p ON p.id = us.plan_id
        WHERE us.user_id = ?
          AND us.status IN (${ACTIVE_SQL})
          AND (us.current_period_end IS NULL OR us.current_period_end > CURRENT_TIMESTAMP)
        ORDER BY p.tier DESC
        LIMIT 1`,
      [userId],
    );

    const plan =
      active ??
      (await queryOne<PlanRow>(
        `SELECT NULL AS subscription_id, id AS plan_id, code AS plan_code, tier, 'active' AS status
           FROM subscription_plans
          WHERE is_default = 1 AND is_active = 1
          ORDER BY tier ASC
          LIMIT 1`,
      ));

    if (!plan) {
      return { planCode: 'free', planTier: 0, subscriptionId: null, status: 'active', overLimit: false, features: {} };
    }

    const featureRows = await queryRows<FeatureRow>(
      'SELECT feature_code, limit_value, is_unlimited, is_enabled FROM plan_features WHERE plan_id = ?',
      [plan.plan_id],
    );

    const features: Entitlements['features'] = {};
    for (const row of featureRows) {
      features[row.feature_code] = {
        enabled: row.is_enabled === 1,
        limit: row.limit_value === null ? null : Number(row.limit_value),
        unlimited: row.is_unlimited === 1,
      };
    }

    if (plan.subscription_id) {
      const overrides = await queryRows<FeatureRow>(
        `SELECT feature_code, limit_value, is_unlimited, is_enabled
           FROM subscription_entitlement_overrides WHERE subscription_id = ?`,
        [plan.subscription_id],
      );
      for (const row of overrides) {
        const merged = mergeFeature(features[row.feature_code], {
          enabled: row.is_enabled === 1,
          limit: row.limit_value === null ? null : Number(row.limit_value),
          unlimited: row.is_unlimited === 1,
        });
        if (merged) features[row.feature_code] = merged;
      }
    }

    const overLimit = await computeOverLimit(userId, plan.subscription_id, features);

    return {
      planCode: plan.plan_code,
      planTier: Number(plan.tier),
      subscriptionId: plan.subscription_id,
      status: plan.status,
      overLimit,
      features,
    };
  });
}

async function computeOverLimit(
  userId: number,
  subscriptionId: number | null,
  features: Entitlements['features'],
): Promise<boolean> {
  const listingLimit = features.active_listings;
  if (!listingLimit?.enabled || listingLimit.unlimited || listingLimit.limit === null) return false;
  const used = await queryOne<Row>(
    `SELECT COUNT(*) AS n FROM listings
      WHERE user_id = ? AND deleted_at IS NULL
        AND status IN ('published','pending_review')`,
    [userId],
  );
  return Number(used?.n ?? 0) > listingLimit.limit;
}

export const invalidateEntitlements = (userId: number) => cache.del(cacheKeys.entitlements(userId));

export async function hasFeature(userId: number, featureCode: string): Promise<boolean> {
  const entitlements = await loadEntitlements(userId);
  return Boolean(entitlements.features[featureCode]?.enabled);
}

export async function assertFeature(userId: number, featureCode: string): Promise<Entitlements> {
  const entitlements = await loadEntitlements(userId);
  const feature = entitlements.features[featureCode];
  if (!feature?.enabled) {
    throw new AppError('This feature is not included in your current plan', {
      status: 403,
      code: ErrorCode.FEATURE_NOT_IN_PLAN,
      details: {
        feature: featureCode,
        currentPlan: entitlements.planCode,
        upgradeAvailable: true,
      },
    });
  }
  return entitlements;
}

/** Gate a route on plan availability (§16 AI Tools, Analytics, Video Upload…). */
export const requireFeature =
  (featureCode: string): RequestHandler =>
  (req, _res, next) => {
    void (async () => {
      if (!req.auth) throw unauthenticated();
      await assertFeature(req.auth.userId, featureCode);
      next();
    })().catch(next);
  };

export interface QuotaState {
  featureCode: string;
  used: number;
  limit: number | null;
  unlimited: boolean;
  remaining: number | null;
  currentPlan: string;
  upgradeAvailable: boolean;
}

function featureState(entitlements: Entitlements, featureCode: string): FeatureState | undefined {
  return entitlements.features[featureCode];
}

/** Reads current usage without consuming — used by dashboards and pre-flight checks. */
export async function getQuota(userId: number, featureCode: string): Promise<QuotaState> {
  const entitlements = await loadEntitlements(userId);
  const feature = featureState(entitlements, featureCode);
  const base = {
    featureCode,
    currentPlan: entitlements.planCode,
    upgradeAvailable: entitlements.planTier < 4,
  };

  if (!feature?.enabled) {
    if (featureCode === 'active_listings') {
      return { ...base, used: 0, limit: 25, unlimited: false, remaining: 25 };
    }
    if (featureCode === 'images_per_listing') {
      return { ...base, used: 0, limit: 10, unlimited: false, remaining: 10 };
    }
    return { ...base, used: 0, limit: 0, unlimited: false, remaining: 0 };
  }
  if (feature.unlimited) {
    return { ...base, used: 0, limit: null, unlimited: true, remaining: null };
  }

  const used = await readUsed(entitlements.subscriptionId, featureCode, userId);
  const limit = feature.limit ?? 0;
  return { ...base, used, limit, unlimited: false, remaining: remainingOf(used, limit, false) };
}

async function readUsed(subscriptionId: number | null, featureCode: string, userId: number): Promise<number> {
  if (featureCode === 'active_listings') {
    const row = await queryOne<Row>(
      `SELECT COUNT(*) AS n FROM listings
        WHERE user_id = ? AND deleted_at IS NULL
          AND status IN ('published','pending_review')`,
      [userId],
    );
    return Number(row?.n ?? 0);
  }
  if (featureCode === 'ad_campaigns') {
    const row = await queryOne<Row>(
      `SELECT COUNT(*) AS n FROM ad_campaigns c
         JOIN ad_advertisers a ON a.id = c.advertiser_id
        WHERE a.user_id = ? AND c.status NOT IN ('rejected','completed')`,
      [userId],
    );
    return Number(row?.n ?? 0);
  }
  if (!subscriptionId) return 0;
  const usage = await queryOne<Row & { used_value: string }>(
    `SELECT used_value FROM subscription_usage
      WHERE subscription_id = ? AND feature_code = ?
        AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE`,
    [subscriptionId, featureCode],
  );
  return usage ? Number(usage.used_value) : 0;
}

/**
 * Atomically consumes quota. The `UPDATE ... WHERE used_value + amount <= limit`
 * shape means two concurrent requests cannot both squeeze past the last slot.
 */
export async function consumeQuota(
  userId: number,
  featureCode: string,
  amount = 1,
  reference?: { type?: string; id?: number },
): Promise<QuotaState> {
  await ensureDefaultSubscription(userId);
  const entitlements = await loadEntitlements(userId);
  const feature = featureState(entitlements, featureCode);

  if (!feature?.enabled) {
    throw new AppError('This feature is not included in your current plan', {
      status: 403,
      code: ErrorCode.FEATURE_NOT_IN_PLAN,
      details: { feature: featureCode, currentPlan: entitlements.planCode, upgradeAvailable: true },
    });
  }
  if (feature.unlimited) {
    return getQuota(userId, featureCode);
  }

  const limit = feature.limit ?? 0;
  if (limit <= 0) {
    throw new AppError('Your plan does not allow this action', {
      status: 403,
      code: ErrorCode.QUOTA_EXCEEDED,
      details: { feature: featureCode, limit: 0, currentPlan: entitlements.planCode, upgradeAvailable: true },
    });
  }

  if (!entitlements.subscriptionId) {
    const used = await readUsed(null, featureCode, userId);
    if (used + amount > limit) {
      throw quotaExceeded(featureCode, limit, used, entitlements.planCode);
    }
    return getQuota(userId, featureCode);
  }

  if (featureCode === 'active_listings' || featureCode === 'ad_campaigns') {
    const used = await readUsed(entitlements.subscriptionId, featureCode, userId);
    if (used + amount > limit) {
      throw quotaExceeded(featureCode, limit, used, entitlements.planCode);
    }
    return getQuota(userId, featureCode);
  }

  await execute(
    `INSERT INTO subscription_usage (subscription_id, feature_code, period_start, period_end, used_value, limit_value, last_used_at)
     SELECT us.id, ?, DATE(us.current_period_start), DATE(us.current_period_end), 0, ?, CURRENT_TIMESTAMP
       FROM user_subscriptions us WHERE us.id = ?
     ON DUPLICATE KEY UPDATE limit_value = VALUES(limit_value)`,
    [featureCode, limit, entitlements.subscriptionId],
  );

  const result = await execute(
    `UPDATE subscription_usage
        SET used_value = used_value + ?, last_used_at = CURRENT_TIMESTAMP
      WHERE subscription_id = ? AND feature_code = ?
        AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE
        AND used_value + ? <= ?`,
    [amount, entitlements.subscriptionId, featureCode, amount, limit],
  );

  if (result.affectedRows === 0) {
    const used = await readUsed(entitlements.subscriptionId, featureCode, userId);
    throw quotaExceeded(featureCode, limit, used, entitlements.planCode);
  }

  const after = await readUsed(entitlements.subscriptionId, featureCode, userId);
  await execute(
    `INSERT INTO subscription_usage_events
       (subscription_id, user_id, feature_code, delta, used_after, limit_value, reference_type, reference_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entitlements.subscriptionId,
      userId,
      featureCode,
      amount,
      after,
      limit,
      reference?.type ?? null,
      reference?.id ?? null,
    ],
  );

  return getQuota(userId, featureCode);
}

function quotaExceeded(feature: string, limit: number, used: number, currentPlan: string): AppError {
  return new AppError('You have reached your plan limit for this billing period', {
    status: 403,
    code: ErrorCode.QUOTA_EXCEEDED,
    details: {
      feature,
      limit,
      used,
      remaining: 0,
      currentPlan,
      upgradeAvailable: true,
    },
  });
}

/** Releases quota when the action it was reserved for fails or is undone. */
export async function releaseQuota(userId: number, featureCode: string, amount = 1): Promise<void> {
  const entitlements = await loadEntitlements(userId);
  if (!entitlements.subscriptionId) return;
  await execute(
    `UPDATE subscription_usage
        SET used_value = GREATEST(0, used_value - ?)
      WHERE subscription_id = ? AND feature_code = ?
        AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE`,
    [amount, entitlements.subscriptionId, featureCode],
  );
  await execute(
    `INSERT INTO subscription_usage_events
       (subscription_id, user_id, feature_code, delta, used_after, limit_value)
     SELECT ?, ?, ?, ?, GREATEST(0, used_value), limit_value
       FROM subscription_usage
      WHERE subscription_id = ? AND feature_code = ?
        AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE`,
    [entitlements.subscriptionId, userId, featureCode, -amount, entitlements.subscriptionId, featureCode],
  );
}

export async function listUsage(userId: number): Promise<QuotaState[]> {
  const entitlements = await loadEntitlements(userId);
  const metered = Object.entries(entitlements.features).filter(
    ([, feature]) => feature.enabled && (feature.unlimited || feature.limit !== null),
  );
  const result: QuotaState[] = [];
  for (const [code] of metered) {
    result.push(await getQuota(userId, code));
  }
  return result;
}

/** Route-level metered gate. */
export const requireQuota =
  (featureCode: string, amount = 1): RequestHandler =>
  (req, _res, next) => {
    void (async () => {
      if (!req.auth) throw unauthenticated();
      await consumeQuota(req.auth.userId, featureCode, amount);
      next();
    })().catch(next);
  };

export { isActiveStatus };
