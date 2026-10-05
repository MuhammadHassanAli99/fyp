import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { remember, cache, cacheKeys } from '../../config/cache';
import { notFound, badRequest } from '../../core/errors';
import { uuid } from '../../core/security/crypto';
import { makingChargeAmount, mulDecimal, roundDecimal as roundDec, toNumberSafe } from '../../core/decimal';
import { GRAMS_PER_TOLA, GRAMS_PER_TROY_OUNCE, mapMakingChargeType, netGoldWeight, toGrams } from './gold.weights';
import { loggerFor } from '../../config/logger';

const log = loggerFor('gold');

export interface GoldRate {
  countryId: number | null;
  cityId: number | null;
  currency: string;
  metal: string;
  karat: number;
  ratePerGram: number;
  ratePerTola: number;
  ratePerOunce: number;
  ratePer10g: number;
  buyRate: number | null;
  sellRate: number | null;
  changeAmount: number | null;
  changePercent: number | null;
  source: string;
  asOf: string;
}

const mapRate = (row: Row): GoldRate => {
  const perGram = toNumber(row.rate_per_gram) ?? 0;
  return {
    countryId: row.country_id === null ? null : Number(row.country_id),
    cityId: row.city_id === null ? null : Number(row.city_id),
    currency: String(row.currency),
    metal: String(row.metal),
    karat: toNumber(row.karat) ?? 0,
    ratePerGram: perGram,
    ratePerTola: toNumber(row.rate_per_tola) ?? toNumberSafe(mulDecimal(perGram, GRAMS_PER_TOLA, 4), 4),
    ratePerOunce: toNumber(row.rate_per_ounce) ?? toNumberSafe(mulDecimal(perGram, GRAMS_PER_TROY_OUNCE, 4), 4),
    ratePer10g: toNumber(row.rate_per_10g) ?? toNumberSafe(mulDecimal(perGram, 10, 4), 4),
    buyRate: toNumber(row.buy_rate),
    sellRate: toNumber(row.sell_rate),
    changeAmount: toNumber(row.change_amount),
    changePercent: toNumber(row.change_percent),
    source: String(row.source),
    asOf: (row.as_of as Date).toISOString(),
  };
};

/**
 * Live rates (§5 Live gold rates).
 *
 * Falls back country → international spot, because a market we have not
 * onboarded yet should still show a usable reference price rather than nothing.
 */
export async function getGoldRates(params: {
  countryId?: number | null;
  cityId?: number | null;
  currency?: string;
  metal?: string;
  karats?: number[];
}): Promise<GoldRate[]> {
  const metal = params.metal ?? 'gold';
  const cacheKey = `gold:rates:${params.countryId ?? 'intl'}:${params.cityId ?? 'all'}:${params.currency ?? 'any'}:${metal}`;

  const rows = await remember(cacheKey, 60, async () => {
    const local = await queryRows<Row>(
      `SELECT * FROM gold_rates
        WHERE metal = ?
          AND (country_id = ? OR (? IS NULL AND country_id IS NULL))
          AND (city_id = ? OR city_id IS NULL)
          AND (? IS NULL OR currency = ?)
        ORDER BY (city_id IS NULL), karat DESC`,
      [metal, params.countryId ?? null, params.countryId ?? null, params.cityId ?? null, params.currency ?? null, params.currency ?? null],
    );
    if (local.length > 0) return local;

    return queryRows<Row>(
      `SELECT * FROM gold_rates WHERE metal = ? AND country_id IS NULL ORDER BY karat DESC`,
      [metal],
    );
  });

  const rates = rows.map(mapRate);
  // One row per karat: prefer the city-specific rate the query already ordered first.
  const byKarat = new Map<number, GoldRate>();
  for (const rate of rates) {
    if (params.karats && params.karats.length > 0 && !params.karats.includes(rate.karat)) continue;
    if (!byKarat.has(rate.karat)) byKarat.set(rate.karat, rate);
  }
  return [...byKarat.values()].sort((a, b) => b.karat - a.karat);
}

export async function getGoldRate(countryId: number | null, currency: string, karat: number): Promise<GoldRate | null> {
  const rates = await getGoldRates({ countryId, currency, karats: [karat] });
  return rates[0] ?? null;
}

