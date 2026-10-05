import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { remember } from '../../config/cache';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { uuid } from '../../core/security/crypto';
import { loggerFor } from '../../config/logger';
import { dealRatingFor } from './vehicles.rules';

const log = loggerFor('vehicles');

const round = (value: number, decimals = 2): number => Number(value.toFixed(decimals));

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted[mid - 1] ?? 0;
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/* -------------------------------------------------------------------------- */
/* Make / model / variant catalogue                                           */
/* -------------------------------------------------------------------------- */

export interface VehicleMake {
  id: number;
  name: string;
  slug: string;
  logoUrl: string | null;
  countryId: number | null;
  vehicleTypes: unknown;
  isPopular: boolean;
}

export const listMakes = (params: { vehicleType?: string | null; popularOnly?: boolean } = {}): Promise<VehicleMake[]> =>
  remember(`vehicles:makes:${params.vehicleType ?? 'all'}:${params.popularOnly ? 'popular' : 'all'}`, 3600, async () => {
    const rows = await queryRows<Row>(
      `SELECT id, name, slug, logo_url, country_id, vehicle_types, is_popular
         FROM vehicle_makes
        WHERE is_active = 1
          AND (? IS NULL OR vehicle_types IS NULL OR JSON_CONTAINS(vehicle_types, JSON_QUOTE(?)))
          AND (? = 0 OR is_popular = 1)
        ORDER BY is_popular DESC, sort_order, name`,
      [params.vehicleType ?? null, params.vehicleType ?? '', params.popularOnly ? 1 : 0],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      slug: String(row.slug),
      logoUrl: row.logo_url as string | null,
      countryId: row.country_id === null ? null : Number(row.country_id),
      vehicleTypes: row.vehicle_types ?? null,
      isPopular: row.is_popular === 1,
    }));
  });

export interface VehicleModel {
  id: number;
  makeId: number;
  name: string;
  slug: string;
  vehicleType: string;
  bodyType: string | null;
  segment: string | null;
  productionStart: number | null;
  productionEnd: number | null;
  isPopular: boolean;
}

export const listModels = (makeId: number, vehicleType?: string | null): Promise<VehicleModel[]> =>
  remember(`vehicles:models:${makeId}:${vehicleType ?? 'all'}`, 3600, async () => {
    const rows = await queryRows<Row>(
      `SELECT id, make_id, name, slug, vehicle_type, body_type, segment,
              production_start, production_end, is_popular
         FROM vehicle_models
        WHERE make_id = ? AND is_active = 1 AND (? IS NULL OR vehicle_type = ?)
        ORDER BY is_popular DESC, name`,
      [makeId, vehicleType ?? null, vehicleType ?? null],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      makeId: Number(row.make_id),
      name: String(row.name),
      slug: String(row.slug),
      vehicleType: String(row.vehicle_type),
      bodyType: row.body_type as string | null,
      segment: row.segment as string | null,
      productionStart: row.production_start === null ? null : Number(row.production_start),
      productionEnd: row.production_end === null ? null : Number(row.production_end),
      isPopular: row.is_popular === 1,
    }));
  });

/**
 * The full reference spec sheet.
 *
 * Every column is returned rather than a curated subset, because the compare
 * screen (spec lines 1–2) renders variant specs side by side and any field it
 * cannot find becomes a blank row in the table.
 */
export interface VehicleVariant {
  id: number;
  modelId: number;
  name: string;
  slug: string;
  yearFrom: number | null;
  yearTo: number | null;
  engineCc: number | null;
  engineType: string | null;
  cylinders: number | null;
  powerHp: number | null;
  torqueNm: number | null;
  fuelType: string | null;
  transmission: string | null;
  drivetrain: string | null;
  seats: number | null;
  doors: number | null;
  mileageCity: number | null;
  mileageHighway: number | null;
  fuelTankL: number | null;
  batteryKwh: number | null;
  rangeKm: number | null;
  topSpeedKmh: number | null;
  acceleration0100: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  wheelbaseMm: number | null;
  groundClearanceMm: number | null;
  kerbWeightKg: number | null;
  bootSpaceL: number | null;
  payloadKg: number | null;
  towingKg: number | null;
  airbags: number | null;
  safetyRating: number | null;
  launchPrice: number | null;
  launchCurrency: string | null;
  specSheet: unknown;
}

