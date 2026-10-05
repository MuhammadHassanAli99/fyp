import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { uuid } from '../../core/security/crypto';
import { addDecimal, mulDecimal, roundDecimal, toNumberSafe } from '../../core/decimal';
import { loggerFor } from '../../config/logger';
import { getGoldRate } from './gold.service';
import { computeFineGoldWeight } from './gold.weights';

const log = loggerFor('gold.ai');

export const AUTHENTICITY_MODEL = {
  id: 'gold-authenticity-risk',
  version: '2',
  featureVersion: '1',
} as const;

export const FORECAST_MODEL = {
  id: 'gold-forecast',
  version: '1',
  featureVersion: '1',
} as const;

const DISCLAIMER =
  'AI authenticity assessment is a risk-support tool. It cannot prove physical gold is genuine, determine chemical composition, or replace laboratory / hallmark / XRF verification. Independent physical verification is recommended for high-value transactions.';

export interface GoldRiskAssessment {
  uuid: string;
  risk: 'low' | 'medium' | 'high';
  confidence: number;
  score: number;
  reasons: Array<{ code: string; label: string; detail: string; direction: 'up' | 'down' | 'neutral' }>;
  recommendation: string;
  physicalVerificationRecommended: boolean;
  model: { id: string; version: string; featureVersion: string };
  disclaimer: string;
}