/** Rate history for the sparkline / chart on the gold home screen. */
export async function getGoldRateHistory(params: {
  countryId: number | null;
  currency: string;
  karat: number;
  days: number;
}): Promise<Array<{ date: string; ratePerGram: number; open: number | null; high: number | null; low: number | null; close: number | null }>> {
  const rows = await queryRows<Row>(
    `SELECT as_of_date, rate_per_gram, open_rate, high_rate, low_rate, close_rate
       FROM gold_rate_history
      WHERE (country_id = ? OR (? IS NULL AND country_id IS NULL))
        AND currency = ? AND karat = ?
        AND as_of_date >= DATE_SUB(CURRENT_DATE, INTERVAL ? DAY)
      ORDER BY as_of_date ASC`,
    [params.countryId, params.countryId, params.currency, params.karat, params.days],
  );
  return rows.map((row) => ({
    date: (row.as_of_date as Date).toISOString().slice(0, 10),
    ratePerGram: toNumber(row.rate_per_gram) ?? 0,
    open: toNumber(row.open_rate),
    high: toNumber(row.high_rate),
    low: toNumber(row.low_rate),
    close: toNumber(row.close_rate),
  }));
}

/**
 * §5 Price prediction / §18 Gold Trend Prediction.
 *
 * Reads the newest stored prediction per horizon. Generation itself is a job so
 * that a user request never waits on a model call.
 */
export async function getGoldPredictions(params: {
  countryId: number | null;
  currency: string;
  karat: number;
}): Promise<Array<{
  horizon: string;
  predictedRate: number;
  lowerBound: number | null;
  upperBound: number | null;
  confidence: number | null;
  direction: string | null;
  drivers: unknown;
  targetDate: string;
  model: string | null;
  modelId: string | null;
  modelVersion: string | null;
  generatedAt: string | null;
  disclaimer: string;
}>> {
  const rows = await queryRows<Row>(
    `SELECT p.horizon, p.predicted_rate, p.lower_bound, p.upper_bound, p.confidence, p.direction, p.drivers, p.target_date,
            p.model, p.model_id, p.model_version, p.feature_version, p.generated_at
       FROM gold_price_predictions p
       JOIN (SELECT horizon, MAX(generated_at) AS newest
               FROM gold_price_predictions
              WHERE (country_id = ? OR (? IS NULL AND country_id IS NULL)) AND currency = ? AND karat = ?
              GROUP BY horizon) latest
         ON latest.horizon = p.horizon AND latest.newest = p.generated_at
      WHERE (p.country_id = ? OR (? IS NULL AND p.country_id IS NULL)) AND p.currency = ? AND p.karat = ?
      ORDER BY FIELD(p.horizon, '1d','7d','30d','90d','180d','1y')`,
    [params.countryId, params.countryId, params.currency, params.karat, params.countryId, params.countryId, params.currency, params.karat],
  );

  return rows.map((row) => ({
    horizon: String(row.horizon),
    predictedRate: toNumber(row.predicted_rate) ?? 0,
    lowerBound: toNumber(row.lower_bound),
    upperBound: toNumber(row.upper_bound),
    confidence: toNumber(row.confidence),
    direction: row.direction as string | null,
    drivers: row.drivers ?? null,
    targetDate: (row.target_date as Date).toISOString().slice(0, 10),
    model: (row.model as string | null) ?? null,
    modelId: (row.model_id as string | null) ?? null,
    modelVersion: (row.model_version as string | null) ?? null,
    generatedAt: row.generated_at ? (row.generated_at as Date).toISOString() : null,
    disclaimer: 'Forecasts are estimated ranges with a model version, not guaranteed future prices.',
  }));
}

/**
 * Quotes a piece from its physical properties (§5 Making Charges).
 * Used by the "estimate my gold" tool and to pre-fill a new listing's price.
 */
export interface GoldQuoteInput {
  karat: number;
  weight: number;
  weightUnit: 'gram' | 'tola' | 'ounce' | 'kg';
  stoneWeightG?: number;
  makingCharges?: number;
  makingChargeType?: 'flat' | 'per_gram' | 'percent';
  wastagePercent?: number;
  stoneCharges?: number;
  taxPercent?: number;
  countryId: number | null;
  currency: string;
}

export interface GoldQuote {
  currency: string;
  karat: number;
  netWeightG: number;
  ratePerGram: number;
  lines: Array<{ code: string; label: string; amount: number }>;
  total: number;
  buybackEstimate: number;
  rateAsOf: string;
}

