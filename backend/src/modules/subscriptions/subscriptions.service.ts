import { execute, insertAndGetId, queryOne, queryRows, transaction, type Row } from '../../db/query';
import { AppError, ErrorCode, badRequest, notFound } from '../../core/errors';
import { uuid, randomHex } from '../../core/security/crypto';
import { toBoolean, toJson, toNumber } from '../../db/sql';
import { eventBus } from '../../core/events/event-bus';
import { recordAudit } from '../../middleware/audit';
import {
  consumeQuota,
  ensureDefaultSubscription,
  getQuota,
  invalidateEntitlements,
  listUsage,
  loadEntitlements,
} from '../../middleware/entitlements';
import { quoteTax } from '../billing/tax.service';
import { emitToUser } from '../../realtime/socket';
import { env } from '../../config/env';
import { startPaymentForOrder } from '../payments/payments.orchestrator';
import { syncSubscriptionBadges } from './subscriptions.badges';
import {
  addPeriod,
  exceedsLimit,
  isDowngrade,
  isUpgrade,
  overLimitMessage,
  type BillingInterval,
} from './subscriptions.rules';

const ACTIVE_SQL = `'trialing','active','past_due','grace_period'`;

const formatSql = (date: Date): string => date.toISOString().slice(0, 19).replace('T', ' ');

export async function listPlans(countryId: number | null, currency: string) {
  const planRows = await queryRows<Row>(
    `SELECT id, code, name, description, tier, audience, trial_days, badge_code, is_public, metadata, sort_order
       FROM subscription_plans
      WHERE is_active = 1 AND is_public = 1
      ORDER BY sort_order, tier`,
  );

  const priceRows = await queryRows<Row>(
    `SELECT pp.plan_id, pp.amount, pp.original_amount, pp.currency, pp.billing_interval, pp.country_id
       FROM plan_prices pp
      WHERE pp.is_active = 1
        AND pp.currency = ?
        AND (pp.country_id = ? OR pp.country_id IS NULL)
      ORDER BY pp.plan_id, (pp.country_id IS NULL), pp.billing_interval`,
    [currency, countryId],
  );

  const featureRows = await queryRows<Row>(
    `SELECT pf.plan_id, pf.feature_code, pf.limit_value, pf.is_unlimited, pf.is_enabled, f.name, f.unit, f.sort_order
       FROM plan_features pf
       JOIN features f ON f.code = pf.feature_code
      ORDER BY f.sort_order, f.code`,
  );

  return planRows.map((plan) => {
    const id = Number(plan.id);
    const prices = priceRows
      .filter((row) => Number(row.plan_id) === id)
      .reduce<Array<{ amount: number; originalAmount: number | null; currency: string; interval: string }>>(
        (acc, row) => {
          if (acc.some((item) => item.interval === String(row.billing_interval))) return acc;
          acc.push({
            amount: toNumber(row.amount) ?? 0,
            originalAmount: row.original_amount === null ? null : toNumber(row.original_amount),
            currency: String(row.currency),
            interval: String(row.billing_interval),
          });
          return acc;
        },
        [],
      );
    const features = featureRows
      .filter((row) => Number(row.plan_id) === id)
      .map((row) => ({
        code: String(row.feature_code),
        name: String(row.name),
        unit: String(row.unit),
        enabled: Number(row.is_enabled) === 1,
        unlimited: Number(row.is_unlimited) === 1,
        limit: row.limit_value === null ? null : Number(row.limit_value),
      }));
    return {
      id,
      code: String(plan.code),
      name: String(plan.name),
      description: (plan.description as string | null) ?? null,
      tier: Number(plan.tier),
      audience: String(plan.audience),
      trialDays: Number(plan.trial_days),
      badgeCode: (plan.badge_code as string | null) ?? null,
      metadata: toJson<Record<string, unknown>>(plan.metadata, {}),
      prices,
      price: prices.find((item) => item.interval === 'monthly') ?? prices[0] ?? null,
      features,
    };
  });
}

