import { insertAndGetId, queryOne, type Row } from '../../db/query';
import { loggerFor } from '../../config/logger';
import { eventBus } from '../../core/events/event-bus';

const log = loggerFor('seller.leads');

const CHANNELS = new Set(['chat', 'call', 'whatsapp', 'email', 'sms', 'form', 'offer']);

export type ListingLeadChannel = 'chat' | 'call' | 'whatsapp' | 'email' | 'sms' | 'form' | 'offer';

/**
 * Records a marketplace inquiry on listing_leads. Deduped per listing + buyer +
 * channel for 24 hours so a chat thread does not create a lead on every message.
 */
export async function recordListingLead(input: {
  listingId: number;
  buyerId: number | null;
  channel: ListingLeadChannel;
  message?: string | null;
}): Promise<void> {
  if (!CHANNELS.has(input.channel)) return;
  try {
    const listing = await queryOne<Row>(
      `SELECT id, user_id FROM listings WHERE id = ? AND deleted_at IS NULL`,
      [input.listingId],
    );
    if (!listing) return;
    const sellerId = Number(listing.user_id);
    if (input.buyerId && input.buyerId === sellerId) return;

    const recent = await queryOne<Row>(
      `SELECT id FROM listing_leads
        WHERE listing_id = ?
          AND channel = ?
          AND ((? IS NULL AND buyer_id IS NULL) OR buyer_id = ?)
          AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 24 HOUR)
        LIMIT 1`,
      [input.listingId, input.channel, input.buyerId, input.buyerId],
    );
    if (recent) return;

    const leadId = await insertAndGetId(
      `INSERT INTO listing_leads (listing_id, seller_id, buyer_id, channel, status, message)
       VALUES (?, ?, ?, ?, 'new', ?)`,
      [input.listingId, sellerId, input.buyerId, input.channel, input.message?.slice(0, 1000) ?? null],
    );
    const event = await eventBus.enqueueNow('lead.created', 'listing_lead', leadId, {
      leadId,
      listingId: input.listingId,
      sellerId,
      buyerId: input.buyerId,
      channel: input.channel,
    });
    void eventBus.publishAfterCommit(event);
  } catch (error) {
    log.warn({ err: error, listingId: input.listingId, channel: input.channel }, 'listing lead ingest skipped');
  }
}