export async function quoteGold(input: GoldQuoteInput): Promise<GoldQuote> {
  const rate = await getGoldRate(input.countryId, input.currency, input.karat);
  if (!rate) {
    throw notFound(`Gold rate for ${input.karat}K in ${input.currency}`);
  }

  const grams = toGrams(input.weight, input.weightUnit);
  const netWeight = netGoldWeight(grams, input.stoneWeightG ?? 0);
  const metalValue = mulDecimal(netWeight, rate.ratePerGram, 2);
  const lines: GoldQuote['lines'] = [{ code: 'metal', label: 'Metal value', amount: toNumberSafe(metalValue, 2) }];

  const makingType = mapMakingChargeType(input.makingChargeType) ?? input.makingChargeType ?? 'flat';
  if (input.makingCharges && input.makingCharges > 0) {
    const amount = makingChargeAmount({
      type: makingType,
      value: input.makingCharges,
      netWeightG: netWeight,
      metalValue,
    });
    lines.push({ code: 'making', label: 'Making charges', amount: toNumberSafe(amount, 2) });
  }
  if (input.wastagePercent && input.wastagePercent > 0) {
    lines.push({
      code: 'wastage',
      label: `Wastage (${input.wastagePercent}%)`,
      amount: toNumberSafe(makingChargeAmount({ type: 'percent', value: input.wastagePercent, netWeightG: netWeight, metalValue }), 2),
    });
  }
  if (input.stoneCharges && input.stoneCharges > 0) {
    lines.push({ code: 'stones', label: 'Stone charges', amount: toNumberSafe(roundDec(input.stoneCharges, 2), 2) });
  }

  const subtotal = lines.reduce((sum, line) => toNumberSafe(mulDecimal(sum, 1, 2), 2) + line.amount, 0);
  const subtotalDec = roundDec(subtotal, 2);
  if (input.taxPercent && input.taxPercent > 0) {
    lines.push({
      code: 'tax',
      label: `Tax (${input.taxPercent}%)`,
      amount: toNumberSafe(makingChargeAmount({ type: 'percent', value: input.taxPercent, netWeightG: netWeight, metalValue: subtotalDec }), 2),
    });
  }

  const total = lines.reduce((sum, line) => sum + line.amount, 0);

  return {
    currency: input.currency,
    karat: input.karat,
    netWeightG: toNumberSafe(netWeight, 3),
    ratePerGram: rate.ratePerGram,
    lines,
    total: toNumberSafe(roundDec(total, 2), 2),
    buybackEstimate: toNumberSafe(mulDecimal(metalValue, '0.96', 2), 2),
    rateAsOf: rate.asOf,
  };
}

/**
 * §5 "Fake gold detection support".
 *
 * Deliberately framed as *support*, not a verdict: we combine cheap, explainable
 * signals (declared density plausibility, hallmark presence, certificate lookup,
 * price that is too good to be true, seller history) into a score with the
 * reasoning attached. Claiming to detect fake gold from a photo alone would be
 * dishonest, so the output always states which checks ran.
 */
export interface AuthenticityInput {
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
}

export interface AuthenticityResult {
  uuid: string;
  score: number;
  risk: 'low' | 'medium' | 'high';
  verdict: 'inconclusive' | 'suspicious' | 'unverified';
  checks: Array<{ code: string; label: string; passed: boolean | null; detail: string }>;
  guidance: string[];
  disclaimer: string;
}

/** Density of gold alloys in g/cm³ — the physical basis of the classic test. */
const ALLOY_DENSITY: Record<string, number> = {
  '24': 19.3,
  '22': 17.7,
  '21': 16.8,
  '18': 15.6,
  '14': 13.1,
  '10': 11.6,
  '9': 11.2,
};