export async function getCurrentSubscription(userId: number) {
  await ensureDefaultSubscription(userId);
  const entitlements = await loadEntitlements(userId);
  const usage = await listUsage(userId);
  const row = await queryOne<Row>(
    `SELECT us.id, us.uuid, us.status, us.quantity, us.current_period_start, us.current_period_end,
            us.trial_end, us.auto_renew, us.gateway, us.cancel_at, us.cancelled_at, us.grace_period_ends_at,
            us.pending_plan_id, p.code AS plan_code, p.name AS plan_name, p.tier,
            pending.code AS pending_plan_code, pending.name AS pending_plan_name
       FROM user_subscriptions us
       JOIN subscription_plans p ON p.id = us.plan_id
       LEFT JOIN subscription_plans pending ON pending.id = us.pending_plan_id
      WHERE us.user_id = ?
        AND us.status IN (${ACTIVE_SQL},'paused','cancelled')
      ORDER BY FIELD(us.status,'active','trialing','past_due','grace_period','paused','cancelled'), p.tier DESC
      LIMIT 1`,
    [userId],
  );

  const overLimitFeatures = usage.filter(
    (item) => !item.unlimited && item.limit !== null && item.used > item.limit,
  );

  return {
    subscription: row
      ? {
          id: Number(row.id),
          uuid: String(row.uuid),
          status: String(row.status),
          planCode: String(row.plan_code),
          planName: String(row.plan_name),
          tier: Number(row.tier),
          quantity: Number(row.quantity),
          currentPeriodStart: row.current_period_start ? (row.current_period_start as Date).toISOString() : null,
          currentPeriodEnd: row.current_period_end ? (row.current_period_end as Date).toISOString() : null,
          trialEnd: row.trial_end ? (row.trial_end as Date).toISOString() : null,
          autoRenew: toBoolean(row.auto_renew),
          gateway: (row.gateway as string | null) ?? null,
          cancelAt: row.cancel_at ? (row.cancel_at as Date).toISOString() : null,
          cancelledAt: row.cancelled_at ? (row.cancelled_at as Date).toISOString() : null,
          gracePeriodEndsAt: row.grace_period_ends_at ? (row.grace_period_ends_at as Date).toISOString() : null,
          pendingPlanCode: (row.pending_plan_code as string | null) ?? null,
          pendingPlanName: (row.pending_plan_name as string | null) ?? null,
        }
      : null,
    entitlements,
    usage,
    overLimit: entitlements.overLimit || overLimitFeatures.length > 0,
    overLimitMessage:
      entitlements.overLimit || overLimitFeatures.length > 0
        ? overLimitMessage(
            overLimitFeatures[0]?.featureCode ?? 'active_listings',
            overLimitFeatures[0]?.used ?? 0,
            overLimitFeatures[0]?.limit ?? 0,
          )
        : null,
  };
}

async function loadPlanByCode(code: string) {
  const plan = await queryOne<Row>(
    `SELECT id, code, name, tier, trial_days, is_public, is_active
       FROM subscription_plans WHERE code = ? AND marketplace_id IS NULL AND is_active = 1`,
    [code],
  );
  if (!plan) throw notFound('Plan');
  return plan;
}

async function loadPrice(planId: number, currency: string, interval: BillingInterval, countryId: number | null) {
  const row =
    (await queryOne<Row>(
      `SELECT id, amount, currency, billing_interval
         FROM plan_prices
        WHERE plan_id = ? AND currency = ? AND billing_interval = ? AND is_active = 1
          AND (country_id = ? OR country_id IS NULL)
        ORDER BY (country_id IS NULL), id
        LIMIT 1`,
      [planId, currency, interval, countryId],
    )) ??
    (await queryOne<Row>(
      `SELECT id, amount, currency, billing_interval
         FROM plan_prices
        WHERE plan_id = ? AND billing_interval = ? AND is_active = 1 AND country_id IS NULL
        ORDER BY CASE currency WHEN 'USD' THEN 0 ELSE 1 END, id
        LIMIT 1`,
      [planId, interval],
    ));
  if (!row) throw badRequest('No chargeable price for this plan, currency and billing period');
  return row;
}

