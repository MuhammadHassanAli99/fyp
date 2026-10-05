import { execute, queryOne, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { makingChargeAmount, mulDecimal, roundDecimal, toNumberSafe } from '../../core/decimal';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { recordAudit } from '../../middleware/audit';
import { createOrder } from '../../modules/payments/payments.service';
import { notifyUser } from '../../modules/notifications/notify';
import { assertGoldTradeAllowed } from './gold.compliance';
import { getGoldRate } from './gold.service';
import { computeFineGoldWeight } from './gold.weights';

export async function buyGoldListing(params: {
  listingId: number;
  buyerId: number;
  countryId: number;
  gatewayCode: string;
  quantity?: number;
  returnUrl?: string | null;
}) {
  const listing = await loadGoldListing(params.listingId);
  if (Number(listing.user_id) === params.buyerId) {
    throw forbidden('You cannot buy your own gold listing');
  }
  if (String(listing.status) !== 'published') {
    throw conflict('This listing is not available for purchase');
  }
  if (String(listing.operation) === 'auction') {
    throw badRequest('This listing is in auction. Place a bid or use buy-now on the auction.');
  }

  const quantity = params.quantity ?? 1;
  if (quantity < 1) throw badRequest('Quantity must be at least 1');
  const unitPrice = toNumber(listing.price);
  const currency = String(listing.currency ?? '');
  if (unitPrice === null || unitPrice <= 0 || !currency) {
    throw badRequest('This listing does not have a fixed price');
  }
  const total = toNumberSafe(mulDecimal(unitPrice, quantity, 2), 2);

  const compliance = await assertGoldTradeAllowed({
    userId: params.buyerId,
    countryId: listing.country_id === null ? params.countryId : Number(listing.country_id),
    amount: total,
    currency,
  });

  const snapshot = await buildSnapshot(listing, unitPrice, currency, total);
  const checkout = await createOrder(params.buyerId, {
    kind: 'listing_purchase',
    amount: total,
    currency,
    countryId: params.countryId,
    gatewayCode: params.gatewayCode,
    description: `Gold listing ${listing.reference_code}`,
    referenceType: 'listing',
    referenceId: params.listingId,
    returnUrl: params.returnUrl ?? null,
    metadata: {
      escrowRequested: compliance.requiresEscrow,
      physicalVerificationRecommended: compliance.requiresPhysicalVerification,
      snapshot,
    },
  });

  await persistSnapshot(checkout.order.id, params.listingId, snapshot);

  await execute(
    `UPDATE listings SET status = 'reserved' WHERE id = ? AND status = 'published'`,
    [params.listingId],
  );

  await recordAudit({
    action: 'gold.order.created',
    entityType: 'order',
    entityId: checkout.order.id,
    after: { listingId: params.listingId, amount: String(total), currency },
  });

  await notifyUser({
    userId: Number(listing.user_id),
    categoryCode: 'gold.order.status',
    title: 'New gold order',
    body: `A buyer started checkout for ${String(listing.title)} (${roundDecimal(total, 2)} ${currency}).`,
    actionType: 'payment',
    actionTarget: checkout.order.uuid,
    data: { orderId: checkout.order.id, listingId: params.listingId },
  });

  return {
    ...checkout,
    listingId: params.listingId,
    originalPrice: unitPrice,
    originalCurrency: currency,
    referenceMetalValue: snapshot.referenceMetalValue,
    requiresPhysicalVerification: compliance.requiresPhysicalVerification,
    escrowRequested: compliance.requiresEscrow,
    disclaimer: 'The seller price is independent of the live gold market rate. Reference metal value is informational.',
  };
}

export async function confirmGoldDelivery(params: { orderId: number; userId: number }) {
  const order = await queryOne<Row>(
    `SELECT id, user_id, kind, status, reference_id FROM orders WHERE id = ?`,
    [params.orderId],
  );
  if (!order) throw notFound('Order');
  if (Number(order.user_id) !== params.userId) throw forbidden('This order does not belong to you');
  if (String(order.kind) !== 'listing_purchase') throw badRequest('Not a gold listing order');
  if (String(order.status) !== 'paid') throw conflict('Payment must complete before confirmation');

  const listingId = Number(order.reference_id);
  await execute(`UPDATE listings SET status = 'sold', sold_at = CURRENT_TIMESTAMP WHERE id = ?`, [listingId]);
  await execute(
    `UPDATE gold_order_snapshots SET snapshot_json = JSON_SET(COALESCE(snapshot_json, '{}'), '$.deliveryConfirmed', TRUE) WHERE order_id = ?`,
    [params.orderId],
  );

  const listing = await queryOne<Row>('SELECT user_id, title FROM listings WHERE id = ?', [listingId]);
  if (listing) {
    await notifyUser({
      userId: Number(listing.user_id),
      categoryCode: 'gold.order.status',
      title: 'Buyer confirmed delivery',
      body: `The buyer confirmed ${String(listing.title)}. Settlement can proceed.`,
      actionType: 'payment',
      actionTarget: String(params.orderId),
    });
  }

  await recordAudit({
    action: 'gold.order.delivery_confirmed',
    entityType: 'order',
    entityId: params.orderId,
  });

  return { confirmed: true, listingStatus: 'sold' };
}

async function loadGoldListing(listingId: number): Promise<Row> {
  const row = await queryOne<Row>(
    `SELECT l.*, gd.karat, gd.fineness, gd.purity_percent, gd.gross_weight_g, gd.stone_weight_g,
            gd.net_weight_g, gd.fine_gold_weight_g, gd.brand_id, gd.brand_name, gd.certificate_number,
            gd.hallmark_code, gd.making_charge_type, gd.making_charges, gd.certificate_id, gd.hallmark_id,
            c.code AS category_code
       FROM listings l
       JOIN gold_listing_details gd ON gd.listing_id = l.id
       JOIN categories c ON c.id = l.category_id
      WHERE l.id = ? AND l.deleted_at IS NULL`,
    [listingId],
  );
  if (!row) throw notFound('Gold listing');
  return row;
}

async function buildSnapshot(listing: Row, price: number, currency: string, _total: number) {
  const karat = toNumber(listing.karat);
  const fineness = listing.fineness === null ? null : Number(listing.fineness);
  const net = toNumber(listing.net_weight_g);
  const fine =
    toNumber(listing.fine_gold_weight_g) ??
    (net !== null ? toNumberSafe(computeFineGoldWeight(net, fineness, karat) ?? '0', 3) : null);

  const rate = await getGoldRate(
    listing.country_id === null ? null : Number(listing.country_id),
    currency,
    karat ?? 24,
  );
  const metalValue = rate && net ? toNumberSafe(mulDecimal(net, rate.ratePerGram, 2), 2) : null;
  const makingType = (listing.making_charge_type as 'flat' | 'per_gram' | 'percent' | null) ?? null;
  const makingValue = toNumber(listing.making_charges);
  const makingAmount =
    makingType && makingValue !== null && net !== null && metalValue !== null
      ? toNumberSafe(makingChargeAmount({ type: makingType, value: makingValue, netWeightG: net, metalValue }), 2)
      : makingValue;

  return {
    categoryId: Number(listing.category_id),
    categoryCode: String(listing.category_code),
    karat,
    fineness,
    purityPercent: toNumber(listing.purity_percent),
    grossWeightG: toNumber(listing.gross_weight_g),
    stoneWeightG: toNumber(listing.stone_weight_g),
    netWeightG: net,
    fineGoldWeightG: fine,
    brandId: listing.brand_id === null ? null : Number(listing.brand_id),
    brandName: (listing.brand_name as string | null) ?? null,
    certificateId: listing.certificate_id === null ? null : Number(listing.certificate_id),
    certificateNumber: (listing.certificate_number as string | null) ?? null,
    hallmarkId: listing.hallmark_id === null ? null : Number(listing.hallmark_id),
    hallmarkCode: (listing.hallmark_code as string | null) ?? null,
    makingChargeType: makingType,
    makingChargeValue: makingValue,
    makingChargeAmount: makingAmount,
    originalPrice: price,
    originalCurrency: currency,
    referenceMetalValue: metalValue,
    referenceRatePerGram: rate?.ratePerGram ?? null,
  };
}

async function persistSnapshot(
  orderId: number,
  listingId: number,
  snapshot: Awaited<ReturnType<typeof buildSnapshot>>,
): Promise<void> {
  await execute(
    `INSERT INTO gold_order_snapshots
       (order_id, listing_id, category_id, category_code, karat, fineness, purity_percent,
        gross_weight_g, stone_weight_g, net_weight_g, fine_gold_weight_g, brand_id, brand_name,
        certificate_id, certificate_number, hallmark_id, hallmark_code, making_charge_type,
        making_charge_value, making_charge_amount, original_price, original_currency,
        reference_metal_value, reference_rate_per_gram, snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orderId,
      listingId,
      snapshot.categoryId,
      snapshot.categoryCode,
      snapshot.karat,
      snapshot.fineness,
      snapshot.purityPercent,
      snapshot.grossWeightG,
      snapshot.stoneWeightG,
      snapshot.netWeightG,
      snapshot.fineGoldWeightG,
      snapshot.brandId,
      snapshot.brandName,
      snapshot.certificateId,
      snapshot.certificateNumber,
      snapshot.hallmarkId,
      snapshot.hallmarkCode,
      snapshot.makingChargeType,
      snapshot.makingChargeValue,
      snapshot.makingChargeAmount,
      snapshot.originalPrice,
      snapshot.originalCurrency,
      snapshot.referenceMetalValue,
      snapshot.referenceRatePerGram,
      JSON.stringify(snapshot),
    ],
  );
}