const mapVariant = (row: Row): VehicleVariant => ({
  id: Number(row.id),
  modelId: Number(row.model_id),
  name: String(row.name),
  slug: String(row.slug),
  yearFrom: toNumber(row.year_from),
  yearTo: toNumber(row.year_to),
  engineCc: toNumber(row.engine_cc),
  engineType: row.engine_type as string | null,
  cylinders: toNumber(row.cylinders),
  powerHp: toNumber(row.power_hp),
  torqueNm: toNumber(row.torque_nm),
  fuelType: row.fuel_type as string | null,
  transmission: row.transmission as string | null,
  drivetrain: row.drivetrain as string | null,
  seats: toNumber(row.seats),
  doors: toNumber(row.doors),
  mileageCity: toNumber(row.mileage_city),
  mileageHighway: toNumber(row.mileage_highway),
  fuelTankL: toNumber(row.fuel_tank_l),
  batteryKwh: toNumber(row.battery_kwh),
  rangeKm: toNumber(row.range_km),
  topSpeedKmh: toNumber(row.top_speed_kmh),
  acceleration0100: toNumber(row.acceleration_0_100),
  lengthMm: toNumber(row.length_mm),
  widthMm: toNumber(row.width_mm),
  heightMm: toNumber(row.height_mm),
  wheelbaseMm: toNumber(row.wheelbase_mm),
  groundClearanceMm: toNumber(row.ground_clearance_mm),
  kerbWeightKg: toNumber(row.kerb_weight_kg),
  bootSpaceL: toNumber(row.boot_space_l),
  payloadKg: toNumber(row.payload_kg),
  towingKg: toNumber(row.towing_kg),
  airbags: toNumber(row.airbags),
  safetyRating: toNumber(row.safety_rating),
  launchPrice: toNumber(row.launch_price),
  launchCurrency: row.launch_currency as string | null,
  specSheet: row.spec_sheet ?? null,
});

export const listVariants = (modelId: number, year?: number | null): Promise<VehicleVariant[]> =>
  remember(`vehicles:variants:${modelId}:${year ?? 'all'}`, 3600, async () => {
    const rows = await queryRows<Row>(
      `SELECT * FROM vehicle_variants
        WHERE model_id = ? AND is_active = 1
          AND (? IS NULL OR ((year_from IS NULL OR year_from <= ?) AND (year_to IS NULL OR year_to >= ?)))
        ORDER BY year_from DESC, name`,
      [modelId, year ?? null, year ?? null, year ?? null],
    );
    return rows.map(mapVariant);
  });

export async function getVariant(variantId: number): Promise<VehicleVariant> {
  const row = await queryOne<Row>('SELECT * FROM vehicle_variants WHERE id = ?', [variantId]);
  if (!row) throw notFound('Vehicle variant');
  return mapVariant(row);
}

/* -------------------------------------------------------------------------- */
/* Market price index                                                         */
/* -------------------------------------------------------------------------- */

export interface VehiclePriceIndex {
  countryId: number;
  cityId: number | null;
  makeId: number;
  modelId: number | null;
  variantId: number | null;
  year: number | null;
  currency: string;
  avgPrice: number | null;
  medianPrice: number | null;
  p25Price: number | null;
  p75Price: number | null;
  avgMileageKm: number | null;
  sampleSize: number;
  momChangePct: number | null;
  yoyChangePct: number | null;
  avgDaysToSell: number | null;
  periodEnd: string;
}

const mapIndex = (row: Row): VehiclePriceIndex => ({
  countryId: Number(row.country_id),
  cityId: row.city_id === null ? null : Number(row.city_id),
  makeId: Number(row.make_id),
  modelId: row.model_id === null ? null : Number(row.model_id),
  variantId: row.variant_id === null ? null : Number(row.variant_id),
  year: row.year === null ? null : Number(row.year),
  currency: String(row.currency),
  avgPrice: toNumber(row.avg_price),
  medianPrice: toNumber(row.median_price),
  p25Price: toNumber(row.p25_price),
  p75Price: toNumber(row.p75_price),
  avgMileageKm: toNumber(row.avg_mileage_km),
  sampleSize: Number(row.sample_size ?? 0),
  momChangePct: toNumber(row.mom_change_pct),
  yoyChangePct: toNumber(row.yoy_change_pct),
  avgDaysToSell: row.avg_days_to_sell === null ? null : Number(row.avg_days_to_sell),
  periodEnd: (row.period_end as Date).toISOString().slice(0, 10),
});