export async function checkout(userId: number, input: {
  planCode: string;
  billingInterval: BillingInterval;
  currency: string;
  countryId: number;
  gatewayCode: string;
  returnUrl?: string | null;
}) {
  const plan = await loadPlanByCode(input.planCode);
  const current = await getCurrentSubscription(userId);
  const fromTier = current.entitlements.planTier;
  const toTier = Number(plan.tier);

  if (String(plan.code) === current.entitlements.planCode && current.subscription?.status === 'active') {
    throw badRequest('You are already on this plan');
  }

  const price = await loadPrice(Number(plan.id), input.currency.toUpperCase(), input.billingInterval, input.countryId);
  const amount = toNumber(price.amount) ?? 0;
  const currency = String(price.currency);

  if (amount <= 0) {
    return activatePlan(userId, {
      planId: Number(plan.id),
      planCode: String(plan.code),
      priceId: Number(price.id),
      interval: input.billingInterval,
      gateway: 'manual',
      kind: isUpgrade(fromTier, toTier) ? 'upgrade' : isDowngrade(fromTier, toTier) ? 'downgrade' : 'create',
      actorId: userId,
    });
  }

  if (isDowngrade(fromTier, toTier)) {
    return scheduleDowngrade(userId, Number(plan.id), Number(price.id), String(plan.code));
  }

  const tax = await quoteTax({ countryId: input.countryId, amount, appliesTo: 'subscription' });
  const total = tax.grossAmount;
  const orderNumber = `ORD-${randomHex(3).toUpperCase()}`;
  const orderUuid = uuid();

  const orderId = await insertAndGetId(
    `INSERT INTO orders
       (uuid, order_number, user_id, kind, reference_type, reference_id, subtotal, discount_amount, tax_amount,
        total_amount, currency, status, gateway_code, country_id, metadata)
     VALUES (?, ?, ?, 'subscription', 'subscription_plan', ?, ?, 0, ?, ?, ?, 'awaiting_payment', ?, ?, ?)`,
    [
      orderUuid,
      orderNumber,
      userId,
      plan.id,
      tax.netAmount,
      tax.taxAmount,
      total,
      currency,
      input.gatewayCode,
      input.countryId,
      JSON.stringify({
        planCode: String(plan.code),
        planPriceId: Number(price.id),
        billingInterval: input.billingInterval,
        fromPlan: current.entitlements.planCode,
      }),
    ],
  );

  await execute(
    `INSERT INTO order_items
       (order_id, kind, description, reference_type, reference_id, quantity, unit_amount, total_amount, currency, tax_rate, tax_amount)
     VALUES (?, 'subscription', ?, 'subscription_plan', ?, 1, ?, ?, ?, ?, ?)`,
    [
      orderId,
      `${plan.name} (${input.billingInterval})`,
      plan.id,
      tax.netAmount,
      tax.netAmount,
      currency,
      tax.rate,
      tax.taxAmount,
    ],
  );

  const started = await startPaymentForOrder({
    orderId,
    userId,
    gatewayCode: input.gatewayCode,
    returnUrl: input.returnUrl,
  });

  return {
    requiresPayment: started.payment.status !== 'succeeded',
    ...started,
  };
}

