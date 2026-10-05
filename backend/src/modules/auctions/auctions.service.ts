import { execute, insertAndGetId, queryOne, queryRows, transaction, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { cmpDecimal, roundDecimal, toNumberSafe } from '../../core/decimal';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { packIp } from '../../core/security/crypto';
import { recordAudit } from '../../middleware/audit';
import { notifyUser } from '../notifications/notify';
import { emitToAuction, emitToUser } from '../../realtime/socket';
import { assessRequestRisk } from '../../middleware/risk-guard';
import type { Request } from 'express';
import { assertGoldTradeAllowed } from '../../marketplaces/gold/gold.compliance';
import { isSelfBid, minimumNextBid } from './auctions.rules';

const LIVE = 'live';
const SCHEDULED = 'scheduled';

export async function getAuctionByListing(listingId: number) {
  const row = await queryOne<Row>(`SELECT * FROM auctions WHERE listing_id = ?`, [listingId]);
  if (!row) return null;
  return mapAuction(row);
}

export async function getAuction(idOrUuid: string | number) {
  const numeric = Number(idOrUuid);
  const row = await queryOne<Row>(
    `SELECT * FROM auctions WHERE id = ? OR uuid = ?`,
    [Number.isFinite(numeric) ? numeric : 0, String(idOrUuid)],
  );
  if (!row) throw notFound('Auction');
  return mapAuction(row);
}

export async function listBids(auctionId: number, limit = 50) {
  const rows = await queryRows<Row>(
    `SELECT b.id, b.user_id, b.amount, b.status, b.is_auto, b.created_at, p.display_name
       FROM auction_bids b
       LEFT JOIN user_profiles p ON p.user_id = b.user_id
      WHERE b.auction_id = ?
      ORDER BY b.amount DESC, b.id DESC
      LIMIT ?`,
    [auctionId, limit],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    displayName: (row.display_name as string | null) ?? 'Bidder',
    amount: toNumber(row.amount) ?? 0,
    status: String(row.status),
    isAuto: Number(row.is_auto) === 1,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}

/**
 * Server-authoritative bid. Flutter must not supply current bid, clock, or owner id.
 */
export async function placeBid(params: {
  auctionId: number;
  bidderId: number;
  amount: number;
  idempotencyKey?: string | null;
  req?: Request;
}) {
  if (params.amount <= 0) throw badRequest('Bid amount must be positive');

  if (params.req) {
    const risk = await assessRequestRisk(params.req);
    if (risk.decision === 'block') {
      throw forbidden('This bid was blocked by account/device risk checks');
    }
  }

  const result = await transaction(
    async (connection) => {
      const auction = await queryOne<Row>(
        `SELECT a.*, l.user_id AS seller_id, l.title, l.country_id, l.marketplace_id
           FROM auctions a
           JOIN listings l ON l.id = a.listing_id
          WHERE a.id = ?
          FOR UPDATE`,
        [params.auctionId],
        connection,
      );
      if (!auction) throw notFound('Auction');

      const now = new Date();
      const startsAt = new Date(auction.starts_at as Date);
      const endsAt = new Date(auction.ends_at as Date);
      let status = String(auction.status);

      if (status === SCHEDULED && startsAt.getTime() <= now.getTime()) {
        status = LIVE;
        await execute(`UPDATE auctions SET status = 'live' WHERE id = ?`, [params.auctionId], connection);
      }
      if (status === 'paused') throw conflict('This auction is paused');
      if (status === 'cancelled') throw conflict('This auction was cancelled');
      if (status !== LIVE || endsAt.getTime() <= now.getTime()) {
        throw conflict('This auction is not accepting bids');
      }
      if (isSelfBid(Number(auction.seller_id), params.bidderId)) {
        throw forbidden('Sellers cannot bid on their own auction');
      }

      const currency = String(auction.currency);
      await assertGoldTradeAllowed({
        userId: params.bidderId,
        countryId: auction.country_id === null ? null : Number(auction.country_id),
        amount: params.amount,
        currency,
      });

      const current = toNumber(auction.current_bid);
      const start = toNumber(auction.start_price) ?? 0;
      const increment = toNumber(auction.bid_increment) ?? 1;
      const minNext = toNumberSafe(minimumNextBid(current, start, increment), 2);
      if (cmpDecimal(params.amount, minNext) < 0) {
        throw badRequest(`Bid must be at least ${roundDecimal(minNext, 2)} ${currency}`);
      }

      const buyNow = toNumber(auction.buy_now_price);
      const duplicate = await queryOne<Row>(
        `SELECT id FROM auction_bids
          WHERE auction_id = ? AND user_id = ? AND amount = ?
            AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 3 SECOND)
          LIMIT 1`,
        [params.auctionId, params.bidderId, params.amount],
        connection,
      );
      if (duplicate) throw conflict('Duplicate bid ignored');

      if (params.idempotencyKey) {
        const existing = await queryOne<Row>(
          `SELECT id FROM auction_bids WHERE auction_id = ? AND user_id = ? AND idempotency_key = ?`,
          [params.auctionId, params.bidderId, params.idempotencyKey],
          connection,
        );
        if (existing) {
          return { bidId: Number(existing.id), previousBidderId: auction.winner_id === null ? null : Number(auction.winner_id), listingId: Number(auction.listing_id), sellerId: Number(auction.seller_id), title: String(auction.title), currency, amount: params.amount, uuid: String(auction.uuid) };
        }
      }

      const previousBidderId = auction.winner_id === null ? null : Number(auction.winner_id);
      const bidId = await insertAndGetId(
        `INSERT INTO auction_bids (auction_id, user_id, amount, currency, status, ip_address, idempotency_key)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        [
          params.auctionId,
          params.bidderId,
          roundDecimal(params.amount, 2),
          currency,
          packIp(params.req?.context.ip),
          params.idempotencyKey ?? null,
        ],
        connection,
      );

      await execute(
        `UPDATE auction_bids SET status = 'outbid'
          WHERE auction_id = ? AND id <> ? AND status = 'active'`,
        [params.auctionId, bidId],
        connection,
      );

      let nextEnds = endsAt;
      const antiSnipe = Number(auction.anti_snipe_secs ?? 0);
      if (antiSnipe > 0 && endsAt.getTime() - now.getTime() < antiSnipe * 1000) {
        nextEnds = new Date(now.getTime() + antiSnipe * 1000);
      }

      const wonBuyNow = buyNow !== null && cmpDecimal(params.amount, buyNow) >= 0;
      await execute(
        `UPDATE auctions
            SET current_bid = ?, bid_count = bid_count + 1, winner_id = ?, last_bid_at = CURRENT_TIMESTAMP,
                ends_at = ?, status = ?
          WHERE id = ?`,
        [
          roundDecimal(params.amount, 2),
          params.bidderId,
          nextEnds,
          wonBuyNow ? 'ended' : LIVE,
          params.auctionId,
        ],
        connection,
      );

      if (wonBuyNow) {
        await execute(
          `UPDATE auctions SET status = 'settlement_pending', ended_at = CURRENT_TIMESTAMP, settlement_status = 'pending' WHERE id = ?`,
          [params.auctionId],
          connection,
        );
        await execute(`UPDATE listings SET status = 'reserved' WHERE id = ?`, [auction.listing_id], connection);
      }

      return {
        bidId,
        previousBidderId,
        listingId: Number(auction.listing_id),
        sellerId: Number(auction.seller_id),
        title: String(auction.title),
        currency,
        amount: params.amount,
        uuid: String(auction.uuid),
        wonBuyNow,
      };
    },
    { isolation: 'READ COMMITTED', retryOnDeadlock: true },
  );

  await recordAudit({
    action: 'gold.bid.placed',
    entityType: 'auction_bid',
    entityId: result.bidId,
    after: { auctionId: params.auctionId, amount: String(result.amount) },
  });

  const auction = await getAuction(params.auctionId);
  emitToAuction(result.uuid, 'auction.bid', {
    auctionId: params.auctionId,
    bidId: result.bidId,
    amount: result.amount,
    currency: result.currency,
    bidCount: auction.bidCount,
    currentBid: auction.currentBid,
    endsAt: auction.endsAt,
    serverNow: auction.serverNow,
  });

  await notifyUser({
    userId: result.sellerId,
    categoryCode: 'gold.bid.new',
    title: 'New bid',
    body: `${roundDecimal(result.amount, 2)} ${result.currency} on ${result.title}`,
    actionTarget: String(result.listingId),
    data: { auctionId: params.auctionId, listingId: result.listingId },
  });

  if (result.previousBidderId && result.previousBidderId !== params.bidderId) {
    await notifyUser({
      userId: result.previousBidderId,
      categoryCode: 'gold.bid.outbid',
      title: 'You were outbid',
      body: `Someone bid ${roundDecimal(result.amount, 2)} ${result.currency} on ${result.title}`,
      actionTarget: String(result.listingId),
      data: { auctionId: params.auctionId, listingId: result.listingId },
    });
    emitToUser(result.previousBidderId, 'auction.outbid', {
      auctionId: params.auctionId,
      listingId: result.listingId,
      amount: result.amount,
      currency: result.currency,
    });
  }

  return { auction, bidId: result.bidId };
}

export async function tickAuctions(): Promise<{ started: number; ended: number }> {
  const started = await execute(
    `UPDATE auctions SET status = 'live'
      WHERE status = 'scheduled' AND starts_at <= CURRENT_TIMESTAMP`,
  );
  const due = await queryRows<Row>(
    `SELECT a.id, a.uuid, a.listing_id, a.winner_id, a.current_bid, a.reserve_price, a.currency, l.user_id AS seller_id, l.title
       FROM auctions a JOIN listings l ON l.id = a.listing_id
      WHERE a.status = 'live' AND a.ends_at <= CURRENT_TIMESTAMP`,
  );

  for (const row of due) {
    const reserve = toNumber(row.reserve_price);
    const current = toNumber(row.current_bid);
    const winnerId = row.winner_id === null ? null : Number(row.winner_id);
    const metReserve = winnerId !== null && (reserve === null || (current !== null && cmpDecimal(current, reserve) >= 0));
    const nextStatus = metReserve ? 'settlement_pending' : 'ended';
    await execute(
      `UPDATE auctions
          SET status = ?, ended_at = CURRENT_TIMESTAMP, settlement_status = ?
        WHERE id = ?`,
      [nextStatus, metReserve ? 'pending' : 'none', row.id],
    );
    if (metReserve) {
      await execute(`UPDATE listings SET status = 'reserved' WHERE id = ?`, [row.listing_id]);
      await execute(
        `UPDATE auction_bids SET status = IF(user_id = ?, 'won', 'lost') WHERE auction_id = ? AND status IN ('active','outbid')`,
        [winnerId, row.id],
      );
      if (winnerId) {
        await notifyUser({
          userId: winnerId,
          categoryCode: 'gold.auction.won',
          title: 'You won the auction',
          body: `You won ${String(row.title)} at ${roundDecimal(current ?? 0, 2)} ${String(row.currency)}`,
          actionTarget: String(row.listing_id),
        });
      }
      await notifyUser({
        userId: Number(row.seller_id),
        categoryCode: 'gold.order.status',
        title: 'Auction ended with a winner',
        body: `${String(row.title)} ended. Settlement is pending.`,
        actionTarget: String(row.listing_id),
      });
    } else {
      await execute(`UPDATE auction_bids SET status = 'lost' WHERE auction_id = ? AND status IN ('active','outbid')`, [row.id]);
      await notifyUser({
        userId: Number(row.seller_id),
        categoryCode: 'gold.auction.lost',
        title: 'Auction ended without a sale',
        body: reserve !== null ? `${String(row.title)} did not meet the reserve.` : `${String(row.title)} ended with no bids.`,
        actionTarget: String(row.listing_id),
      });
    }
    emitToAuction(String(row.uuid), 'auction.ended', {
      auctionId: Number(row.id),
      listingId: Number(row.listing_id),
      winnerId: metReserve ? winnerId : null,
      status: nextStatus,
      serverNow: new Date().toISOString(),
    });
  }

  return { started: started.affectedRows, ended: due.length };
}

function mapAuction(row: Row) {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    listingId: Number(row.listing_id),
    startPrice: toNumber(row.start_price),
    reservePrice: toNumber(row.reserve_price),
    buyNowPrice: toNumber(row.buy_now_price),
    bidIncrement: toNumber(row.bid_increment),
    currency: String(row.currency),
    currentBid: toNumber(row.current_bid),
    bidCount: Number(row.bid_count ?? 0),
    startsAt: (row.starts_at as Date).toISOString(),
    endsAt: (row.ends_at as Date).toISOString(),
    status: String(row.status),
    winnerId: row.status === 'live' || row.status === 'scheduled' || row.status === 'paused' ? null : row.winner_id === null ? null : Number(row.winner_id),
    settlementStatus: (row.settlement_status as string | undefined) ?? 'none',
    requiresDeposit: Number(row.requires_deposit) === 1,
    depositAmount: toNumber(row.deposit_amount),
    serverNow: new Date().toISOString(),
  };
}