/**
 * Falls back variant → model → make and city → country. A rare trim with no
 * index of its own is still better served by its model's numbers than by nothing.
 */
export async function getVehiclePriceIndex(params: {
  countryId: number | null;
  cityId?: number | null;
  makeId: number;
  modelId?: number | null;
  variantId?: number | null;
  year?: number | null;
  currency: string;
}): Promise<VehiclePriceIndex | null> {
  if (!params.countryId) return null;

  const row = await queryOne<Row>(
    `SELECT * FROM vehicle_price_index
      WHERE country_id = ?
        AND make_id = ?
        AND currency = ?
        AND (model_id IS NULL OR model_id = ?)
        AND (variant_id IS NULL OR variant_id = ?)
        AND (year IS NULL OR year = ?)
        AND (city_id IS NULL OR city_id = ?)
      ORDER BY (variant_id IS NULL), (model_id IS NULL), (year IS NULL), (city_id IS NULL), period_end DESC
      LIMIT 1`,
    [
      params.countryId,
      params.makeId,
      params.currency,
      params.modelId ?? null,
      params.variantId ?? null,
      params.year ?? null,
      params.cityId ?? null,
    ],
  );

  return row ? mapIndex(row) : null;
}

/* -------------------------------------------------------------------------- */
/* §18 Vehicle Price Estimation                                               */
/* -------------------------------------------------------------------------- */

export interface VehicleEstimateInput {
  listingId?: number | null;
  requestedBy?: number | null;
  countryId: number | null;
  cityId?: number | null;
  makeId: number;
  modelId?: number | null;
  variantId?: number | null;
  year: number;
  mileageKm?: number | null;
  conditionGrade?: string | null;
  accidentHistory?: string | null;
  ownersCount?: number | null;
  inspectionScore?: number | null;
  registrationStatus?: string | null;
  askingPrice?: number | null;
  currency: string;
}

export interface VehicleEstimateComparable {
  listingId: number;
  price: number;
  year: number | null;
  mileageKm: number | null;
}

export interface VehicleEstimate {
  uuid: string;
  currency: string;
  valueLow: number;
  valueMid: number;
  valueHigh: number;
  confidence: number;
  method: 'comparable' | 'index' | 'depreciation';
  adjustments: Array<{ code: string; label: string; percent: number }>;
  comparables: VehicleEstimateComparable[];
  sampleSize: number;
  explanation: string;
  dealRating: 'great' | 'good' | 'fair' | 'high' | 'overpriced' | null;
  priceVsEstimatePct: number | null;
}

const MIN_COMPARABLES = 5;
const YEAR_TOLERANCE = 2;
const MILEAGE_TOLERANCE = 0.4;

const CONDITION_ADJUSTMENT: Record<string, number> = {
  excellent: 6,
  very_good: 3,
  good: 0,
  fair: -8,
  poor: -18,
  salvage: -40,
};

const ACCIDENT_ADJUSTMENT: Record<string, number> = { minor: -5, major: -15 };

/** Typical annual distance, used as the mileage baseline when there is no real sample. */
const EXPECTED_KM_PER_YEAR = 15_000;

/**
 * Builds the condition deltas shared by all three strategies.
 *
 * The same physical facts move the price the same way whether the baseline came
 * from live comparables, the index or a depreciation curve, so the adjustment
 * set is computed once and reused.
 */
