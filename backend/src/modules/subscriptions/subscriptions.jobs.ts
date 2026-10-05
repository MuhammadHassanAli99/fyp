import { execute, queryRows, transaction, type Row } from '../../db/query';
import { eventBus } from '../../core/events/event-bus';
import { ensureDefaultSubscription, invalidateEntitlements } from '../../middleware/entitlements';
import { emitToUser } from '../../realtime/socket';
import { loggerFor } from '../../config/logger';
import { addPeriod } from './subscriptions.rules';
import { syncSubscriptionBadges } from './subscriptions.badges';

const log = loggerFor('subscriptions.jobs');
const formatSql = (date: Date): string => date.toISOString().slice(0, 19).replace('T', ' ');

export async function runSubscriptionLifecycle(limit = 200): Promise<number> {
  let processed = 0;
  processed += await applyPendingPlanChanges(limit);
  processed += await expireEndedSubscriptions(limit);
  processed += await renewFreePeriods(limit);
  processed += await advanceDunning(limit);
  return processed;
}

async function applyPendingPlanChanges(limit: number): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT id, user_id, plan_id, pending_plan_id, pending_plan_price_id
       FROM user_subscriptions
      WHERE pending_plan_id IS NOT NULL
        AND current_period_end IS NOT NULL
        AND current_period_end <= CURRENT_TIMESTAMP
      LIMIT ?`,
    [limit],
  );
  for (const row of rows) {
    const start = new Date();
    const end = addPeriod(start, 'monthly');
    await execute(
      `UPDATE user_subscriptions
          SET plan_id = pending_plan_id,
              plan_price_id = pending_plan_price_id,
              pending_plan_id = NULL,
              pending_plan_price_id = NULL,
              status = 'active',
              current_period_start = ?,
              current_period_end = ?,
              cancel_at = NULL,
              auto_renew = 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [formatSql(start), formatSql(end), row.id],
    );
    await execute(
      `INSERT INTO subscription_history (subscription_id, from_plan_id, to_plan_id, change_kind, reason)
       VALUES (?, ?, ?, 'downgrade', 'applied at period end')`,
      [row.id, row.plan_id, row.pending_plan_id],
    );
    invalidateEntitlements(Number(row.user_id));
    await syncSubscriptionBadges(Number(row.user_id));
    emitToUser(Number(row.user_id), 'subscription:updated', { appliedPending: true });
  }
  return rows.length;
}

async function expireEndedSubscriptions(limit: number): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT us.id, us.user_id, p.code AS plan_code
       FROM user_subscriptions us
       JOIN subscription_plans p ON p.id = us.plan_id
      WHERE us.status IN ('active','trialing','cancelled')
        AND us.auto_renew = 0
        AND us.pending_plan_id IS NULL
        AND us.current_period_end IS NOT NULL
        AND us.current_period_end <= CURRENT_TIMESTAMP
        AND (us.cancel_at IS NOT NULL OR us.status = 'cancelled')
      LIMIT ?`,
    [limit],
  );
  for (const row of rows) {
    await execute(
      `UPDATE user_subscriptions
          SET status = 'expired', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [row.id],
    );
    await execute(
      `INSERT INTO subscription_history (subscription_id, change_kind, reason) VALUES (?, 'expire', 'period ended')`,
      [row.id],
    );
    await transaction(async (connection) => {
      const event = await eventBus.enqueue(connection, 'subscription.expired', 'subscription', Number(row.id), {
        subscriptionId: Number(row.id),
        userId: Number(row.user_id),
        planCode: String(row.plan_code),
      });
      void eventBus.publishAfterCommit(event);
    });
    invalidateEntitlements(Number(row.user_id));
    await ensureDefaultSubscription(Number(row.user_id));
    emitToUser(Number(row.user_id), 'subscription:updated', { status: 'expired' });
  }
  return rows.length;
}

async function renewFreePeriods(limit: number): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT us.id, us.user_id, us.current_period_end
       FROM user_subscriptions us
       JOIN subscription_plans p ON p.id = us.plan_id
      WHERE us.status = 'active' AND us.auto_renew = 1
        AND p.tier = 0
        AND us.current_period_end IS NOT NULL
        AND us.current_period_end <= CURRENT_TIMESTAMP
      LIMIT ?`,
    [limit],
  );
  for (const row of rows) {
    const start = new Date();
    const end = addPeriod(start, 'monthly');
    await execute(
      `UPDATE user_subscriptions
          SET current_period_start = ?, current_period_end = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [formatSql(start), formatSql(end), row.id],
    );
  }
  return rows.length;
}

async function advanceDunning(limit: number): Promise<number> {
  const pastDue = await queryRows<Row>(
    `SELECT id, user_id FROM user_subscriptions
      WHERE status = 'past_due'
        AND (grace_period_ends_at IS NULL OR grace_period_ends_at <= DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 3 DAY))
      LIMIT ?`,
    [limit],
  );
  for (const row of pastDue) {
    const graceEnd = new Date();
    graceEnd.setUTCDate(graceEnd.getUTCDate() + 3);
    await execute(
      `UPDATE user_subscriptions SET status = 'grace_period', grace_period_ends_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [formatSql(graceEnd), row.id],
    );
    invalidateEntitlements(Number(row.user_id));
  }

  const expiredGrace = await queryRows<Row>(
    `SELECT id, user_id FROM user_subscriptions
      WHERE status = 'grace_period' AND grace_period_ends_at IS NOT NULL AND grace_period_ends_at <= CURRENT_TIMESTAMP
      LIMIT ?`,
    [limit],
  );
  for (const row of expiredGrace) {
    await execute(
      `UPDATE user_subscriptions SET status = 'expired', ended_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [row.id],
    );
    invalidateEntitlements(Number(row.user_id));
    await ensureDefaultSubscription(Number(row.user_id));
    emitToUser(Number(row.user_id), 'subscription:updated', { status: 'expired' });
  }
  return pastDue.length + expiredGrace.length;
}

export async function markPaymentFailed(subscriptionId: number, userId: number, attempt: number): Promise<void> {
  await execute(
    `UPDATE user_subscriptions SET status = 'past_due', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [subscriptionId],
  );
  invalidateEntitlements(userId);
  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'subscription.payment_failed', 'subscription', subscriptionId, {
      subscriptionId,
      userId,
      attempt,
    });
    void eventBus.publishAfterCommit(event);
  });
  emitToUser(userId, 'subscription:updated', { status: 'past_due' });
  log.warn({ subscriptionId, userId, attempt }, 'subscription payment failed');
}
