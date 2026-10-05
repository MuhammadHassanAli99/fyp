import { eventBus } from '../../core/events/event-bus';
import { queryOne, queryRows, type Row } from '../../db/query';
import { loggerFor } from '../../config/logger';
import { notifyUser } from './notifications.orchestrator';

const log = loggerFor('notify.events');

/**
 * Domain events → NotificationService. Marketplace modules that already call
 * notifyUser keep doing so; this covers auth, payments, subscriptions, reviews,
 * favorites, price drops and fraud that were not fanning out before.
 */
export function registerNotificationEventHandlers(): void {
  eventBus.on('user.registered', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'account.welcome',
      eventType: 'user.registered',
      eventId: event.id,
      actionType: 'system',
      priority: 'normal',
    });
  });

  eventBus.on('user.new_device', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'security.new_device',
      eventType: 'user.new_device',
      eventId: event.id,
      entityType: 'device',
      entityId: event.payload.deviceId,
      actionType: 'security',
      priority: 'CRITICAL',
    });
  });

  eventBus.on('user.logged_in', async (event) => {
    if (event.payload.riskScore < 70) return;
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'security.suspicious_login',
      eventType: 'user.logged_in',
      eventId: event.id,
      actionType: 'security',
      priority: 'CRITICAL',
    });
  });

  eventBus.on('user.password_changed', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'account.password_changed',
      eventType: 'user.password_changed',
      eventId: event.id,
      actionType: 'security',
      priority: 'CRITICAL',
    });
  });

  eventBus.on('user.email_verified', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'account.email_verified',
      eventType: 'user.email_verified',
      eventId: event.id,
      actionType: 'system',
      priority: 'normal',
    });
  });

  eventBus.on('user.phone_verified', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'account.phone_verified',
      eventType: 'user.phone_verified',
      eventId: event.id,
      actionType: 'system',
      priority: 'normal',
    });
  });

  eventBus.on('payment.succeeded', async (event) => {
    const order = await queryOne<Row>('SELECT uuid FROM orders WHERE id = ?', [event.payload.orderId]);
    const orderUuid = order ? String(order.uuid) : String(event.payload.orderId);
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'payment.succeeded',
      eventType: 'payment.succeeded',
      eventId: event.id,
      entityType: 'payment',
      entityId: event.payload.paymentId,
      actionType: 'payment',
      actionTarget: orderUuid,
      variables: { amount: event.payload.amount, currency: event.payload.currency, orderUuid },
      data: { orderId: event.payload.orderId, paymentId: event.payload.paymentId },
      deepLink: `/checkout/${orderUuid}`,
      priority: 'HIGH',
    });
  });

  eventBus.on('payment.failed', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'payment.failed',
      eventType: 'payment.failed',
      eventId: event.id,
      actionType: 'payment',
      variables: { reason: event.payload.reason },
      priority: 'HIGH',
    });
  });

  eventBus.on('payment.pending', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'payment.pending',
      eventType: 'payment.pending',
      eventId: event.id,
      entityType: 'payment',
      entityId: event.payload.paymentId,
      actionType: 'payment',
      actionTarget: event.payload.orderUuid,
      variables: {
        amount: event.payload.amount,
        currency: event.payload.currency,
        orderUuid: event.payload.orderUuid,
      },
      data: { orderId: event.payload.orderId, paymentId: event.payload.paymentId },
      deepLink: `/checkout/${event.payload.orderUuid}`,
      priority: 'normal',
    });
  });

  eventBus.on('refund.issued', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'payment.refund',
      eventType: 'refund.issued',
      eventId: event.id,
      actionType: 'payment',
      variables: { amount: event.payload.amount, currency: event.payload.currency },
      priority: 'HIGH',
    });
  });

  eventBus.on('refund.started', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'payment.refund_started',
      eventType: 'refund.started',
      eventId: event.id,
      actionType: 'payment',
      variables: { amount: event.payload.amount, currency: event.payload.currency },
      priority: 'HIGH',
    });
  });

  eventBus.on('refund.failed', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'payment.refund_failed',
      eventType: 'refund.failed',
      eventId: event.id,
      actionType: 'payment',
      variables: { reason: event.payload.reason },
      priority: 'HIGH',
    });
  });

  eventBus.on('invoice.issued', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'payment.invoice',
      eventType: 'invoice.issued',
      eventId: event.id,
      actionType: 'payment',
      variables: { amount: event.payload.total, currency: event.payload.currency },
      priority: 'normal',
    });
  });

  eventBus.on('subscription.started', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'subscription.started',
      eventType: 'subscription.started',
      eventId: event.id,
      actionType: 'subscription',
      variables: { planCode: event.payload.planCode },
      priority: 'HIGH',
    });
  });

  eventBus.on('subscription.renewed', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'subscription.renewed',
      eventType: 'subscription.renewed',
      eventId: event.id,
      actionType: 'subscription',
      variables: { planCode: event.payload.planCode, periodEnd: event.payload.periodEnd },
      priority: 'normal',
    });
  });

  eventBus.on('subscription.cancelled', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'subscription.cancelled',
      eventType: 'subscription.cancelled',
      eventId: event.id,
      actionType: 'subscription',
      variables: { planCode: event.payload.planCode, endsAt: event.payload.endsAt },
      priority: 'HIGH',
    });
  });

  eventBus.on('subscription.expired', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'subscription.expired',
      eventType: 'subscription.expired',
      eventId: event.id,
      actionType: 'subscription',
      variables: { planCode: event.payload.planCode },
      priority: 'HIGH',
    });
  });

  eventBus.on('subscription.upgraded', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'subscription.upgraded',
      eventType: 'subscription.upgraded',
      eventId: event.id,
      actionType: 'subscription',
      variables: { fromPlan: event.payload.fromPlan, toPlan: event.payload.toPlan },
      priority: 'HIGH',
    });
  });

  eventBus.on('subscription.downgraded', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'subscription.downgraded',
      eventType: 'subscription.downgraded',
      eventId: event.id,
      actionType: 'subscription',
      variables: { fromPlan: event.payload.fromPlan, toPlan: event.payload.toPlan },
      priority: 'HIGH',
    });
  });

  eventBus.on('subscription.paused', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'subscription.paused',
      eventType: 'subscription.paused',
      eventId: event.id,
      actionType: 'subscription',
      variables: { planCode: event.payload.planCode },
      priority: 'HIGH',
    });
  });

  eventBus.on('subscription.resumed', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'subscription.resumed',
      eventType: 'subscription.resumed',
      eventId: event.id,
      actionType: 'subscription',
      variables: { planCode: event.payload.planCode },
      priority: 'HIGH',
    });
  });

  eventBus.on('subscription.payment_failed', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'subscription.payment_failed',
      eventType: 'subscription.payment_failed',
      eventId: event.id,
      actionType: 'subscription',
      variables: { planCode: 'current' },
      priority: 'HIGH',
    });
  });

  eventBus.on('review.published', async (event) => {
    const review = await queryOne<Row>(
      'SELECT subject_user_id, subject_listing_id, reviewer_id FROM reviews WHERE id = ?',
      [event.payload.reviewId],
    );
    const ownerId = review ? Number(review.subject_user_id) : null;
    const reviewerId = review ? Number(review.reviewer_id) : null;
    if (!ownerId || ownerId === reviewerId) return;
    await notifyUser({
      userId: ownerId,
      categoryCode: 'review.published',
      eventType: 'review.published',
      eventId: event.id,
      actionType: 'review',
      entityId: event.payload.reviewId,
      variables: { rating: event.payload.rating },
      priority: 'normal',
    });
  });

  eventBus.on('review.reported', async (event) => {
    const review = await queryOne<Row>('SELECT reviewer_id FROM reviews WHERE id = ?', [event.payload.reviewId]);
    const reviewerId = review ? Number(review.reviewer_id) : null;
    if (!reviewerId || reviewerId === event.payload.reporterId) return;
    await notifyUser({
      userId: reviewerId,
      categoryCode: 'review.reported',
      eventType: 'review.reported',
      eventId: event.id,
      actionType: 'review',
      entityId: event.payload.reviewId,
      priority: 'normal',
    });
  });

  eventBus.on('ad_campaign.approved', async (event) => {
    const advertiser = await queryOne<Row>('SELECT user_id FROM ad_advertisers WHERE id = ?', [event.payload.advertiserId]);
    if (!advertiser?.user_id) return;
    await notifyUser({
      userId: Number(advertiser.user_id),
      categoryCode: 'ad_campaign.approved',
      eventType: 'ad_campaign.approved',
      eventId: event.id,
      actionType: 'ad',
      entityId: event.payload.campaignId,
      priority: 'normal',
    });
  });

  eventBus.on('ad_campaign.rejected', async (event) => {
    const advertiser = await queryOne<Row>('SELECT user_id FROM ad_advertisers WHERE id = ?', [event.payload.advertiserId]);
    if (!advertiser?.user_id) return;
    await notifyUser({
      userId: Number(advertiser.user_id),
      categoryCode: 'ad_campaign.rejected',
      eventType: 'ad_campaign.rejected',
      eventId: event.id,
      actionType: 'ad',
      entityId: event.payload.campaignId,
      variables: { reason: event.payload.reason },
      priority: 'HIGH',
    });
  });

  eventBus.on('ad_campaign.budget_exhausted', async (event) => {
    const advertiser = await queryOne<Row>('SELECT user_id FROM ad_advertisers WHERE id = ?', [event.payload.advertiserId]);
    if (!advertiser?.user_id) return;
    await notifyUser({
      userId: Number(advertiser.user_id),
      categoryCode: 'ad_campaign.budget_low',
      eventType: 'ad_campaign.budget_exhausted',
      eventId: event.id,
      actionType: 'ad',
      entityId: event.payload.campaignId,
      priority: 'HIGH',
    });
  });

  eventBus.on('favorite.added', async (event) => {
    if (!event.payload.listingId) return;
    const listing = await queryOne<Row>('SELECT user_id, title FROM listings WHERE id = ?', [event.payload.listingId]);
    if (!listing) return;
    const ownerId = Number(listing.user_id);
    if (ownerId === event.payload.userId) return;
    await notifyUser({
      userId: ownerId,
      categoryCode: 'favorite.added',
      eventType: 'favorite.added',
      eventId: event.id,
      marketplace: 'GENERAL',
      entityType: 'listing',
      entityId: event.payload.listingId,
      actionType: 'favorite',
      actionTarget: String(event.payload.listingId),
      groupKey: `favorite.listing.${event.payload.listingId}`,
      variables: { count: 1, listingId: event.payload.listingId, title: listing.title },
      priority: 'LOW',
    });
  });

  eventBus.on('listing.price_changed', async (event) => {
    const listing = await queryOne<Row>('SELECT user_id, title FROM listings WHERE id = ?', [event.payload.listingId]);
    if (!listing) return;
    const watchers = await queryRows<Row>(
      `SELECT user_id FROM favorites
        WHERE listing_id = ? AND notify_price_drop = 1 AND user_id <> ?`,
      [event.payload.listingId, Number(listing.user_id)],
    );
    for (const watcher of watchers) {
      await notifyUser({
        userId: Number(watcher.user_id),
        categoryCode: 'listing.price_changed',
        eventType: 'listing.price_changed',
        eventId: `${event.id}:${watcher.user_id}`,
        entityType: 'listing',
        entityId: event.payload.listingId,
        actionType: 'listing',
        actionTarget: String(event.payload.listingId),
        variables: {
          title: listing.title,
          price: event.payload.newPrice,
          currency: event.payload.currency,
          listingId: event.payload.listingId,
        },
        priority: 'normal',
      });
    }
  });

  eventBus.on('account_takeover.suspected', async (event) => {
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'security.fraud',
      eventType: 'account_takeover.suspected',
      eventId: event.id,
      actionType: 'security',
      priority: 'CRITICAL',
    });
  });

  eventBus.on('fraud.detected', async (event) => {
    if (event.payload.targetKind !== 'user') return;
    await notifyUser({
      userId: event.payload.targetId,
      categoryCode: 'security.fraud',
      eventType: 'fraud.detected',
      eventId: event.id,
      actionType: 'security',
      priority: 'CRITICAL',
    });
  });

  log.info('notification event handlers registered');
}