function buildAdjustments(
  input: VehicleEstimateInput,
  baselineMileageKm: number | null,
): Array<{ code: string; label: string; percent: number }> {
  const adjustments: Array<{ code: string; label: string; percent: number }> = [];

  if (input.mileageKm != null && baselineMileageKm != null && baselineMileageKm > 0) {
    const deltaKm = input.mileageKm - baselineMileageKm;
    const percent = clamp((-deltaKm / 10_000) * 0.8, -20, 20);
    if (Math.abs(percent) >= 0.1) {
      adjustments.push({
        code: 'mileage',
        label: `${Math.abs(Math.round(deltaKm)).toLocaleString('en-US')} km ${deltaKm > 0 ? 'above' : 'below'} the comparable average`,
        percent: round(percent, 2),
      });
    }
  }

  const condition = input.conditionGrade ? CONDITION_ADJUSTMENT[input.conditionGrade] : undefined;
  if (condition !== undefined && condition !== 0) {
    adjustments.push({ code: 'condition', label: `Condition: ${input.conditionGrade?.replace(/_/g, ' ')}`, percent: condition });
  }

  const accident = input.accidentHistory ? ACCIDENT_ADJUSTMENT[input.accidentHistory] : undefined;
  if (accident !== undefined) {
    adjustments.push({ code: 'accident', label: `${input.accidentHistory} accident history`, percent: accident });
  }

  if (input.ownersCount != null && input.ownersCount > 1) {
    adjustments.push({
      code: 'owners',
      label: `${input.ownersCount} previous owners`,
      percent: Math.max(-10, -2 * (input.ownersCount - 1)),
    });
  }

  if (input.inspectionScore != null && input.inspectionScore >= 85) {
    adjustments.push({ code: 'inspection', label: `Inspection score ${round(input.inspectionScore, 0)}`, percent: 4 });
  }

  if (input.registrationStatus === 'unregistered') {
    adjustments.push({ code: 'registration', label: 'Unregistered', percent: -4 });
  }

  return adjustments;
}

const applyAdjustments = (base: number, adjustments: Array<{ percent: number }>): number =>
  base * (1 + adjustments.reduce((sum, adjustment) => sum + adjustment.percent, 0) / 100);

export async function estimateVehiclePrice(input: VehicleEstimateInput): Promise<VehicleEstimate> {
  const estimate =
    (await estimateFromComparables(input)) ??
    (await estimateFromIndex(input)) ??
    (await estimateFromDepreciation(input));

  if (!estimate) {
    throw notFound('Enough market data to price this vehicle');
  }

  // Only meaningful when the caller told us what is being asked for the vehicle.
  if (input.askingPrice && input.askingPrice > 0 && estimate.valueMid > 0) {
    estimate.priceVsEstimatePct = round(((input.askingPrice - estimate.valueMid) / estimate.valueMid) * 100, 3);
    estimate.dealRating = dealRatingFor(estimate.priceVsEstimatePct);
  }

  await persistEstimate(input, estimate).catch((error) =>
    log.warn({ err: error, listingId: input.listingId }, 'could not persist vehicle price estimate'),
  );

  return estimate;
}

