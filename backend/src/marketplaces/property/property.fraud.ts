import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { loggerFor } from '../../config/logger';
import { PROPERTY_FRAUD_AUTO_BAN, riskBand } from './property.rules';
import { evaluateRisk } from '../../modules/risk/risk.engine';
import { signalHit } from '../../modules/risk/risk.signals';
import { marketplaceSignalToEngine } from '../../modules/risk/risk.listing';

const log = loggerFor('property.fraud');

export async function analysePropertyRisk(listingId: number): Promise<{
  score: number;
  risk: 'low' | 'medium' | 'high';
  signals: Array<{ code: string; severity: string; detail: string }>;
  autoBan: false;
}> {
  const listing = await queryOne<Row>(
    `SELECT l.id, l.user_id, l.price, l.currency, l.description, l.latitude, l.longitude,
            pd.property_kind, pd.area_sqm, pd.ai_valuation_mid, pd.property_id
       FROM listings l
       JOIN property_listing_details pd ON pd.listing_id = l.id
      WHERE l.id = ?`,
    [listingId],
  );
  if (!listing) {
    return { score: 0, risk: 'low', signals: [], autoBan: false };
  }

  const signals: Array<{ code: string; severity: string; detail: string; delta: number }> = [];
  let score = 15;

  const sameCoords = await queryOne<Row>(
    `SELECT COUNT(*) AS c FROM listings l
      JOIN property_listing_details pd ON pd.listing_id = l.id
     WHERE l.id <> ? AND l.deleted_at IS NULL AND l.status IN ('published','pending_review')
       AND l.latitude = ? AND l.longitude = ? AND pd.property_kind = ?`,
    [listingId, listing.latitude, listing.longitude, listing.property_kind],
  );
  if (Number(sameCoords?.c ?? 0) > 0 && listing.latitude !== null) {
    score += 22;
    signals.push({
      code: 'duplicate_location',
      severity: 'medium',
      detail: 'Another listing uses the same coordinates and property type',
      delta: 22,
    });
  }

  const desc = String(listing.description ?? '').trim();
  if (desc.length > 40) {
    const dupDesc = await queryOne<Row>(
      `SELECT COUNT(*) AS c FROM listings
        WHERE id <> ? AND marketplace_id = 2 AND deleted_at IS NULL AND description = ?`,
      [listingId, desc],
    );
    if (Number(dupDesc?.c ?? 0) > 0) {
      score += 18;
      signals.push({
        code: 'duplicate_description',
        severity: 'medium',
        detail: 'The same description appears on another listing',
        delta: 18,
      });
    }
  }

  const media = await queryRows<Row>(
    `SELECT perceptual_hash FROM listing_media WHERE listing_id = ? AND perceptual_hash IS NOT NULL`,
    [listingId],
  );
  for (const item of media.slice(0, 8)) {
    const reused = await queryOne<Row>(
      `SELECT COUNT(*) AS c FROM listing_media m
        JOIN listings l ON l.id = m.listing_id
       WHERE m.listing_id <> ? AND m.perceptual_hash = ? AND l.marketplace_id = 2`,
      [listingId, item.perceptual_hash],
    );
    if (Number(reused?.c ?? 0) > 0) {
      score += 20;
      signals.push({
        code: 'duplicate_images',
        severity: 'high',
        detail: 'One or more images match another property listing',
        delta: 20,
      });
      break;
    }
  }

  const mid = toNumber(listing.ai_valuation_mid);
  const price = toNumber(listing.price);
  if (mid && price && mid > 0) {
    const ratio = price / mid;
    if (ratio < 0.45 || ratio > 3) {
      score += 16;
      signals.push({
        code: 'suspicious_price',
        severity: 'medium',
        detail: `Ask ${price} vs valuation mid ${mid}`,
        delta: 16,
      });
    }
  }

  const devices = await queryOne<Row>(
    `SELECT COUNT(DISTINCT fingerprint_hash) AS devices,
            MAX(fu_count) AS max_users
       FROM (
         SELECT fu.fingerprint_hash, COUNT(*) AS fu_count
           FROM fingerprint_users fu
          WHERE fu.user_id = ?
          GROUP BY fu.fingerprint_hash
       ) x`,
    [Number(listing.user_id)],
  ).catch(() => null);
  if (Number(devices?.max_users ?? 0) >= 4) {
    score += 14;
    signals.push({
      code: 'shared_device',
      severity: 'medium',
      detail: 'Seller device is linked to multiple accounts',
      delta: 14,
    });
  }

  score = Math.min(99, score);
  const risk = riskBand(score);

  for (const signal of signals) {
    await insertAndGetId(
      `INSERT INTO property_risk_events (listing_id, property_id, user_id, signal_code, severity, score_delta, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        listingId,
        listing.property_id ?? null,
        Number(listing.user_id),
        signal.code,
        signal.severity,
        signal.delta,
        signal.detail,
      ],
    ).catch((error) => log.warn({ err: error }, 'risk event persist skipped'));
  }

  const extra = [];
  for (const signal of signals) {
    extra.push(await signalHit(marketplaceSignalToEngine(signal.code), signal.delta, signal.detail, 'content'));
  }
  await evaluateRisk({
    eventType: 'LISTING_SUBMITTED',
    subjectKind: 'listing',
    subjectId: listingId,
    userId: Number(listing.user_id),
    listingId,
    policyCode: 'listing',
    extraSignals: extra,
  }).catch((error) => log.warn({ err: error }, 'central risk engine skipped'));

  return {
    score,
    risk,
    signals: signals.map(({ code, severity, detail }) => ({ code, severity, detail })),
    autoBan: PROPERTY_FRAUD_AUTO_BAN,
  };
}

export { execute };
