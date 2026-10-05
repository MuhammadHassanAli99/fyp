import { eventBus } from '../../core/events/event-bus';
import { loggerFor } from '../../config/logger';
import { evaluateRisk } from './risk.engine';
import { assessListingRisk } from './risk.listing';
import { enqueueRiskJob } from './risk.jobs';

const log = loggerFor('risk.events');

/**
 * Maps existing domain events onto the Risk Engine. Does not replace auth,
 * listing, payment or notification logic.
 */
export function registerRiskEventHandlers(): void {
  eventBus.on('user.registered', async (event) => {
    await evaluateRisk({
      eventType: 'REGISTER',
      subjectKind: 'user',
      subjectId: event.payload.userId,
      userId: event.payload.userId,
      policyCode: 'login',
    });
  });

  eventBus.on('user.logged_in', async () => {
    /* scored in auth.service via assessLoginRisk — do not double-evaluate */
  });

  eventBus.on('user.login_failed', async () => {
    /* scored on the request path; identifier may not map to a user */
  });

  eventBus.on('user.password_changed', async (event) => {
    await evaluateRisk({
      eventType: 'PASSWORD_CHANGED',
      subjectKind: 'user',
      subjectId: event.payload.userId,
      userId: event.payload.userId,
      policyCode: 'login',
    });
  });

  eventBus.on('user.new_device', async () => {
    /* ATO case opening happens in auth after assessLoginRisk */
  });

  eventBus.on('listing.submitted', async (event) => {
    await assessListingRisk(event.payload.listingId, event.payload.userId).catch((error) =>
      log.warn({ err: error }, 'listing risk skipped'),
    );
  });

  eventBus.on('listing.created', async (event) => {
    await evaluateRisk({
      eventType: 'LISTING_CREATED',
      subjectKind: 'listing',
      subjectId: event.payload.listingId,
      userId: event.payload.userId,
      listingId: event.payload.listingId,
      policyCode: 'listing',
    });
  });

  eventBus.on('listing.media_added', async (event) => {
    await enqueueRiskJob('image_hash', { mediaId: event.payload.mediaId, listingId: event.payload.listingId });
  });

  eventBus.on('review.created', async () => {
    /* scored in reviews.service via assessReviewRisk — never auto-deletes */
  });

  eventBus.on('review.reported', async (event) => {
    await evaluateRisk({
      eventType: 'REVIEW_REPORTED',
      subjectKind: 'review',
      subjectId: event.payload.reviewId,
      userId: event.payload.reporterId,
      policyCode: 'default',
    }).catch(() => undefined);
  });

  eventBus.on('message.sent', async (event) => {
    if (!event.payload.senderId) return;
    await evaluateRisk({
      eventType: 'MESSAGE_SENT',
      subjectKind: 'message',
      subjectId: event.payload.messageId,
      userId: event.payload.senderId,
    });
  });

  eventBus.on('favorite.added', async (event) => {
    await evaluateRisk({
      eventType: 'FAVORITE_CREATED',
      subjectKind: 'user',
      subjectId: event.payload.userId,
      userId: event.payload.userId,
    });
  });

  eventBus.on('payment.pending', async () => {
    /* scored in payments.risk via assessPaymentRisk */
  });

  eventBus.on('payment.failed', async (event) => {
    await evaluateRisk({
      eventType: 'PAYMENT_FAILED',
      subjectKind: 'payment',
      subjectId: event.payload.paymentId,
      userId: event.payload.userId,
      policyCode: 'payment',
    });
  });

  eventBus.on('user.verification_submitted', async (event) => {
    await evaluateRisk({
      eventType: 'KYC_SUBMITTED',
      subjectKind: 'user',
      subjectId: event.payload.userId,
      userId: event.payload.userId,
      policyCode: 'kyc',
    });
    await enqueueRiskJob('aml_screen', { userId: event.payload.userId });
  });

  eventBus.on('user.verification_approved', async (event) => {
    await evaluateRisk({
      eventType: 'KYC_VERIFIED',
      subjectKind: 'user',
      subjectId: event.payload.userId,
      userId: event.payload.userId,
      policyCode: 'kyc',
    });
  });

  log.info('risk event handlers registered');
}