async function estimateFromComparables(input: VehicleEstimateInput): Promise<VehicleEstimate | null> {
  if (!input.modelId) return null;

  const mileageBounds =
    input.mileageKm != null && input.mileageKm > 0
      ? [Math.round(input.mileageKm * (1 - MILEAGE_TOLERANCE)), Math.round(input.mileageKm * (1 + MILEAGE_TOLERANCE))]
      : null;

  const rows = await queryRows<Row>(
    `SELECT l.id, l.price, vd.year, vd.mileage_km
       FROM listings l
       JOIN vehicle_listing_details vd ON vd.listing_id = l.id
      WHERE l.status = 'published'
        AND l.deleted_at IS NULL
        AND l.currency = ?
        AND l.price > 0
        AND vd.make_id = ?
        AND vd.model_id = ?
        AND vd.year BETWEEN ? AND ?
        AND (? = 0 OR vd.mileage_km BETWEEN ? AND ?)
        AND l.id <> ?
      ORDER BY ABS(vd.year - ?) ASC
      LIMIT 60`,
    [
      input.currency,
      input.makeId,
      input.modelId,
      input.year - YEAR_TOLERANCE,
      input.year + YEAR_TOLERANCE,
      mileageBounds ? 1 : 0,
      mileageBounds?.[0] ?? 0,
      mileageBounds?.[1] ?? 0,
      // A vehicle is never its own comparable; 0 is never a real listing id.
      input.listingId ?? 0,
      input.year,
    ],
  );

  const comparables = rows
    .map((row) => ({
      listingId: Number(row.id),
      price: toNumber(row.price) ?? 0,
      year: row.year === null ? null : Number(row.year),
      mileageKm: row.mileage_km === null ? null : Number(row.mileage_km),
    }))
    .filter((row) => row.price > 0);

  if (comparables.length < MIN_COMPARABLES) return null;

  const prices = comparables.map((row) => row.price);
  const basePrice = median(prices);
  const comparableMileage = comparables
    .map((row) => row.mileageKm)
    .filter((value): value is number => value !== null && value > 0);
  const baselineMileage = comparableMileage.length > 0 ? median(comparableMileage) : null;

  const adjustments = buildAdjustments(input, baselineMileage);
  const valueMid = applyAdjustments(basePrice, adjustments);

  const spread = Math.sqrt(prices.reduce((sum, price) => sum + (price - basePrice) ** 2, 0) / prices.length);
  const dispersion = basePrice > 0 ? Math.min(1, spread / basePrice) : 1;
  const confidence = round(clamp(45 + Math.min(1, comparables.length / 15) * 40 - dispersion * 30, 25, 92), 2);

  return {
    uuid: uuid(),
    currency: input.currency,
    valueLow: round(valueMid * 0.9),
    valueMid: round(valueMid),
    valueHigh: round(valueMid * 1.1),
    confidence,
    method: 'comparable',
    adjustments,
    comparables: comparables.slice(0, 20),
    sampleSize: comparables.length,
    explanation: buildExplanation(
      `Priced from ${comparables.length} published listings of the same model within ${YEAR_TOLERANCE} years of ${input.year}` +
        `${baselineMileage ? ` and around ${Math.round(baselineMileage).toLocaleString('en-US')} km` : ''}. ` +
        `Their median asking price is ${round(basePrice)} ${input.currency}.`,
      adjustments,
    ),
    dealRating: null,
    priceVsEstimatePct: null,
  };
}

async function estimateFromIndex(input: VehicleEstimateInput): Promise<VehicleEstimate | null> {
  const index = await getVehiclePriceIndex({
    countryId: input.countryId,
    cityId: input.cityId ?? null,
    makeId: input.makeId,
    modelId: input.modelId ?? null,
    variantId: input.variantId ?? null,
    year: input.year,
    currency: input.currency,
  });

  const basePrice = index?.medianPrice ?? index?.avgPrice ?? null;
  if (!index || !basePrice || basePrice <= 0) return null;

  // The index is a median for this exact make/model/year, so the same condition
  // deltas that adjust a live comparable set apply to it unchanged.
  const adjustments = buildAdjustments(input, index.avgMileageKm);
  const valueMid = applyAdjustments(basePrice, adjustments);
  const confidence = round(clamp(25 + Math.min(1, index.sampleSize / 200) * 30, 20, 60), 2);

  return {
    uuid: uuid(),
    currency: input.currency,
    valueLow: round(valueMid * 0.9),
    valueMid: round(valueMid),
    valueHigh: round(valueMid * 1.1),
    confidence,
    method: 'index',
    adjustments,
    comparables: [],
    sampleSize: index.sampleSize,
    explanation: buildExplanation(
      `Too few live listings to compare against, so this uses the market price index for this ` +
        `${index.variantId ? 'variant' : index.modelId ? 'model' : 'make'} (${index.sampleSize} listings, period ending ` +
        `${index.periodEnd}): ${round(basePrice)} ${input.currency}.`,
      adjustments,
    ),
    dealRating: null,
    priceVsEstimatePct: null,
  };
}

/**
 * Last resort: depreciate the manufacturer's launch price.
 *
 * The first year takes the largest hit and each later year compounds on the
 * remaining value, which matches how vehicles actually lose money far better
 * than a straight line. The floor exists because no running vehicle is worth
 * nothing — below it, price is driven by scrap and parts value.
 */