async function scheduleDowngrade(userId: number, planId: number, priceId: number, planCode: string) {
  const current = await queryOne<Row>(
    `SELECT id, plan_id, current_period_end FROM user_subscriptions WHERE user_id = ? AND status IN (${ACTIVE_SQL}) ORDER BY id DESC LIMIT 1`,
    [userId],
  );
  if (!current) throw badRequest('No active subscription to change');

  const listingQuota = await getQuota(userId, 'active_listings');
  const target = await queryOne<Row>(
    `SELECT limit_value, is_unlimited FROM plan_features WHERE plan_id = ? AND feature_code = 'active_listings'`,
    [planId],
  );
  const newLimit = target && Number(target.is_unlimited) === 1 ? null : target ? Number(target.limit_value) : 0;
  const unlimited = target ? Number(target.is_unlimited) === 1 : false;
  const warning = exceedsLimit(listingQuota.used, newLimit, unlimited)
    ? overLimitMessage('active_listings', listingQuota.used, newLimit ?? 0)
    : null;

  await execute(
    `UPDATE user_subscriptions
        SET pending_plan_id = ?, pending_plan_price_id = ?, auto_renew = 0,
            cancel_at = current_period_end, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [planId, priceId, current.id],
  );

  await execute(
    `INSERT INTO subscription_history (subscription_id, from_plan_id, to_plan_id, change_kind, actor_id, reason)
     VALUES (?, ?, ?, 'downgrade', ?, 'scheduled at period end')`,
    [current.id, current.plan_id, planId, userId],
  );

  invalidateEntitlements(userId);
  emitToUser(userId, 'subscription:updated', { planCode, pending: true });

  return {
    requiresPayment: false,
    scheduled: true,
    planCode,
    effectiveAt: current.current_period_end ? (current.current_period_end as Date).toISOString() : null,
    overLimitMessage: warning,
  };
}

export async function changePlan(userId: number, input: {
  planCode: string;
  billingInterval: BillingInterval;
  currency: string;
  countryId: number;
  gatewayCode: string;
}) {
  return checkout(userId, input);
}

async function activatePlan(
  userId: number,
  input: {
    planId: number;
    planCode: string;
    priceId: number | null;
    interval: BillingInterval;
    gateway: string | null;
    gatewaySubscriptionId?: string | null;
    kind: 'create' | 'upgrade' | 'downgrade' | 'renew';
    actorId: number | null;
    orderId?: number;
  },
) {
  const start = new Date();
  const end = addPeriod(start, input.interval);
  const trialDays = Number(
    (await queryOne<Row>('SELECT trial_days FROM subscription_plans WHERE id = ?', [input.planId]))?.trial_days ?? 0,
  );
  const trialEnd =
    trialDays > 0 && input.kind !== 'renew' && input.kind !== 'upgrade' ? new Date(start.getTime()) : null;
  if (trialEnd) trialEnd.setUTCDate(trialEnd.getUTCDate() + trialDays);

  let subscriptionId = 0;
  const status = trialDays > 0 && input.kind !== 'renew' && input.kind !== 'upgrade' ? 'trialing' : 'active';

  await transaction(async (connection) => {
    const from = await queryOne<Row>(
      `SELECT id, plan_id FROM user_subscriptions
        WHERE user_id = ? AND status IN (${ACTIVE_SQL},'paused','cancelled','incomplete')
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [userId],
      connection,
    );
    if (from) {
      await execute(
        `UPDATE user_subscriptions
            SET plan_id = ?, plan_price_id = ?, status = ?, current_period_start = ?, current_period_end = ?,
                trial_start = ?, trial_end = ?, cancel_at = NULL, cancelled_at = NULL, ended_at = NULL,
                pending_plan_id = NULL, pending_plan_price_id = NULL, auto_renew = 1,
                gateway = ?, gateway_subscription_id = ?, latest_order_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [
          input.planId,
          input.priceId,
          status,
          formatSql(start),
          formatSql(end),
          trialEnd ? formatSql(start) : null,
          trialEnd ? formatSql(trialEnd) : null,
          input.gateway,
          input.gatewaySubscriptionId ?? null,
          input.orderId ?? null,
          from.id,
        ],
        connection,
      );
      subscriptionId = Number(from.id);
    } else {
      subscriptionId = await insertAndGetId(
        `INSERT INTO user_subscriptions
           (uuid, user_id, plan_id, plan_price_id, status, quantity, current_period_start, current_period_end,
            trial_start, trial_end, auto_renew, gateway, gateway_subscription_id, latest_order_id)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          uuid(),
          userId,
          input.planId,
          input.priceId,
          status,
          formatSql(start),
          formatSql(end),
          trialEnd ? formatSql(start) : null,
          trialEnd ? formatSql(trialEnd) : null,
          input.gateway,
          input.gatewaySubscriptionId ?? null,
          input.orderId ?? null,
        ],
        connection,
      );
    }

    await execute(
      `INSERT INTO subscription_history (subscription_id, from_plan_id, to_plan_id, change_kind, actor_id, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [subscriptionId, from ? from.plan_id : null, input.planId, input.kind, input.actorId, input.kind],
      connection,
    );

    const fromPlanCode = from
      ? String(
          (await queryOne<Row>('SELECT code FROM subscription_plans WHERE id = ?', [from.plan_id], connection))?.code ??
            '',
        )
      : '';
    const eventName =
      input.kind === 'upgrade'
        ? 'subscription.upgraded'
        : input.kind === 'downgrade'
          ? 'subscription.downgraded'
          : input.kind === 'renew'
            ? 'subscription.renewed'
            : 'subscription.started';

    const payload =
      eventName === 'subscription.upgraded' || eventName === 'subscription.downgraded'
        ? { subscriptionId, userId, fromPlan: fromPlanCode, toPlan: input.planCode }
        : eventName === 'subscription.renewed'
          ? { subscriptionId, userId, planCode: input.planCode, periodEnd: end.toISOString() }
          : { subscriptionId, userId, planCode: input.planCode };

    const event = await eventBus.enqueue(connection, eventName, 'subscription', subscriptionId, payload as never);
    void eventBus.publishAfterCommit(event);
  });

  invalidateEntitlements(userId);
  await syncSubscriptionBadges(userId);
  emitToUser(userId, 'subscription:updated', { planCode: input.planCode, status });
  await recordAudit({
    action: `subscription.${input.kind}`,
    entityType: 'subscription',
    entityId: userId,
    after: { planCode: input.planCode, status },
    actorId: input.actorId,
  });

  if (input.orderId) {
    await issueInvoice(userId, input.orderId, subscriptionId);
  }

  return {
    requiresPayment: false,
    scheduled: false,
    planCode: input.planCode,
    status,
    currentPeriodEnd: end.toISOString(),
  };
}

export async function applyPaidSubscriptionOrder(orderId: number): Promise<void> {
  const order = await queryOne<Row>(
    `SELECT id, user_id, kind, status, metadata, gateway_code FROM orders WHERE id = ?`,
    [orderId],
  );
  if (!order || String(order.kind) !== 'subscription') return;
  const metadata = toJson<Record<string, unknown>>(order.metadata, {});
  const planCode = String(metadata.planCode ?? '');
  if (!planCode) return;
  const plan = await loadPlanByCode(planCode);
  const interval = String(metadata.billingInterval ?? 'monthly') as BillingInterval;
  const fromPlan = String(metadata.fromPlan ?? 'free');
  const from = await queryOne<Row>('SELECT tier FROM subscription_plans WHERE code = ?', [fromPlan]);
  const kind = isUpgrade(Number(from?.tier ?? 0), Number(plan.tier))
    ? 'upgrade'
    : isDowngrade(Number(from?.tier ?? 0), Number(plan.tier))
      ? 'downgrade'
      : 'create';

  await activatePlan(Number(order.user_id), {
    planId: Number(plan.id),
    planCode,
    priceId: metadata.planPriceId ? Number(metadata.planPriceId) : null,
    interval,
    gateway: (order.gateway_code as string | null) ?? null,
    kind,
    actorId: Number(order.user_id),
    orderId,
  });
}

async function issueInvoice(userId: number, orderId: number, subscriptionId: number): Promise<void> {
  const order = await queryOne<Row>(
    `SELECT total_amount, tax_amount, subtotal, discount_amount, currency FROM orders WHERE id = ?`,
    [orderId],
  );
  if (!order) return;
  const existing = await queryOne<Row>('SELECT id FROM invoices WHERE order_id = ?', [orderId]);
  if (existing) return;
  const profile = await queryOne<Row>(
    `SELECT u.email, p.display_name FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`,
    [userId],
  );
  const invoiceId = await insertAndGetId(
    `INSERT INTO invoices
       (uuid, invoice_number, order_id, subscription_id, user_id, billing_name, billing_email,
        subtotal, discount_amount, tax_amount, total_amount, amount_paid, amount_due, currency, status, issued_at, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'paid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      uuid(),
      `INV-${randomHex(4).toUpperCase()}`,
      orderId,
      subscriptionId,
      userId,
      (profile?.display_name as string | null) ?? null,
      (profile?.email as string | null) ?? null,
      order.subtotal,
      order.discount_amount,
      order.tax_amount,
      order.total_amount,
      order.total_amount,
      order.currency,
    ],
  );
  await execute(
    `INSERT INTO invoice_items (invoice_id, description, quantity, unit_amount, total_amount, currency, tax_amount)
     SELECT ?, 'Subscription', 1, subtotal, total_amount, currency, tax_amount FROM orders WHERE id = ?`,
    [invoiceId, orderId],
  );
  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'invoice.issued', 'invoice', invoiceId, {
      invoiceId,
      userId,
      total: String(order.total_amount),
      currency: String(order.currency),
    });
    void eventBus.publishAfterCommit(event);
  });
}

