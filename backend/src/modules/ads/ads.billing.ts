import { execute, insertAndGetId, queryOne, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { eventBus } from '../../core/events/event-bus';
import { transaction } from '../../db/query';
import { createOrder } from '../payments/payments.service';
import { badRequest, notFound } from '../../core/errors';

export async function creditAdvertiserFromOrder(orderId: number, paymentId: number): Promise<void> {
  const order = await queryOne<Row>(
    `SELECT id, kind, reference_type, reference_id, metadata, status, total_amount, currency, user_id
       FROM orders WHERE id = ?`,
    [orderId],
  );
  if (!order) return;
  if (String(order.kind) !== 'advertisement') return;

  const creditReason = `budget_credit:${orderId}`;
  const already = await queryOne<Row>(
    `SELECT id FROM ad_spend_events WHERE reason = ? LIMIT 1`,
    [creditReason],
  );
  if (already) return;

  const campaign = await queryOne<Row>(
    `SELECT c.id, c.advertiser_id, c.currency, c.status, a.user_id
       FROM ad_campaigns c
       JOIN ad_advertisers a ON a.id = c.advertiser_id
      WHERE c.id = ?`,
    [order.reference_id],
  );
  if (!campaign) return;
  if (Number(order.user_id) !== Number(campaign.user_id)) return;

  const amount = toNumber(order.total_amount) ?? 0;
  if (amount <= 0) return;

  await execute(`UPDATE ad_advertisers SET balance = balance + ? WHERE id = ?`, [amount, campaign.advertiser_id]);
  await execute(`UPDATE ad_campaigns SET order_id = COALESCE(order_id, ?) WHERE id = ?`, [orderId, campaign.id]);
  await insertAndGetId(
    `INSERT INTO ad_spend_events (campaign_id, pricing_model, amount, currency, billed, reason)
     VALUES (?, 'fixed', ?, ?, 0, ?)`,
    [campaign.id, amount, String(order.currency), creditReason],
  );

  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'ad.budget_credited', 'ad_campaign', Number(campaign.id), {
      campaignId: Number(campaign.id),
      advertiserId: Number(campaign.advertiser_id),
      amount: String(amount),
      currency: String(order.currency),
      paymentId,
      orderId,
    });
    void eventBus.publishAfterCommit(event);
  });
}

export async function fundCampaign(params: {
  userId: number;
  campaignId: number;
  amount: number;
  currency: string;
  countryId: number;
  gatewayCode: string;
  paymentMethod?: string | null;
  returnUrl?: string | null;
}) {
  if (params.amount <= 0) throw badRequest('Amount must be positive');
  const campaign = await queryOne<Row>(
    `SELECT c.id, c.uuid, c.currency, a.user_id
       FROM ad_campaigns c
       JOIN ad_advertisers a ON a.id = c.advertiser_id
      WHERE c.id = ?`,
    [params.campaignId],
  );
  if (!campaign) throw notFound('Campaign');
  if (Number(campaign.user_id) !== params.userId) throw notFound('Campaign');

  return createOrder(params.userId, {
    kind: 'advertisement',
    amount: params.amount,
    currency: params.currency || String(campaign.currency),
    countryId: params.countryId,
    gatewayCode: params.gatewayCode,
    paymentMethod: params.paymentMethod,
    returnUrl: params.returnUrl,
    description: `Ad budget for campaign ${String(campaign.uuid)}`,
    referenceType: 'ad_campaign',
    referenceId: params.campaignId,
    metadata: { campaignId: params.campaignId, campaignUuid: String(campaign.uuid) },
  });
}

export async function applySpend(params: {
  campaignId: number;
  advertiserId: number;
  amount: number;
  currency: string;
  pricingModel: string;
  impressionId?: number | null;
  clickId?: number | null;
}): Promise<boolean> {
  if (params.amount <= 0) return false;
  const billed = await execute(
    `UPDATE ad_advertisers
        SET balance = balance - ?
      WHERE id = ? AND (balance + credit_limit) >= ?`,
    [params.amount, params.advertiserId, params.amount],
  );
  if (billed.affectedRows === 0) return false;

  await execute(`UPDATE ad_campaigns SET spent_amount = spent_amount + ? WHERE id = ?`, [params.amount, params.campaignId]);
  await insertAndGetId(
    `INSERT INTO ad_spend_events (campaign_id, impression_id, click_id, pricing_model, amount, currency, billed, reason)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'delivery')`,
    [
      params.campaignId,
      params.impressionId ?? null,
      params.clickId ?? null,
      params.pricingModel,
      params.amount,
      params.currency,
    ],
  );

  const campaign = await queryOne<Row>(
    `SELECT id, advertiser_id, spent_amount, total_budget FROM ad_campaigns WHERE id = ?`,
    [params.campaignId],
  );
  if (
    campaign &&
    campaign.total_budget !== null &&
    Number(campaign.spent_amount) >= Number(campaign.total_budget)
  ) {
    await execute(`UPDATE ad_campaigns SET status = 'exhausted' WHERE id = ? AND status = 'active'`, [params.campaignId]);
    await transaction(async (connection) => {
      const event = await eventBus.enqueue(connection, 'ad_campaign.budget_exhausted', 'ad_campaign', params.campaignId, {
        campaignId: params.campaignId,
        advertiserId: params.advertiserId,
      });
      void eventBus.publishAfterCommit(event);
    });
  }
  return true;
}