async function estimateFromDepreciation(input: VehicleEstimateInput): Promise<VehicleEstimate | null> {
  if (!input.variantId) return null;

  const row = await queryOne<Row>('SELECT launch_price, launch_currency FROM vehicle_variants WHERE id = ?', [input.variantId]);
  const launchPrice = toNumber(row?.launch_price);
  if (!launchPrice || launchPrice <= 0) return null;
  if (row?.launch_currency && String(row.launch_currency) !== input.currency) return null;

  const age = Math.max(0, new Date().getUTCFullYear() - input.year);
  let residual = 1;
  if (age >= 1) {
    residual = 0.82 * 0.9 ** (age - 1);
  }
  const basePrice = Math.max(launchPrice * 0.12, launchPrice * residual);

  const adjustments = buildAdjustments(input, age * EXPECTED_KM_PER_YEAR);
  const valueMid = applyAdjustments(basePrice, adjustments);
  // A curve is a guess about an individual vehicle, and it decays with age.
  const confidence = round(clamp(45 - age * 2, 15, 45), 2);

  return {
    uuid: uuid(),
    currency: input.currency,
    valueLow: round(valueMid * 0.9),
    valueMid: round(valueMid),
    valueHigh: round(valueMid * 1.1),
    confidence,
    method: 'depreciation',
    adjustments,
    comparables: [],
    sampleSize: 0,
    explanation: buildExplanation(
      `No listings or index data were available, so this depreciates the launch price of ${round(launchPrice)} ` +
        `${input.currency} over ${age} year${age === 1 ? '' : 's'} to ${round(basePrice)} ${input.currency}.`,
      adjustments,
    ),
    dealRating: null,
    priceVsEstimatePct: null,
  };
}

const buildExplanation = (base: string, adjustments: Array<{ label: string; percent: number }>): string =>
  adjustments.length === 0
    ? base
    : `${base} Adjusted ${adjustments
        .map((adjustment) => `${adjustment.percent > 0 ? '+' : ''}${adjustment.percent}% for ${adjustment.label.toLowerCase()}`)
        .join(', ')}.`;