export async function cancelSubscription(userId: number, when: 'immediate' | 'period_end', reason?: string) {
  const row = await queryOne<Row>(
    `SELECT id, plan_id, current_period_end, status FROM user_subscriptions
      WHERE user_id = ? AND status IN (${ACTIVE_SQL},'paused') ORDER BY id DESC LIMIT 1`,
    [userId],
  );
  if (!row) throw notFound('Subscription');
  const plan = await queryOne<Row>('SELECT code FROM subscription_plans WHERE id = ?', [row.plan_id]);
  const planCode = String(plan?.code ?? 'free');

  if (when === 'period_end') {
    await execute(
      `UPDATE user_subscriptions
          SET auto_renew = 0, cancel_at = current_period_end, cancel_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [reason ?? 'cancel at period end', row.id],
    );
    await execute(
      `INSERT INTO subscription_history (subscription_id, from_plan_id, to_plan_id, change_kind, actor_id, reason)
       VALUES (?, ?, ?, 'cancel', ?, ?)`,
      [row.id, row.plan_id, row.plan_id, userId, reason ?? 'period_end'],
    );
    await transaction(async (connection) => {
      const event = await eventBus.enqueue(connection, 'subscription.cancelled', 'subscription', Number(row.id), {
        subscriptionId: Number(row.id),
        userId,
        planCode,
        endsAt: row.current_period_end ? (row.current_period_end as Date).toISOString() : null,
      });
      void eventBus.publishAfterCommit(event);
    });
    emitToUser(userId, 'subscription:updated', { planCode, cancelAtPeriodEnd: true });
    return { cancelled: true, when: 'period_end', endsAt: row.current_period_end };
  }

  const free = await queryOne<Row>(`SELECT id, code FROM subscription_plans WHERE is_default = 1 AND is_active = 1 LIMIT 1`);
  await execute(
    `UPDATE user_subscriptions
        SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, ended_at = CURRENT_TIMESTAMP,
            auto_renew = 0, cancel_reason = ?, plan_id = COALESCE(?, plan_id), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [reason ?? 'immediate cancel', free?.id ?? null, row.id],
  );
  await execute(
    `INSERT INTO subscription_history (subscription_id, from_plan_id, to_plan_id, change_kind, actor_id, reason)
     VALUES (?, ?, ?, 'cancel', ?, ?)`,
    [row.id, row.plan_id, free?.id ?? row.plan_id, userId, reason ?? 'immediate'],
  );
  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'subscription.cancelled', 'subscription', Number(row.id), {
      subscriptionId: Number(row.id),
      userId,
      planCode,
      endsAt: new Date().toISOString(),
    });
    void eventBus.publishAfterCommit(event);
  });
  invalidateEntitlements(userId);
  await ensureDefaultSubscription(userId);
  await syncSubscriptionBadges(userId);
  emitToUser(userId, 'subscription:updated', { planCode: String(free?.code ?? 'free'), status: 'cancelled' });
  return { cancelled: true, when: 'immediate', endsAt: new Date().toISOString() };
}