export async function assessAuthenticityRisk(input: {
  listingId?: number | null;
  userId?: number | null;
  declaredKarat: number;
  declaredWeightG: number;
  measuredVolumeMl?: number | null;
  isHallmarked: boolean;
  hallmarkCode?: string | null;
  hasCertificate: boolean;
  certificateNumber?: string | null;
  price?: number | null;
  currency?: string | null;
  countryId?: number | null;
  mediaId?: number | null;
}): Promise<GoldRiskAssessment> {
  const reasons: GoldRiskAssessment['reasons'] = [];
  let score = 50;

  const expectedDensity: Record<number, number> = { 24: 19.3, 22: 17.7, 21: 16.8, 18: 15.6, 14: 13.1, 10: 11.6, 9: 11.2 };
  if (input.measuredVolumeMl && input.measuredVolumeMl > 0 && expectedDensity[input.declaredKarat]) {
    const measured = input.declaredWeightG / input.measuredVolumeMl;
    const expected = expectedDensity[input.declaredKarat]!;
    const deviation = Math.abs(measured - expected) / expected;
    const passed = deviation <= 0.06;
    score += passed ? 18 : -28;
    reasons.push({
      code: 'density',
      label: 'Density plausibility',
      detail: `Measured ${measured.toFixed(2)} g/cm³ vs ${expected} g/cm³ expected for ${input.declaredKarat}K`,
      direction: passed ? 'down' : 'up',
    });
  } else {
    reasons.push({
      code: 'density',
      label: 'Density plausibility',
      detail: 'Not run — volume measurement was not provided. Visual AI cannot determine composition.',
      direction: 'neutral',
    });
  }

  score += input.isHallmarked ? 10 : -6;
  reasons.push({
    code: 'hallmark',
    label: input.isHallmarked ? 'Hallmark declared' : 'No hallmark declared',
    detail: input.isHallmarked ? `Code ${input.hallmarkCode ?? 'present'}` : 'Common for scrap or antique pieces; reduces confidence',
    direction: input.isHallmarked ? 'down' : 'up',
  });

  score += input.hasCertificate ? 12 : -4;
  reasons.push({
    code: 'certificate',
    label: input.hasCertificate ? 'Certificate declared' : 'No certificate attached',
    detail: input.hasCertificate ? `Number ${input.certificateNumber ?? 'on file'}` : 'Ask for an assay certificate from a recognised issuer',
    direction: input.hasCertificate ? 'down' : 'up',
  });

  if (input.price && input.price > 0 && input.currency) {
    const rate = await getGoldRate(input.countryId ?? null, input.currency, input.declaredKarat);
    if (rate) {
      const metalValue = toNumberSafe(mulDecimal(input.declaredWeightG, rate.ratePerGram, 2), 2);
      const ratio = metalValue > 0 ? input.price / metalValue : 1;
      if (ratio < 0.85) {
        score -= 32;
        reasons.push({
          code: 'price_sanity',
          label: 'Price unusually low vs metal value',
          detail: `Asking price is ${(ratio * 100).toFixed(0)}% of the ${input.declaredKarat}K reference metal value`,
          direction: 'up',
        });
      } else if (ratio >= 0.95) {
        score += 8;
        reasons.push({
          code: 'price_sanity',
          label: 'Price consistent with metal value',
          detail: `Asking price is ${(ratio * 100).toFixed(0)}% of today's reference metal value`,
          direction: 'down',
        });
      } else {
        reasons.push({
          code: 'price_sanity',
          label: 'Price near metal value',
          detail: `Asking price is ${(ratio * 100).toFixed(0)}% of today's reference metal value`,
          direction: 'neutral',
        });
      }
    }
  }

  if (input.userId) {
    const history = await queryOne<Row>(
      `SELECT ts.score AS trust_score, ts.band,
              (SELECT COUNT(*) FROM fake_detections WHERE target_kind = 'user' AND target_id = ? AND status IN ('detected','confirmed')) AS flags
         FROM trust_scores ts WHERE ts.user_id = ?`,
      [input.userId, input.userId],
    );
    const trust = toNumber(history?.trust_score) ?? 0;
    const flags = Number(history?.flags ?? 0);
    if (flags > 0) {
      score -= 24;
      reasons.push({
        code: 'seller_risk',
        label: 'Seller risk signals',
        detail: `${flags} prior fraud flag(s); trust ${trust.toFixed(0)}/100`,
        direction: 'up',
      });
    } else {
      score += trust >= 70 ? 8 : trust >= 40 ? 3 : -4;
      reasons.push({
        code: 'seller_history',
        label: 'Seller history',
        detail: `Trust score ${trust.toFixed(0)}/100 (${(history?.band as string) ?? 'new'})`,
        direction: trust >= 40 ? 'down' : 'up',
      });
    }
  }

  if (input.mediaId) {
    const media = await queryOne<Row>(
      `SELECT lm.width, lm.height, COALESCE(mh.phash, lm.perceptual_hash) AS phash
         FROM listing_media lm
         LEFT JOIN media_hashes mh ON mh.media_id = lm.id
        WHERE lm.id = ?`,
      [input.mediaId],
    );
    const width = Number(media?.width ?? 0);
    const height = Number(media?.height ?? 0);
    if (width > 0 && height > 0 && (width < 640 || height < 480)) {
      score -= 8;
      reasons.push({
        code: 'image_quality',
        label: 'Image quality poor',
        detail: `${width}×${height} — hallmark/OCR assist is unreliable at this resolution`,
        direction: 'up',
      });
    }
    const phash = media?.phash as string | null;
    if (phash) {
      const dupes = await queryRows<Row>(
        `SELECT COUNT(*) AS c FROM media_hashes WHERE phash = ? AND media_id <> ?`,
        [phash, input.mediaId],
      );
      const count = Number(dupes[0]?.c ?? 0);
      if (count > 0) {
        score -= 20;
        reasons.push({
          code: 'duplicate_image',
          label: 'Suspicious duplicate image',
          detail: 'This photo matches another listing image on the platform',
          direction: 'up',
        });
      }
    } else {
      reasons.push({
        code: 'image_assist',
        label: 'Visual assist incomplete',
        detail: 'Hallmark OCR, serial extraction and manipulation detection require a vision model and were not run as a chemical test.',
        direction: 'neutral',
      });
    }
  }

  if (input.certificateNumber) {
    const reused = await queryOne<Row>(
      `SELECT COUNT(*) AS c FROM gold_certificates
        WHERE certificate_number = ? AND deleted_at IS NULL
          AND (? IS NULL OR listing_id <> ?)`,
      [input.certificateNumber, input.listingId ?? null, input.listingId ?? 0],
    );
    if (Number(reused?.c ?? 0) > 0) {
      score -= 22;
      reasons.push({
        code: 'certificate_reuse',
        label: 'Certificate number reused',
        detail: 'The same certificate number appears on another listing',
        direction: 'up',
      });
    }
  }

  score = Math.max(0, Math.min(100, score));
  const risk: GoldRiskAssessment['risk'] = score >= 70 ? 'low' : score >= 45 ? 'medium' : 'high';
  const confidence = Math.max(25, Math.min(90, 40 + reasons.filter((r) => r.direction !== 'neutral').length * 8));
  const physicalVerificationRecommended = risk !== 'low';
  const recommendation =
    risk === 'high'
      ? 'Independent physical verification is recommended before paying. Do not treat this score as proof of authenticity.'
      : risk === 'medium'
        ? 'AI could not confidently assess authenticity. Verify hallmark/certificate in person for expensive transactions.'
        : 'AI authenticity assessment: Low risk. This is not confirmation that the item is real gold.';

  const resultUuid = uuid();
  const payload = { reasons, recommendation, physicalVerificationRecommended };

  await execute(
    `INSERT INTO gold_authenticity_checks
       (uuid, listing_id, user_id, method, input_media_id, declared_karat, declared_weight_g,
        measured_value, score, verdict, risk_level, confidence, signals, model, model_id, model_version, feature_version, result_status)
     VALUES (?, ?, ?, 'composite', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`,
    [
      resultUuid,
      input.listingId ?? null,
      input.userId ?? null,
      input.mediaId ?? null,
      input.declaredKarat,
      input.declaredWeightG,
      input.measuredVolumeMl ? input.declaredWeightG / input.measuredVolumeMl : null,
      score,
      risk === 'low' ? 'inconclusive' : risk === 'medium' ? 'inconclusive' : 'suspicious',
      risk,
      confidence,
      JSON.stringify(payload),
      `${AUTHENTICITY_MODEL.id}-v${AUTHENTICITY_MODEL.version}`,
      AUTHENTICITY_MODEL.id,
      AUTHENTICITY_MODEL.version,
      AUTHENTICITY_MODEL.featureVersion,
    ],
  ).catch((error) => log.warn({ err: error }, 'could not persist authenticity check'));

  await execute(
    `INSERT INTO gold_ai_assessments
       (uuid, listing_id, user_id, kind, model_id, model_version, feature_version, risk_level, confidence, score,
        prediction, reasons, recommendation, result_status)
     VALUES (?, ?, ?, 'authenticity_risk', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`,
    [
      resultUuid,
      input.listingId ?? null,
      input.userId ?? null,
      AUTHENTICITY_MODEL.id,
      AUTHENTICITY_MODEL.version,
      AUTHENTICITY_MODEL.featureVersion,
      risk,
      confidence,
      score,
      JSON.stringify({ risk, score }),
      JSON.stringify(reasons),
      recommendation,
    ],
  ).catch((error) => log.warn({ err: error }, 'could not persist AI assessment'));

  if (input.listingId) {
    await execute(
      `UPDATE gold_listing_details
          SET authenticity_score = ?, authenticity_verdict = 'unverified',
              authenticity_risk = ?, authenticity_confidence = ?,
              authenticity_model_id = ?, authenticity_model_version = ?,
              authenticity_checks = ?
        WHERE listing_id = ?`,
      [
        score,
        risk,
        confidence,
        AUTHENTICITY_MODEL.id,
        AUTHENTICITY_MODEL.version,
        JSON.stringify(Object.fromEntries(reasons.map((r) => [r.code, r.direction]))),
        input.listingId,
      ],
    ).catch(() => undefined);
  }

  return {
    uuid: resultUuid,
    risk,
    confidence,
    score,
    reasons,
    recommendation,
    physicalVerificationRecommended,
    model: { id: AUTHENTICITY_MODEL.id, version: AUTHENTICITY_MODEL.version, featureVersion: AUTHENTICITY_MODEL.featureVersion },
    disclaimer: DISCLAIMER,
  };
}

