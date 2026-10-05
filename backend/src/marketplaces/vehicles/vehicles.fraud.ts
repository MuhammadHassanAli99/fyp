import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { loggerFor } from '../../config/logger';
import { VEHICLE_FRAUD_AUTO_BAN, VEHICLE_MARKETPLACE_ID, riskBand } from './vehicles.rules';
import { mileageLooksAnomalous } from './vehicles.vin';
import { evaluateRisk } from '../../modules/risk/risk.engine';
import { signalHit } from '../../modules/risk/risk.signals';
import { marketplaceSignalToEngine } from '../../modules/risk/risk.listing';

const log = loggerFor('vehicles.fraud');

export async function analyseVehicleRisk(listingId: number): Promise<{
  score: number;
  risk: 'low' | 'medium' | 'high';
  signals: Array<{ code: string; severity: string; detail: string }>;
  autoBan: false;
}> {
  const listing = await queryOne<Row>(
    `SELECT l.id, l.user_id, l.price, l.currency, l.description,
            vd.vehicle_id, vd.vin, vd.mileage_km, vd.year, vd.make_id, vd.model_id, vd.ai_estimate_mid
       FROM listings l
       JOIN vehicle_listing_details vd ON vd.listing_id = l.id
      WHERE l.id = ?`,
    [listingId],
  );
  if (!listing) {
    return { score: 0, risk: 'low', signals: [], autoBan: VEHICLE_FRAUD_AUTO_BAN };
  }

  const signals: Array<{ code: string; severity: string; detail: string; delta: number }> = [];
  let score = 12;

  if (listing.vin) {
    const dupVin = await queryOne<Row>(
      `SELECT COUNT(*) AS c FROM vehicle_listing_details vd
         JOIN listings l ON l.id = vd.listing_id
        WHERE vd.vin = ? AND l.id <> ? AND l.deleted_at IS NULL AND l.status IN ('published','pending_review')`,
      [listing.vin, listingId],
    );
    if (Number(dupVin?.c ?? 0) > 0) {
      score += 28;
      signals.push({
        code: 'duplicate_vin',
        severity: 'high',
        detail: 'The same VIN appears on another active listing',
        delta: 28,
      });
    }
  }

  const desc = String(listing.description ?? '').trim();
  if (desc.length > 40) {
    const dupDesc = await queryOne<Row>(
      `SELECT COUNT(*) AS c FROM listings
        WHERE id <> ? AND marketplace_id = ? AND deleted_at IS NULL AND description = ?`,
      [listingId, VEHICLE_MARKETPLACE_ID, desc],
    );
    if (Number(dupDesc?.c ?? 0) > 0) {
      score += 16;
      signals.push({
        code: 'duplicate_listing',
        severity: 'medium',
        detail: 'The same description appears on another vehicle listing',
        delta: 16,
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
       WHERE m.listing_id <> ? AND m.perceptual_hash = ? AND l.marketplace_id = ?`,
      [listingId, item.perceptual_hash, VEHICLE_MARKETPLACE_ID],
    );
    if (Number(reused?.c ?? 0) > 0) {
      score += 20;
      signals.push({
        code: 'duplicate_images',
        severity: 'high',
        detail: 'One or more images match another vehicle listing',
        delta: 20,
      });
      break;
    }
  }

  const estimate = toNumber(listing.ai_estimate_mid);
  const price = toNumber(listing.price);
  if (estimate && price && estimate > 0) {
    const pct = ((price - estimate) / estimate) * 100;
    if (pct <= -40 || pct >= 80) {
      score += 14;
      signals.push({
        code: 'suspicious_price',
        severity: 'medium',
        detail: 'Asking price is far from the automated estimate (estimate is not a guaranteed price)',
        delta: 14,
      });
    }
  }

  if (listing.vehicle_id && listing.mileage_km != null) {
    const previous = await queryOne<Row>(
      `SELECT value_km, recorded_at FROM vehicle_mileage_readings
        WHERE vehicle_id = ? ORDER BY recorded_at DESC LIMIT 1 OFFSET 1`,
      [listing.vehicle_id],
    );
    if (previous?.value_km != null) {
      const days =
        previous.recorded_at && listing
          ? Math.round((Date.now() - new Date(previous.recorded_at as Date).getTime()) / 86_400_000)
          : null;
      const check = mileageLooksAnomalous({
        previousKm: Number(previous.value_km),
        nextKm: Number(listing.mileage_km),
        daysBetween: days,
      });
      if (check.anomalous) {
        score += 18;
        signals.push({
          code: 'mileage_anomaly',
          severity: 'high',
          detail: check.reason ?? 'Mileage change looks inconsistent',
          delta: 18,
        });
      }
    }
  }

  const year = listing.year === null ? null : Number(listing.year);
  if (year !== null && year > new Date().getUTCFullYear() + 1) {
    score += 22;
    signals.push({
      code: 'impossible_vehicle',
      severity: 'high',
      detail: 'Model year is implausible',
      delta: 22,
    });
  }

  score = Math.min(99, score);
  for (const signal of signals) {
    await execute(
      `INSERT INTO vehicle_risk_events (listing_id, vehicle_id, user_id, signal_code, severity, score_delta, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        listingId,
        listing.vehicle_id ?? null,
        listing.user_id,
        signal.code,
        signal.severity,
        signal.delta,
        signal.detail,
      ],
    ).catch((error) => log.warn({ err: error }, 'risk event insert skipped'));
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
    risk: riskBand(score),
    signals: signals.map(({ code, severity, detail }) => ({ code, severity, detail })),
    autoBan: VEHICLE_FRAUD_AUTO_BAN,
  };
}