export async function resumeSubscription(userId: number) {
  const row = await queryOne<Row>(
    `SELECT id, plan_id, status, cancel_at FROM user_subscriptions
      WHERE user_id = ? AND (status IN (${ACTIVE_SQL},'paused') OR (status = 'cancelled' AND ended_at IS NULL))
      ORDER BY id DESC LIMIT 1`,
    [userId],
  );
  if (!row) throw notFound('Subscription');
  await execute(
    `UPDATE user_subscriptions
        SET status = 'active', auto_renew = 1, cancel_at = NULL, cancelled_at = NULL, pending_plan_id = NULL,
            pending_plan_price_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [row.id],
  );
  await execute(
    `INSERT INTO subscription_history (subscription_id, from_plan_id, to_plan_id, change_kind, actor_id, reason)
     VALUES (?, ?, ?, 'resume', ?, 'resumed')`,
    [row.id, row.plan_id, row.plan_id, userId],
  );
  const plan = await queryOne<Row>('SELECT code FROM subscription_plans WHERE id = ?', [row.plan_id]);
  const planCode = String(plan?.code ?? '');
  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'subscription.resumed', 'subscription', Number(row.id), {
      subscriptionId: Number(row.id),
      userId,
      planCode,
    });
    void eventBus.publishAfterCommit(event);
  });
  invalidateEntitlements(userId);
  emitToUser(userId, 'subscription:updated', { planCode, status: 'active' });
  return { resumed: true, planCode };
}

export async function listInvoices(userId: number, limit = 50) {
  const rows = await queryRows<Row>(
    `SELECT uuid, invoice_number, total_amount, tax_amount, currency, status, issued_at, paid_at, pdf_url
       FROM invoices WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    [userId, limit],
  );
  return rows.map((row) => ({
    uuid: String(row.uuid),
    invoiceNumber: String(row.invoice_number),
    totalAmount: toNumber(row.total_amount) ?? 0,
    taxAmount: toNumber(row.tax_amount) ?? 0,
    currency: String(row.currency),
    status: String(row.status),
    issuedAt: row.issued_at ? (row.issued_at as Date).toISOString() : null,
    paidAt: row.paid_at ? (row.paid_at as Date).toISOString() : null,
    pdfUrl: (row.pdf_url as string | null) ?? null,
  }));
}