export async function generateForecasts(params: {
  countryId: number | null;
  currency: string;
  karat: number;
}): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT as_of_date, rate_per_gram
       FROM gold_rate_history
      WHERE (country_id = ? OR (? IS NULL AND country_id IS NULL))
        AND currency = ? AND karat = ?
        AND as_of_date >= DATE_SUB(CURRENT_DATE, INTERVAL 60 DAY)
      ORDER BY as_of_date ASC`,
    [params.countryId, params.countryId, params.currency, params.karat],
  );
  if (rows.length < 7) return 0;

  const rates = rows.map((row) => toNumber(row.rate_per_gram) ?? 0).filter((n) => n > 0);
  if (rates.length < 7) return 0;

  const sma = (window: number) => {
    const slice = rates.slice(-window);
    const sum = slice.reduce((acc, n) => acc + n, 0);
    return sum / slice.length;
  };

  const last = rates[rates.length - 1]!;
  const sma7 = sma(7);
  const sma30 = rates.length >= 30 ? sma(30) : sma7;
  const returns: number[] = [];
  for (let i = 1; i < rates.length; i += 1) {
    if (rates[i - 1]! > 0) returns.push((rates[i]! - rates[i - 1]!) / rates[i - 1]!);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / Math.max(returns.length, 1);
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(returns.length, 1);
  const vol = Math.sqrt(variance);

  const horizons: Array<{ code: '1d' | '7d' | '30d'; days: number }> = [
    { code: '1d', days: 1 },
    { code: '7d', days: 7 },
    { code: '30d', days: 30 },
  ];

  let written = 0;
  for (const horizon of horizons) {
    const predicted = sma7 * (1 + mean * horizon.days * 0.35);
    const band = last * vol * Math.sqrt(horizon.days) * 1.64;
    const lower = Math.max(0, predicted - band);
    const upper = predicted + band;
    const direction = predicted > last * 1.004 ? 'up' : predicted < last * 0.996 ? 'down' : 'flat';
    const confidence = Math.max(25, Math.min(78, 70 - vol * 400 - (horizon.days > 7 ? 12 : 0)));
    const target = new Date();
    target.setUTCDate(target.getUTCDate() + horizon.days);

    await execute(
      `INSERT INTO gold_price_predictions
         (country_id, currency, karat, horizon, predicted_rate, lower_bound, upper_bound, confidence,
          direction, drivers, model, model_id, model_version, feature_version, result_status, target_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sma-vol-v1', ?, ?, ?, 'ready', ?)
       ON DUPLICATE KEY UPDATE
         predicted_rate = VALUES(predicted_rate), lower_bound = VALUES(lower_bound),
         upper_bound = VALUES(upper_bound), confidence = VALUES(confidence),
         direction = VALUES(direction), generated_at = CURRENT_TIMESTAMP, result_status = 'ready'`,
      [
        params.countryId,
        params.currency,
        params.karat,
        horizon.code,
        roundDecimal(predicted, 4),
        roundDecimal(lower, 4),
        roundDecimal(upper, 4),
        roundDecimal(confidence, 2),
        direction,
        JSON.stringify({ sma7, sma30, last, sample: rates.length, note: 'Statistical range, not a guaranteed price' }),
        FORECAST_MODEL.id,
        FORECAST_MODEL.version,
        FORECAST_MODEL.featureVersion,
        target.toISOString().slice(0, 10),
      ],
    );
    written += 1;
  }

  await execute(
    `INSERT INTO gold_ai_assessments
       (uuid, listing_id, user_id, kind, model_id, model_version, feature_version, confidence, prediction, recommendation, result_status)
     VALUES (?, NULL, NULL, 'price_forecast', ?, ?, ?, ?, ?, ?, 'ready')`,
    [
      uuid(),
      FORECAST_MODEL.id,
      FORECAST_MODEL.version,
      FORECAST_MODEL.featureVersion,
      55,
      JSON.stringify({ countryId: params.countryId, currency: params.currency, karat: params.karat }),
      'Forecasts are estimated ranges, not guaranteed future prices.',
    ],
  ).catch(() => undefined);

  return written;
}

export async function refreshListingMarketDelta(listingId: number): Promise<void> {
  const row = await queryOne<Row>(
    `SELECT gd.net_weight_g, gd.karat, gd.fineness, gd.rate_per_gram, l.price, l.currency, l.country_id
       FROM gold_listing_details gd
       JOIN listings l ON l.id = gd.listing_id
      WHERE gd.listing_id = ?`,
    [listingId],
  );
  if (!row) return;
  const karat = toNumber(row.karat);
  const net = toNumber(row.net_weight_g);
  const price = toNumber(row.price);
  const currency = row.currency as string | null;
  if (!karat || !net || !price || !currency) return;

  const rate = await getGoldRate(row.country_id === null ? null : Number(row.country_id), currency, karat);
  if (!rate) return;

  const fine = computeFineGoldWeight(net, row.fineness === null ? null : Number(row.fineness), karat);
  const metal = toNumberSafe(mulDecimal(net, rate.ratePerGram, 2), 2);
  const deltaPct = metal > 0 ? ((price - metal) / metal) * 100 : null;

  await execute(
    `UPDATE gold_listing_details
        SET rate_per_gram = ?, rate_currency = ?, metal_value = ?,
            fine_gold_weight_g = COALESCE(fine_gold_weight_g, ?),
            ai_fair_price_low = ?, ai_fair_price_high = ?, price_vs_market_pct = ?
      WHERE listing_id = ?`,
    [
      rate.ratePerGram,
      currency,
      metal,
      fine,
      roundDecimal(mulDecimal(metal, '0.97', 2), 2),
      roundDecimal(addDecimal(metal, mulDecimal(metal, '0.12', 2), 2), 2),
      deltaPct === null ? null : roundDecimal(deltaPct, 3),
      listingId,
    ],
  );
}
