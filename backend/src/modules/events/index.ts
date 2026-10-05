import { eventBus } from '../../core/events/event-bus';
import { loggerFor } from '../../config/logger';
import { queryOne, queryRows, type Row } from '../../db/query';
import { notifyUser } from '../notifications/notify';
import { registerNotificationEventHandlers } from '../notifications/notifications.events';
import { registerRiskEventHandlers } from '../risk/risk.events';
import { upsertSearchIndex } from '../listings/listings.search-index';
import { activatePaidPromotion } from '../listings/listings.promotions';
import { invalidateSearchCache } from '../search/search.cache';
import { matchListingToSavedSearches } from '../search/search.saved';
import { recordDomainEvent } from '../analytics/analytics.ingest';

const log = loggerFor('events.handlers');

/**
 * Cross-module side effects. Each handler is fire-and-forget safe: failures
 * are retried by the outbox worker, never rolled back into the originating tx.
 */
export function registerEventHandlers(): void {
  eventBus.on('listing.created', async (event) => {
    await recordDomainEvent('listing.created', event.payload);
  });

  eventBus.on('listing.published', async (event) => {
    log.info({ listingId: event.payload.listingId }, 'listing published');
    await upsertSearchIndex(event.payload.listingId);
    await invalidateSearchCache();
    await matchListingToSavedSearches(event.payload.listingId);
    await recordDomainEvent('listing.published', event.payload);
  });

  eventBus.on('listing.updated', async (event) => {
    await upsertSearchIndex(event.payload.listingId);
    await invalidateSearchCache();
    await recordDomainEvent('listing.updated', event.payload);
  });

  eventBus.on('listing.price_changed', async (event) => {
    await upsertSearchIndex(event.payload.listingId);
    await invalidateSearchCache();
    await recordDomainEvent('listing.price_changed', event.payload);
  });

  eventBus.on('listing.rejected', async (event) => {
    await upsertSearchIndex(event.payload.listingId);
    await invalidateSearchCache();
    await recordDomainEvent('listing.rejected', event.payload);
  });

  eventBus.on('listing.expired', async (event) => {
    await upsertSearchIndex(event.payload.listingId);
    await invalidateSearchCache();
    await recordDomainEvent('listing.expired', event.payload);
  });

  eventBus.on('listing.renewed', async (event) => {
    await upsertSearchIndex(event.payload.listingId);
    await invalidateSearchCache();
    await recordDomainEvent('listing.renewed', event.payload);
  });

  eventBus.on('listing.sold', async (event) => {
    await upsertSearchIndex(event.payload.listingId);
    await invalidateSearchCache();
    await recordDomainEvent('listing.sold', event.payload);
  });

  eventBus.on('listing.rented', async (event) => {
    await upsertSearchIndex(event.payload.listingId);
    await invalidateSearchCache();
    await recordDomainEvent('listing.rented', event.payload);
  });

  eventBus.on('listing.reserved', async (event) => {
    await upsertSearchIndex(event.payload.listingId);
    await invalidateSearchCache();
    await recordDomainEvent('listing.reserved', event.payload);
  });

  eventBus.on('listing.archived', async (event) => {
    await upsertSearchIndex(event.payload.listingId);
    await invalidateSearchCache();
    await recordDomainEvent('listing.archived', event.payload);
  });

  eventBus.on('listing.restored', async (event) => {
    await upsertSearchIndex(event.payload.listingId);
    await invalidateSearchCache();
    await recordDomainEvent('listing.restored', event.payload);
  });

  eventBus.on('listing.promoted', async (event) => {
    await upsertSearchIndex(event.payload.listingId);
    await invalidateSearchCache();
    await recordDomainEvent('listing.promoted', event.payload);
    await notifyUser({
      userId: event.payload.userId,
      categoryCode: 'listing.promotion_started',
      title: 'Promotion started',
      body: `${event.payload.kind} is active until ${event.payload.endsAt}.`,
      actionTarget: String(event.payload.listingId),
    });
  });

  eventBus.on('listing.promotion_expired', async (event) => {
    await upsertSearchIndex(event.payload.listingId);
    await recordDomainEvent('listing.promotion_expired', event.payload);
  });

  eventBus.on('listing.viewed', async (event) => {
    await recordDomainEvent('listing.viewed', event.payload);
  });

  eventBus.on('favorite.added', async (event) => {
    await recordDomainEvent('favorite.added', event.payload);
  });

  eventBus.on('favorite.removed', async (event) => {
    await recordDomainEvent('favorite.removed', event.payload);
  });

  eventBus.on('favorite.moved', async (event) => {
    await recordDomainEvent('favorite.moved', event.payload);
  });

  eventBus.on('favorite.shared', async (event) => {
    await recordDomainEvent('favorite.shared', event.payload);
  });

  eventBus.on('collection.created', async (event) => {
    await recordDomainEvent('collection.created', event.payload);
  });

  eventBus.on('collection.updated', async (event) => {
    await recordDomainEvent('collection.updated', event.payload);
  });

  eventBus.on('collection.deleted', async (event) => {
    await recordDomainEvent('collection.deleted', event.payload);
  });

  eventBus.on('comparison.updated', async (event) => {
    await recordDomainEvent('comparison.updated', event.payload);
  });

  eventBus.on('search.performed', async (event) => {
    await recordDomainEvent('search.performed', event.payload);
  });

  eventBus.on('order.created', async (event) => {
    log.info({ orderId: event.payload.orderId }, 'order created');
    await recordDomainEvent('order.created', event.payload);
  });

  eventBus.on('payment.succeeded', async (event) => {
    log.info({ paymentId: event.payload.paymentId, orderId: event.payload.orderId }, 'payment succeeded');
    await activatePaidPromotion(event.payload.orderId, event.payload.paymentId, event.payload.userId);
    const { creditAdvertiserFromOrder } = await import('../ads/ads.billing');
    await creditAdvertiserFromOrder(event.payload.orderId, event.payload.paymentId);
    await recordDomainEvent('payment.succeeded', event.payload);
  });

  eventBus.on('moderation.queued', async (event) => {
    log.info({ queueId: event.payload.queueId, reason: event.payload.reason }, 'moderation queued');
  });

  eventBus.on('message.sent', async (event) => {
    const { conversationId, senderId, recipientIds } = event.payload;
    if (!senderId || recipientIds.length === 0) return;
    try {
      const conversation = await queryOne<Row>('SELECT uuid FROM conversations WHERE id = ?', [conversationId]);
      if (!conversation) return;
      const muted = await queryRows<Row>(
        `SELECT user_id FROM conversation_participants
          WHERE conversation_id = ? AND is_muted = 1 AND left_at IS NULL`,
        [conversationId],
      );
      const { notifyOfflinePeers } = await import('../chat/chat.service');
      await notifyOfflinePeers({
        conversationId,
        conversationUuid: String(conversation.uuid),
        senderId,
        recipientIds,
        mutedUserIds: new Set(muted.map((row) => Number(row.user_id))),
      });
    } catch (error) {
      log.debug({ err: error }, 'message.sent notification skipped');
    }
    await recordDomainEvent('message.sent', event.payload);
  });

  eventBus.on('call.started', async (event) => {
    await recordDomainEvent('call.started', event.payload);
  });

  eventBus.on('call.ended', async (event) => {
    await recordDomainEvent('call.ended', event.payload);
  });

  eventBus.on('call.missed', async (event) => {
    await recordDomainEvent('call.missed', event.payload);
  });

  eventBus.on('user.registered', async (event) => {
    await recordDomainEvent('user.registered', event.payload);
  });
  eventBus.on('user.logged_in', async (event) => {
    await recordDomainEvent('user.logged_in', event.payload);
  });
  eventBus.on('subscription.started', async (event) => {
    await recordDomainEvent('subscription.started', event.payload);
  });
  eventBus.on('subscription.renewed', async (event) => {
    await recordDomainEvent('subscription.renewed', event.payload);
  });
  eventBus.on('lead.created', async (event) => {
    await recordDomainEvent('lead.created', event.payload);
  });
  eventBus.on('offer.created', async (event) => {
    await recordDomainEvent('offer.created', event.payload);
  });

  registerNotificationEventHandlers();
  registerRiskEventHandlers();

  eventBus.on('ticket.created', async (event) => {
    await recordDomainEvent('ticket.created', event.payload);
  });
  eventBus.on('ticket.replied', async (event) => {
    await recordDomainEvent('ticket.replied', event.payload);
  });
  eventBus.on('ticket.resolved', async (event) => {
    await recordDomainEvent('ticket.resolved', event.payload);
  });
  eventBus.on('ticket.sla_breached', async (event) => {
    await recordDomainEvent('ticket.sla_breached', event.payload);
  });

  log.info({ events: eventBus.registeredEvents() }, 'event handlers registered');
}