export async function verifyStorePurchase(userId: number, input: {
  provider: 'apple_pay' | 'google_play';
  productId: string;
  receipt: string;
  countryId: number;
  currency: string;
}) {
  if (env.isProduction) {
    throw new AppError('Store receipt verification driver is not configured', {
      status: 503,
      code: ErrorCode.NOT_IMPLEMENTED,
    });
  }
  if (!input.receipt || input.receipt.length < 8) throw badRequest('Invalid store receipt');
  const planCode = planCodeFromProductId(input.productId);
  return checkout(userId, {
    planCode,
    billingInterval: input.productId.includes('year') ? 'yearly' : 'monthly',
    currency: input.currency,
    countryId: input.countryId,
    gatewayCode: input.provider,
  });
}

function planCodeFromProductId(productId: string): string {
  const normalized = productId.toLowerCase();
  if (normalized.includes('enterprise')) return 'enterprise';
  if (normalized.includes('business')) return 'business';
  if (normalized.includes('professional') || normalized.includes('pro')) return 'professional';
  if (normalized.includes('starter')) return 'starter';
  return 'starter';
}

export async function applyEntitlementOverride(
  actorId: number,
  subscriptionId: number,
  featureCode: string,
  input: { limit?: number | null; unlimited?: boolean; enabled?: boolean; reason?: string },
) {
  await execute(
    `INSERT INTO subscription_entitlement_overrides
       (subscription_id, feature_code, limit_value, is_unlimited, is_enabled, reason, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       limit_value = VALUES(limit_value),
       is_unlimited = VALUES(is_unlimited),
       is_enabled = VALUES(is_enabled),
       reason = VALUES(reason),
       created_by = VALUES(created_by)`,
    [
      subscriptionId,
      featureCode,
      input.limit ?? null,
      input.unlimited ? 1 : 0,
      input.enabled === false ? 0 : 1,
      input.reason ?? 'enterprise override',
      actorId,
    ],
  );
  const sub = await queryOne<Row>('SELECT user_id FROM user_subscriptions WHERE id = ?', [subscriptionId]);
  if (sub) {
    invalidateEntitlements(Number(sub.user_id));
    emitToUser(Number(sub.user_id), 'subscription:updated', { override: featureCode });
  }
  await execute(
    `INSERT INTO subscription_history (subscription_id, change_kind, actor_id, reason)
     VALUES (?, 'override', ?, ?)`,
    [subscriptionId, actorId, `${featureCode}: ${input.reason ?? 'custom'}`],
  );
}

export { consumeQuota };