export async function checkGoldAuthenticity(input: AuthenticityInput): Promise<AuthenticityResult> {
  const checks: AuthenticityResult['checks'] = [];
  const guidance: string[] = [];
  let score = 50; // Start neutral: absence of evidence is not evidence.

  // 1. Density plausibility — the single most decisive cheap physical test.
  const expectedDensity = ALLOY_DENSITY[String(input.declaredKarat)];
  if (input.measuredVolumeMl && input.measuredVolumeMl > 0 && expectedDensity) {
    const measured = input.declaredWeightG / input.measuredVolumeMl;
    const deviation = Math.abs(measured - expectedDensity) / expectedDensity;
    const passed = deviation <= 0.06;
    score += passed ? 30 : -35;
    checks.push({
      code: 'density',
      label: 'Density matches declared purity',
      passed,
      detail: `Measured ${measured.toFixed(2)} g/cm³ against ${expectedDensity} g/cm³ expected for ${input.declaredKarat}K (${(deviation * 100).toFixed(1)}% off)`,
    });
    if (!passed) {
      guidance.push('The weight-to-volume ratio does not match this purity. Ask for an XRF or acid test before paying.');
    }
  } else {
    checks.push({
      code: 'density',
      label: 'Density matches declared purity',
      passed: null,
      detail: 'Not run — needs the item volume (water displacement) to compute',
    });
    guidance.push('A water-displacement volume measurement enables the strongest low-cost authenticity check.');
  }

  // 2. Hallmark.
  score += input.isHallmarked ? 12 : -8;
  checks.push({
    code: 'hallmark',
    label: 'Carries a hallmark',
    passed: input.isHallmarked,
    detail: input.isHallmarked
      ? `Hallmark ${input.hallmarkCode ?? 'present'}`
      : 'No hallmark declared — common for older or scrap pieces but reduces confidence',
  });

  // 3. Certificate.
  score += input.hasCertificate ? 15 : -5;
  checks.push({
    code: 'certificate',
    label: 'Has an assay certificate',
    passed: input.hasCertificate,
    detail: input.hasCertificate ? `Certificate ${input.certificateNumber ?? 'attached'}` : 'No certificate attached',
  });
  if (!input.hasCertificate) {
    guidance.push('Ask the seller for an assay certificate from a recognised lab.');
  }

  // 4. Price sanity: gold priced well under metal value is the classic scam tell.
  if (input.price && input.price > 0 && input.currency) {
    const rate = await getGoldRate(input.countryId ?? null, input.currency, input.declaredKarat);
    if (rate) {
      const metalValue = input.declaredWeightG * rate.ratePerGram;
      const ratio = input.price / metalValue;
      const passed = ratio >= 0.85;
      score += ratio >= 0.95 ? 15 : ratio >= 0.85 ? 5 : -40;
      checks.push({
        code: 'price_sanity',
        label: 'Price is consistent with metal value',
        passed,
        detail: `Asking price is ${(ratio * 100).toFixed(0)}% of the ${input.declaredKarat}K metal value at today's rate`,
      });
      if (ratio < 0.85) {
        guidance.push(
          `This is priced ${((1 - ratio) * 100).toFixed(0)}% below its metal value. Genuine gold is rarely sold at a loss — treat this as a strong warning sign.`,
        );
      }
    }
  }

  // 5. Seller history.
  if (input.userId) {
    const history = await queryOne<Row>(
      `SELECT ts.score AS trust_score, ts.band,
              (SELECT COUNT(*) FROM listings WHERE user_id = ? AND status = 'published') AS active_listings,
              (SELECT COUNT(*) FROM fake_detections WHERE target_kind = 'user' AND target_id = ? AND status IN ('detected','confirmed')) AS flags
         FROM trust_scores ts WHERE ts.user_id = ?`,
      [input.userId, input.userId, input.userId],
    );
    const trust = toNumber(history?.trust_score) ?? 0;
    const flags = Number(history?.flags ?? 0);
    const passed = flags === 0 && trust >= 40;
    score += flags > 0 ? -30 : trust >= 70 ? 10 : trust >= 40 ? 4 : -6;
    checks.push({
      code: 'seller_history',
      label: 'Seller has a clean history',
      passed,
      detail: flags > 0
        ? `${flags} previous fraud flag(s) on this seller`
        : `Trust score ${trust.toFixed(0)}/100 (${history?.band ?? 'new'})`,
    });
    if (flags > 0) guidance.push('This seller has prior fraud flags. Meet in person at a licensed shop and verify before paying.');
  }

  score = Math.max(0, Math.min(100, score));
  const risk: AuthenticityResult['risk'] = score >= 70 ? 'low' : score >= 45 ? 'medium' : 'high';
  const verdict: AuthenticityResult['verdict'] =
    risk === 'high' ? 'suspicious' : 'inconclusive';

  if (risk !== 'low') {
    guidance.push('Independent physical verification is recommended for expensive transactions.');
  }
  guidance.push('This is a risk assessment, not confirmation that the item is real gold.');

  const resultUuid = uuid();
  await execute(
    `INSERT INTO gold_authenticity_checks
       (uuid, listing_id, user_id, method, input_media_id, declared_karat, declared_weight_g,
        measured_value, score, verdict, signals, model)
     VALUES (?, ?, ?, 'composite', ?, ?, ?, ?, ?, ?, ?, 'rules-v1')`,
    [
      resultUuid,
      input.listingId ?? null,
      input.userId ?? null,
      input.mediaId ?? null,
      input.declaredKarat,
      input.declaredWeightG,
      input.measuredVolumeMl ? input.declaredWeightG / input.measuredVolumeMl : null,
      score,
      verdict,
      JSON.stringify({ checks, guidance }),
    ],
  ).catch((error) => log.warn({ err: error }, 'could not persist authenticity check'));

  if (input.listingId) {
    await execute(
      `UPDATE gold_listing_details
          SET authenticity_score = ?, authenticity_verdict = ?, authenticity_checks = ?
        WHERE listing_id = ?`,
      [score, verdict, JSON.stringify(Object.fromEntries(checks.map((check) => [check.code, check.passed]))), input.listingId],
    ).catch(() => undefined);
  }

  return {
    uuid: resultUuid,
    score,
    risk,
    verdict,
    checks,
    guidance,
    disclaimer:
      'AI authenticity assessment is a risk-support tool. It cannot prove physical gold is genuine.',
  };
}

