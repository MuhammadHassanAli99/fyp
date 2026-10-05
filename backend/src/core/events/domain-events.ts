/**
 * The complete catalogue of domain events. Adding a cross-module side effect
 * means adding an event here and a handler in the consuming module — never a
 * direct import between modules.
 */
export interface DomainEventPayloads {
  /* Identity */
  'user.registered': { userId: number; method: string; countryId: number | null; email?: string | null; phone?: string | null };
  'user.logged_in': { userId: number; sessionId: number; method: string; deviceId: number | null; riskScore: number };
  'user.login_failed': { identifier: string; reason: string; ip: string | null };
  'user.email_verified': { userId: number };
  'user.phone_verified': { userId: number };
  'user.password_changed': { userId: number; revokedSessions: number };
  'user.suspended': { userId: number; reason: string; until: string | null };
  'user.banned': { userId: number; reason: string };
  'user.deleted': { userId: number };
  'user.username_changed': { userId: number; from: string | null; to: string };
  'user.profile_updated': { userId: number; fields: string[] };
  'user.verification_submitted': { userId: number; requestId: number; docType: string };
  'user.verification_approved': { userId: number; docType: string };
  'user.verification_rejected': { userId: number; docType: string; reason: string };
  'user.verification_revoked': { userId: number; requestId: number; reason: string };
  'business.created': { businessId: number; userId: number; kind: string };
  'business.member_invited': { businessId: number; invitedBy: number; role: string };
  'business.ownership_transferred': { businessId: number; fromUserId: number; toUserId: number };
  'trust.recomputed': { userId: number; band: string };
  'user.kyc_completed': { userId: number; level: string };
  'user.followed': { followerId: number; followeeId: number };
  'user.new_device': { userId: number; deviceId: number; countryId: number | null };

  /* Listings */
  'listing.created': { listingId: number; userId: number; marketplaceId: number; categoryId: number; status: string };
  'listing.submitted': { listingId: number; userId: number; marketplaceId: number };
  'listing.published': { listingId: number; userId: number; marketplaceId: number; categoryId: number; countryId: number; cityId: number | null; price: string | null; currency: string | null };
  'listing.updated': { listingId: number; userId: number; changedFields: string[] };
  'listing.price_changed': { listingId: number; oldPrice: string | null; newPrice: string; currency: string };
  'listing.rejected': { listingId: number; userId: number; reason: string };
  'listing.expired': { listingId: number; userId: number };
  'listing.renewed': { listingId: number; userId: number; expiresAt: string };
  'listing.sold': { listingId: number; userId: number; buyerId: number | null };
  'listing.rented': { listingId: number; userId: number };
  'listing.archived': { listingId: number; userId: number };
  'listing.restored': { listingId: number; userId: number };
  'listing.reserved': { listingId: number; userId: number };
  'listing.approved': { listingId: number; userId: number; automated: boolean };
  'listing.promotion_expired': { listingId: number; kind: string };
  'listing.removed': { listingId: number; userId: number; byModerator: boolean };
  'listing.viewed': { listingId: number; viewerId: number | null; source: string };
  'listing.promoted': { listingId: number; userId: number; kind: string; endsAt: string };
  'listing.media_added': { listingId: number; mediaId: number; kind: string };
  'listing.reported': { listingId: number; reporterId: number | null; reasonCode: string };

  /* Engagement */
  'favorite.added': {
    userId: number;
    favoriteId: number;
    listingId: number | null;
    marketplaceId: number;
    entityType: string;
    entityId: number;
    collectionId: number | null;
  };
  'favorite.removed': {
    userId: number;
    favoriteId: number;
    listingId: number | null;
    marketplaceId: number;
    entityType: string;
    entityId: number;
  };
  'favorite.moved': {
    userId: number;
    favoriteId: number;
    fromCollectionId: number | null;
    toCollectionId: number | null;
  };
  'favorite.shared': { userId: number; targetType: string; targetId: number; token: string };
  'collection.created': { userId: number; collectionId: number; name: string };
  'collection.updated': { userId: number; collectionId: number };
  'collection.deleted': { userId: number; collectionId: number };
  'lead.created': { leadId: number; listingId: number; sellerId: number; buyerId: number | null; channel: string };
  'offer.created': { offerId: number; listingId: number; buyerId: number; sellerId: number; amount: string; currency: string };
  'offer.accepted': { offerId: number; listingId: number; buyerId: number; sellerId: number };
  'offer.rejected': { offerId: number; listingId: number; buyerId: number };
  'contact.revealed': { listingId: number; userId: number | null; channel: string };

  /* Comparison (spec lines 1-3) */
  'comparison.item_added': { setId: number; listingId: number; itemCount: number; marketplaceId: number };
  'comparison.updated': { setId: number; userId: number | null; itemCount: number; marketplaceId: number };
  'comparison.ai_requested': { setId: number; listingIds: number[]; marketplaceId: number };
  'comparison.ai_ready': { setId: number; resultId: number };