async function persistEstimate(input: VehicleEstimateInput, estimate: VehicleEstimate): Promise<void> {
  await execute(
    `INSERT INTO vehicle_price_estimates
       (uuid, listing_id, requested_by, inputs, currency, value_low, value_mid, value_high,
        confidence, method, comparables, explanation, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rules-v1')`,
    [
      estimate.uuid,
      input.listingId ?? null,
      input.requestedBy ?? null,
      JSON.stringify(input),
      estimate.currency,
      estimate.valueLow,
      estimate.valueMid,
      estimate.valueHigh,
      estimate.confidence,
      estimate.method,
      JSON.stringify({ adjustments: estimate.adjustments, listings: estimate.comparables }),
      estimate.explanation,
    ],
  );

  if (input.listingId) {
    await execute(
      `UPDATE vehicle_listing_details
          SET ai_estimate_low = ?, ai_estimate_mid = ?, ai_estimate_high = ?, ai_estimate_at = CURRENT_TIMESTAMP
        WHERE listing_id = ?`,
      [estimate.valueLow, estimate.valueMid, estimate.valueHigh, input.listingId],
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Inspections                                                                */
/* -------------------------------------------------------------------------- */

const SECTION_COLUMNS = [
  ['engineScore', 'engine_score'],
  ['transmissionScore', 'transmission_score'],
  ['suspensionScore', 'suspension_score'],
  ['brakesScore', 'brakes_score'],
  ['electricalScore', 'electrical_score'],
  ['interiorScore', 'interior_score'],
  ['exteriorScore', 'exterior_score'],
  ['acScore', 'ac_score'],
  ['tyresScore', 'tyres_score'],
] as const;

export type InspectionSection = (typeof SECTION_COLUMNS)[number][0];

export type InspectionInput = Partial<Record<InspectionSection, number>> & {
  inspectorId?: number | null;
  inspectorName?: string | null;
  checklist?: unknown;
  findings?: unknown;
  reportUrl?: string | null;
};

export interface Inspection {
  uuid: string;
  listingId: number;
  inspectorName: string | null;
  overallScore: number | null;
  grade: string | null;
  sections: Record<string, number | null>;
  checklist: unknown;
  findings: unknown;
  reportUrl: string | null;
  inspectedAt: string;
}

/** Letter grades so a buyer can read the result without interpreting a number. */
export function gradeFor(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

const mapInspection = (row: Row): Inspection => ({
  uuid: String(row.uuid),
  listingId: Number(row.listing_id),
  inspectorName: row.inspector_name as string | null,
  overallScore: toNumber(row.overall_score),
  grade: row.grade as string | null,
  sections: Object.fromEntries(SECTION_COLUMNS.map(([key, column]) => [key, toNumber(row[column])])),
  checklist: row.checklist ?? null,
  findings: row.findings ?? null,
  reportUrl: row.report_url as string | null,
  inspectedAt: (row.inspected_at as Date).toISOString(),
});

export async function saveInspection(listingId: number, input: InspectionInput & { isStaff?: boolean }): Promise<Inspection> {
  if (!input.isStaff) {
    throw forbidden('Only staff inspectors can submit a vehicle inspection');
  }
  const scores = SECTION_COLUMNS.map(([key]) => input[key]).filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (scores.length === 0) {
    throw badRequest('An inspection needs at least one section score');
  }

  const overall = round(scores.reduce((sum, score) => sum + score, 0) / scores.length, 2);
  const grade = gradeFor(overall);
  const inspectionUuid = uuid();

  await execute(
    `INSERT INTO vehicle_inspections
       (uuid, listing_id, inspector_id, inspector_name, overall_score, grade,
        engine_score, transmission_score, suspension_score, brakes_score, electrical_score,
        interior_score, exterior_score, ac_score, tyres_score, checklist, findings, report_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      inspectionUuid,
      listingId,
      input.inspectorId ?? null,
      input.inspectorName ?? null,
      overall,
      grade,
      input.engineScore ?? null,
      input.transmissionScore ?? null,
      input.suspensionScore ?? null,
      input.brakesScore ?? null,
      input.electricalScore ?? null,
      input.interiorScore ?? null,
      input.exteriorScore ?? null,
      input.acScore ?? null,
      input.tyresScore ?? null,
      input.checklist ? JSON.stringify(input.checklist) : null,
      input.findings ? JSON.stringify(input.findings) : null,
      input.reportUrl ?? null,
    ],
  );

  // The listing row carries the badge and the sortable score, so the feed never
  // has to join the inspection table.
  await execute(
    `UPDATE vehicle_listing_details
        SET is_inspected = 1, inspection_score = ?, inspection_grade = ?,
            inspected_at = CURRENT_TIMESTAMP, inspection_report_url = COALESCE(?, inspection_report_url),
            inspected_by = COALESCE(?, inspected_by)
      WHERE listing_id = ?`,
    [overall, grade, input.reportUrl ?? null, input.inspectorName ?? null, listingId],
  );

  const saved = await getInspection(listingId);
  if (!saved) throw notFound('Inspection');
  return saved;
}

export async function getInspection(listingId: number): Promise<Inspection | null> {
  const row = await queryOne<Row>(
    'SELECT * FROM vehicle_inspections WHERE listing_id = ? ORDER BY inspected_at DESC LIMIT 1',
    [listingId],
  );
  return row ? mapInspection(row) : null;
}

/* -------------------------------------------------------------------------- */
/* Feature catalogue                                                          */
/* -------------------------------------------------------------------------- */

export interface FeatureGroup {
  groupCode: string;
  features: Array<{ id: number; code: string; name: string; icon: string | null; isFilterable: boolean; isComparable: boolean }>;
}

export const listFeatures = (vehicleType?: string | null): Promise<FeatureGroup[]> =>
  remember(`vehicles:features:${vehicleType ?? 'all'}`, 3600, async () => {
    const rows = await queryRows<Row>(
      `SELECT id, code, name, icon, group_code, is_filterable, is_comparable
         FROM vehicle_features
        WHERE is_active = 1
          AND (? IS NULL OR applies_to IS NULL OR JSON_CONTAINS(applies_to, JSON_QUOTE(?)))
        ORDER BY group_code, sort_order, name`,
      [vehicleType ?? null, vehicleType ?? ''],
    );

    const groups = new Map<string, FeatureGroup>();
    for (const row of rows) {
      const groupCode = String(row.group_code);
      const group = groups.get(groupCode) ?? { groupCode, features: [] };
      group.features.push({
        id: Number(row.id),
        code: String(row.code),
        name: String(row.name),
        icon: row.icon as string | null,
        isFilterable: row.is_filterable === 1,
        isComparable: row.is_comparable === 1,
      });
      groups.set(groupCode, group);
    }
    return [...groups.values()];
  });