/** Upserts a rate. Used by the rate-sync job and by admin overrides. */
export async function upsertGoldRate(rate: {
  countryId: number | null;
  cityId: number | null;
  currency: string;
  metal: string;
  karat: number;
  ratePerGram: number;
  buyRate?: number | null;
  sellRate?: number | null;
  source: string;
}): Promise<void> {
  if (rate.ratePerGram <= 0) throw badRequest('Rate must be greater than zero');

  const previous = await queryOne<Row>(
    `SELECT rate_per_gram FROM gold_rates
      WHERE (country_id = ? OR (? IS NULL AND country_id IS NULL))
        AND (city_id = ? OR (? IS NULL AND city_id IS NULL))
        AND currency = ? AND metal = ? AND karat = ?`,
    [rate.countryId, rate.countryId, rate.cityId, rate.cityId, rate.currency, rate.metal, rate.karat],
  );
  const previousRate = toNumber(previous?.rate_per_gram);
  const changeAmount = previousRate === null ? null : round(rate.ratePerGram - previousRate, 4);
  const changePercent = previousRate && previousRate > 0 ? round(((rate.ratePerGram - previousRate) / previousRate) * 100, 3) : null;

  await execute(
    `INSERT INTO gold_rates
       (country_id, city_id, currency, metal, karat, rate_per_gram, rate_per_tola, rate_per_ounce,
        rate_per_10g, buy_rate, sell_rate, change_amount, change_percent, source, as_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       rate_per_gram = VALUES(rate_per_gram), rate_per_tola = VALUES(rate_per_tola),
       rate_per_ounce = VALUES(rate_per_ounce), rate_per_10g = VALUES(rate_per_10g),
       buy_rate = VALUES(buy_rate), sell_rate = VALUES(sell_rate),
       change_amount = VALUES(change_amount), change_percent = VALUES(change_percent),
       source = VALUES(source), as_of = CURRENT_TIMESTAMP`,
    [
      rate.countryId,
      rate.cityId,
      rate.currency,
      rate.metal,
      rate.karat,
      rate.ratePerGram,
      mulDecimal(rate.ratePerGram, GRAMS_PER_TOLA, 4),
      mulDecimal(rate.ratePerGram, GRAMS_PER_TROY_OUNCE, 4),
      mulDecimal(rate.ratePerGram, 10, 4),
      rate.buyRate ?? null,
      rate.sellRate ?? null,
      changeAmount,
      changePercent,
      rate.source,
    ],
  );

  await execute(
    `INSERT INTO gold_rate_history (country_id, currency, metal, karat, rate_per_gram, close_rate, source, as_of_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_DATE)
     ON DUPLICATE KEY UPDATE
       rate_per_gram = VALUES(rate_per_gram),
       close_rate = VALUES(close_rate),
       high_rate = GREATEST(COALESCE(high_rate, VALUES(rate_per_gram)), VALUES(rate_per_gram)),
       low_rate  = LEAST(COALESCE(low_rate, VALUES(rate_per_gram)), VALUES(rate_per_gram))`,
    [rate.countryId, rate.currency, rate.metal, rate.karat, rate.ratePerGram, rate.ratePerGram, rate.source],
  );

  await cache.delPrefix('gold:rates:');
  await cache.del(cacheKeys.goldRate(rate.countryId, rate.currency, rate.karat));
}

export const getPurityStandards = () =>
  remember('gold:purity-standards', 3600, async () => {
    const rows = await queryRows<Row>('SELECT * FROM gold_purity_standards ORDER BY karat DESC');
    return rows.map((row) => ({
      karat: toNumber(row.karat) ?? 0,
      fineness: Number(row.fineness),
      purityPercent: toNumber(row.purity_percent) ?? 0,
      label: String(row.label),
      commonRegions: row.common_regions ?? null,
    }));
  });

const round = (value: number, decimals = 2): number => Number(value.toFixed(decimals));