  /* Auctions */
  'auction.started': { auctionId: number; listingId: number };
  'auction.bid_placed': { auctionId: number; bidId: number; userId: number; amount: string; currency: string; previousBidderId: number | null };
  'auction.outbid': { auctionId: number; userId: number };
  'auction.ended': { auctionId: number; listingId: number; winnerId: number | null; finalBid: string | null };

  /* Chat & calls */
  'message.sent': { messageId: number; conversationId: number; senderId: number | null; recipientIds: number[]; kind: string };
  'message.read': { conversationId: number; userId: number; messageId: number };
  'conversation.created': { conversationId: number; listingId: number | null; participantIds: number[] };
  'call.started': { callId: number; callerId: number; calleeId: number; kind: string };
  'call.ended': { callId: number; durationSecs: number; status: string };
  'call.missed': { callId: number; calleeId: number; callerId: number };

  /* Search */
  'search.performed': { userId: number | null; marketplaceId: number | null; query: string; searchType: string; resultCount: number };
  'saved_search.matched': { savedSearchId: number; userId: number; listingIds: number[] };

  /* Reviews */
  'review.created': { reviewId: number; reviewerId: number; subjectKind: string; subjectId: number; rating: number };
  'review.published': { reviewId: number; subjectKind: string; subjectId: number; rating: number };
  'review.replied': { reviewId: number; replyId: number; userId: number };
  'review.reported': { reviewId: number; reporterId: number; reason: string };

  /* Money */
  'order.created': { orderId: number; userId: number; kind: string; total: string; currency: string };
  'payment.pending': { paymentId: number; orderId: number; orderUuid: string; userId: number; amount: string; currency: string };
  'payment.succeeded': { paymentId: number; orderId: number; userId: number; amount: string; currency: string; gateway: string };
  'payment.failed': { paymentId: number; orderId: number; userId: number; reason: string; gateway: string };
  'refund.started': { refundId: number; paymentId: number; userId: number; amount: string; currency: string };
  'refund.failed': { refundId: number; paymentId: number; userId: number; reason: string };
  'refund.issued': { refundId: number; paymentId: number; userId: number; amount: string; currency: string };
  'invoice.issued': { invoiceId: number; userId: number; total: string; currency: string };
  'subscription.started': { subscriptionId: number; userId: number; planCode: string };
  'subscription.renewed': { subscriptionId: number; userId: number; planCode: string; periodEnd: string };
  'subscription.upgraded': { subscriptionId: number; userId: number; fromPlan: string; toPlan: string };
  'subscription.downgraded': { subscriptionId: number; userId: number; fromPlan: string; toPlan: string };
  'subscription.cancelled': { subscriptionId: number; userId: number; planCode: string; endsAt: string | null };
  'subscription.expired': { subscriptionId: number; userId: number; planCode: string };
  'subscription.payment_failed': { subscriptionId: number; userId: number; attempt: number };
  'subscription.paused': { subscriptionId: number; userId: number; planCode: string };
  'subscription.resumed': { subscriptionId: number; userId: number; planCode: string };
  'quota.exceeded': { userId: number; featureCode: string; limit: number };

  /* Ads */
  'ad_campaign.submitted': { campaignId: number; advertiserId: number };
  'ad_campaign.approved': { campaignId: number; advertiserId: number };
  'ad_campaign.rejected': { campaignId: number; advertiserId: number; reason: string };
  'ad_campaign.budget_exhausted': { campaignId: number; advertiserId: number };
  'ad.budget_credited': {
    campaignId: number;
    advertiserId: number;
    amount: string;
    currency: string;
    paymentId: number;
    orderId: number;
  };

  /* Trust & safety */
  'risk.evaluated': { subjectKind: string; subjectId: number; score: number; decision: string };
  'risk.blocked': { subjectKind: string; subjectId: number; signalCode: string };
  'fraud.detected': { targetKind: string; targetId: number; detectionKind: string; confidence: number };
  'duplicate.detected': { listingId: number; duplicateOfListingId: number; similarity: number };
  'moderation.queued': { queueId: number; entityType: string; entityId: number; reason: string; priority: string };
  'moderation.actioned': { entityType: string; entityId: number; action: string; moderatorId: number };
  'sanction.applied': { userId: number; kind: string; endsAt: string | null };
  'account_takeover.suspected': { userId: number; triggerKind: string; riskScore: number };

  /* Support */
  'ticket.created': { ticketId: number; userId: number | null; priority: string; categoryId: number | null };
  'ticket.replied': { ticketId: number; authorKind: string; messageId: number };
  'ticket.resolved': { ticketId: number; resolvedBy: number | null; satisfactionRating: number | null };
  'ticket.sla_breached': { ticketId: number; minutesOverdue: number };
  'ticket.assigned': { ticketId: number; assignedTo: number | null; department: string | null };
  'ticket.reopened': { ticketId: number; userId: number | null };

  /* Platform */
  'rates.updated': { kind: 'fx' | 'gold'; count: number; provider: string };
  'taxonomy.changed': { marketplaceId: number; version: number };
}

export type DomainEventName = keyof DomainEventPayloads;
