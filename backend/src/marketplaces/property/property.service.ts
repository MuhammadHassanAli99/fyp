import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { remember } from '../../config/cache';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { uuid } from '../../core/security/crypto';
import { loggerFor } from '../../config/logger';
import { AREA_TO_SQM_NUMBER as AREA_TO_SQM, fromSqm, toSqm } from './property.area';

const log = loggerFor('property');

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
/* Area units                                                                 */
/* -------------------------------------------------------------------------- */

export interface AreaUnitOption {
  code: string;
  name: string;
  symbol: string;
  toSqm: number;
  isDefault: boolean;
}

/**
 * The unit picker on the listing form and the area filter.
 *
 * Which unit a seller thinks in is a property of their country, not of the
 * platform — a Lahore seller enters marla, a Dubai seller sqft — so the
 * country's `area_unit` is returned flagged as the default while every other
 * unit stays selectable.
 */
export async function getAreaUnitsForCountry(countryId: number | null): Promise<{
  defaultUnit: string;
  units: AreaUnitOption[];
}> {
  return remember(`property:area-units:${countryId ?? 'default'}`, 3600, async () => {
    const country = countryId
      ? await queryOne<Row>('SELECT area_unit FROM countries WHERE id = ?', [countryId])
      : null;
    const defaultUnit = (country?.area_unit as string | undefined) ?? 'sqm';

    const rows = await queryRows<Row>(
      `SELECT code, name, symbol, to_base_factor
         FROM measurement_units
        WHERE dimension = 'area' AND is_active = 1
        ORDER BY to_base_factor ASC`,
    );

    // The conversion table in the module is authoritative for maths; the table
    // only supplies names and symbols, so an unseeded database still works.
    const units: AreaUnitOption[] =
      rows.length > 0
        ? rows.map((row) => ({
            code: String(row.code),
            name: String(row.name),
            symbol: String(row.symbol),
            toSqm: AREA_TO_SQM[String(row.code)] ?? toNumber(row.to_base_factor) ?? 1,
            isDefault: String(row.code) === defaultUnit,
          }))
        : Object.entries(AREA_TO_SQM)
            .sort(([, a], [, b]) => a - b)
            .map(([code, factor]) => ({
              code,
              name: code,
              symbol: code,
              toSqm: factor,
              isDefault: code === defaultUnit,
            }));

    return { defaultUnit, units };
  });
}

export function convertArea(value: number, fromUnit: string, toUnit: string): number {
  return round(fromSqm(toSqm(value, fromUnit), toUnit), 4);
}

/* -------------------------------------------------------------------------- */
/* Area price index                                                           */
/* -------------------------------------------------------------------------- */

export interface PropertyPriceIndex {
  countryId: number;
  cityId: number | null;
  areaId: number | null;
  propertyKind: string;
  operation: string;
  currency: string;
  avgPricePerSqm: number | null;
  medianPricePerSqm: number | null;
  p25PricePerSqm: number | null;
  p75PricePerSqm: number | null;
  yoyChangePct: number | null;
  momChangePct: number | null;
  rentalYieldPct: number | null;
  sampleSize: number;
  periodEnd: string;
}

const mapIndex = (row: Row): PropertyPriceIndex => ({
  countryId: Number(row.country_id),
  cityId: row.city_id === null ? null : Number(row.city_id),
  areaId: row.area_id === null ? null : Number(row.area_id),
  propertyKind: String(row.property_kind),
  operation: String(row.operation),
  currency: String(row.currency),
  avgPricePerSqm: toNumber(row.avg_price_per_sqm),
  medianPricePerSqm: toNumber(row.median_price_per_sqm),
  p25PricePerSqm: toNumber(row.p25_price_per_sqm),
  p75PricePerSqm: toNumber(row.p75_price_per_sqm),
  yoyChangePct: toNumber(row.yoy_change_pct),
  momChangePct: toNumber(row.mom_change_pct),
  rentalYieldPct: toNumber(row.rental_yield_pct),
  sampleSize: Number(row.sample_size ?? 0),
  periodEnd: (row.period_end as Date).toISOString().slice(0, 10),
});

/**
 * Reference prices for "is this a fair ask" (§18 Market Analysis).
 *
 * Falls back area → city → country: a neighbourhood we have not indexed yet
 * should still get a city number rather than an empty screen.
 */
export async function getPropertyPriceIndex(params: {
  countryId: number | null;
  cityId?: number | null;
  areaId?: number | null;
  propertyKind: string;
  operation: 'sell' | 'rent';
  currency: string;
}): Promise<PropertyPriceIndex | null> {
  if (!params.countryId) return null;

  const row = await queryOne<Row>(
    `SELECT * FROM property_price_index
      WHERE country_id = ?
        AND property_kind = ?
        AND operation = ?
        AND currency = ?
        AND (area_id IS NULL OR area_id = ?)
        AND (city_id IS NULL OR city_id = ?)
      ORDER BY (area_id IS NULL), (city_id IS NULL), period_end DESC
      LIMIT 1`,
    [params.countryId, params.propertyKind, params.operation, params.currency, params.areaId ?? null, params.cityId ?? null],
  );

  return row ? mapIndex(row) : null;
}

/* -------------------------------------------------------------------------- */
/* §18 Property Valuation                                                     */
/* -------------------------------------------------------------------------- */

export interface PropertyValuationInput {
  listingId?: number | null;
  requestedBy?: number | null;
  countryId: number | null;
  cityId: number;
  areaId?: number | null;
  propertyKind: string;
  operation: 'sell' | 'rent';
  areaValue: number;
  areaUnit: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  furnishing?: string | null;
  yearBuilt?: number | null;
  amenityCount?: number | null;
  currency: string;
}

export interface PropertyValuationComparable {
  listingId: number;
  price: number;
  areaSqm: number;
  pricePerSqm: number;
  weight: number;
}

export interface PropertyValuation {
  uuid: string;
  currency: string;
  areaSqm: number;
  pricePerSqm: number;
  valueLow: number;
  valueMid: number;
  valueHigh: number;
  confidence: number;
  method: 'comparable' | 'index';
  adjustments: Array<{ code: string; label: string; percent: number }>;
  comparables: PropertyValuationComparable[];
  sampleSize: number;
  explanation: string;
}

/** How wide a comparable may differ in size and still be comparable at all. */
const COMPARABLE_AREA_TOLERANCE = 0.35;
const MIN_COMPARABLES = 4;

/**
 * Comparable-based valuation.
 *
 * Every professional valuation in these markets is argued from comparables, so
 * the output is deliberately explainable: which listings were used, what each
 * adjustment was worth, and how confident the sample makes us. A single opaque
 * number would be both less useful and less defensible.
 */
export async function valuateProperty(input: PropertyValuationInput): Promise<PropertyValuation> {
  const areaSqm = round(toSqm(input.areaValue, input.areaUnit), 3);
  if (areaSqm <= 0) {
    throw badRequest('Area must be greater than zero to value a property');
  }

  const rows = await queryRows<Row>(
    `SELECT l.id, l.price, l.area_id, pd.area_sqm, pd.bedrooms, pd.furnishing, pd.year_built
       FROM listings l
       JOIN property_listing_details pd ON pd.listing_id = l.id
      WHERE l.status = 'published'
        AND l.deleted_at IS NULL
        AND l.city_id = ?
        AND l.operation = ?
        AND l.currency = ?
        AND l.price > 0
        AND pd.property_kind = ?
        AND pd.area_sqm BETWEEN ? AND ?
        AND l.id <> ?
      ORDER BY (l.area_id <=> ?) DESC, ABS(pd.area_sqm - ?) ASC
      LIMIT 40`,
    [
      input.cityId,
      input.operation,
      input.currency,
      input.propertyKind,
      round(areaSqm * (1 - COMPARABLE_AREA_TOLERANCE), 3),
      round(areaSqm * (1 + COMPARABLE_AREA_TOLERANCE), 3),
      // A property is never its own comparable; 0 is never a real listing id.
      input.listingId ?? 0,
      input.areaId ?? null,
      areaSqm,
    ],
  );

  const comparableRows = rows
    .map((row) => ({
      listingId: Number(row.id),
      price: toNumber(row.price) ?? 0,
      areaSqm: toNumber(row.area_sqm) ?? 0,
      bedrooms: row.bedrooms === null ? null : Number(row.bedrooms),
      furnishing: row.furnishing as string | null,
      yearBuilt: row.year_built === null ? null : Number(row.year_built),
      sameArea: input.areaId != null && Number(row.area_id) === input.areaId,
    }))
    .filter((row) => row.areaSqm > 0 && row.price > 0);

  const valuation =
    comparableRows.length >= MIN_COMPARABLES
      ? valueFromComparables(input, areaSqm, comparableRows)
      : await valueFromIndex(input, areaSqm);

  await persistValuation(input, valuation).catch((error) =>
    log.warn({ err: error, listingId: input.listingId }, 'could not persist property valuation'),
  );

  return valuation;
}

interface ComparableRow {
  listingId: number;
  price: number;
  areaSqm: number;
  bedrooms: number | null;
  furnishing: string | null;
  yearBuilt: number | null;
  sameArea: boolean;
}

function valueFromComparables(
  input: PropertyValuationInput,
  areaSqm: number,
  rows: ComparableRow[],
): PropertyValuation {
  const rates = rows.map((row) => row.price / row.areaSqm);
  const baseRate = median(rates);
  const adjustments: PropertyValuation['adjustments'] = [];

  // Bedrooms: the subject is compared against what the sample typically offers,
  // not against an absolute, so a 2-bed area is not penalised for being a 2-bed area.
  const comparableBedrooms = rows.map((row) => row.bedrooms).filter((value): value is number => value !== null);
  if (input.bedrooms != null && comparableBedrooms.length > 0) {
    const delta = input.bedrooms - median(comparableBedrooms);
    const percent = clamp(delta * 3, -15, 15);
    if (percent !== 0) adjustments.push({ code: 'bedrooms', label: `${delta > 0 ? '+' : ''}${delta} bedrooms vs comparables`, percent: round(percent, 2) });
  }

  if (input.furnishing === 'furnished' || input.furnishing === 'fully_furnished') {
    adjustments.push({ code: 'furnishing', label: 'Furnished', percent: 6 });
  } else if (input.furnishing === 'semi_furnished') {
    adjustments.push({ code: 'furnishing', label: 'Semi furnished', percent: 3 });
  }

  // Buildings depreciate slowly and then plateau — beyond a quarter off, price
  // is driven by the land, which the comparables already price in.
  if (input.yearBuilt != null) {
    const age = Math.max(0, new Date().getUTCFullYear() - input.yearBuilt);
    if (age > 5) {
      const percent = Math.max(-25, -0.6 * (age - 5));
      adjustments.push({ code: 'age', label: `${age} years old`, percent: round(percent, 2) });
    }
  }

  if (input.amenityCount && input.amenityCount > 0) {
    const percent = Math.min(8, input.amenityCount * 0.5);
    adjustments.push({ code: 'amenities', label: `${input.amenityCount} amenities`, percent: round(percent, 2) });
  }

  const totalAdjustment = adjustments.reduce((sum, adjustment) => sum + adjustment.percent, 0);
  const adjustedRate = baseRate * (1 + totalAdjustment / 100);
  const valueMid = adjustedRate * areaSqm;

  const spread = Math.sqrt(rates.reduce((sum, rate) => sum + (rate - baseRate) ** 2, 0) / rates.length);
  const dispersion = baseRate > 0 ? Math.min(1, spread / baseRate) : 1;
  const confidence = round(clamp(35 + Math.min(1, rows.length / 20) * 45 - dispersion * 35, 20, 95), 2);

  const weights = rows.map((row) => 1 / (1 + Math.abs(row.areaSqm - areaSqm) / areaSqm));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const comparables: PropertyValuationComparable[] = rows.map((row, index) => ({
    listingId: row.listingId,
    price: round(row.price),
    areaSqm: row.areaSqm,
    pricePerSqm: round(row.price / row.areaSqm, 2),
    weight: round((weights[index] ?? 0) / weightTotal, 4),
  }));

  const sameAreaCount = rows.filter((row) => row.sameArea).length;
  const adjustmentText =
    adjustments.length > 0
      ? ` Adjusted ${adjustments.map((a) => `${a.percent > 0 ? '+' : ''}${a.percent}% for ${a.label.toLowerCase()}`).join(', ')}.`
      : '';
  const explanation =
    `Valued from ${rows.length} published ${input.propertyKind.replace(/_/g, ' ')} listings in the same city` +
    `${sameAreaCount > 0 ? ` (${sameAreaCount} in the same neighbourhood)` : ''}, sized within ` +
    `${Math.round(COMPARABLE_AREA_TOLERANCE * 100)}% of ${areaSqm} m². Their median asking price is ` +
    `${round(baseRate)} ${input.currency} per m².${adjustmentText}`;

  return {
    uuid: uuid(),
    currency: input.currency,
    areaSqm,
    pricePerSqm: round(adjustedRate, 2),
    valueLow: round(valueMid * 0.88),
    valueMid: round(valueMid),
    valueHigh: round(valueMid * 1.12),
    confidence,
    method: 'comparable',
    adjustments,
    comparables,
    sampleSize: rows.length,
    explanation,
  };
}

async function valueFromIndex(input: PropertyValuationInput, areaSqm: number): Promise<PropertyValuation> {
  const index = await getPropertyPriceIndex({
    countryId: input.countryId,
    cityId: input.cityId,
    areaId: input.areaId ?? null,
    propertyKind: input.propertyKind,
    operation: input.operation,
    currency: input.currency,
  });

  const rate = index?.medianPricePerSqm ?? index?.avgPricePerSqm ?? null;
  if (!index || !rate || rate <= 0) {
    throw notFound('Enough market data to value this property');
  }

  const valueMid = rate * areaSqm;
  // An index is a coarser instrument than real comparables, and it gets coarser
  // the smaller the sample behind it.
  const confidence = round(clamp(25 + Math.min(1, index.sampleSize / 200) * 30, 20, 60), 2);

  return {
    uuid: uuid(),
    currency: input.currency,
    areaSqm,
    pricePerSqm: round(rate, 2),
    valueLow: round(valueMid * 0.88),
    valueMid: round(valueMid),
    valueHigh: round(valueMid * 1.12),
    confidence,
    method: 'index',
    adjustments: [],
    comparables: [],
    sampleSize: index.sampleSize,
    explanation:
      `No close comparable listings were on the market, so this uses the ${index.areaId ? 'neighbourhood' : index.cityId ? 'city' : 'country'} ` +
      `price index for ${input.propertyKind.replace(/_/g, ' ')} (${index.sampleSize} listings, period ending ${index.periodEnd}): ` +
      `${round(rate)} ${input.currency} per m².`,
  };
}

async function persistValuation(input: PropertyValuationInput, valuation: PropertyValuation): Promise<void> {
  await execute(
    `INSERT INTO property_valuations
       (uuid, listing_id, requested_by, inputs, currency, value_low, value_mid, value_high,
        confidence, method, comparables, explanation, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'comparable-v1')`,
    [
      valuation.uuid,
      input.listingId ?? null,
      input.requestedBy ?? null,
      JSON.stringify({ ...input, areaSqm: valuation.areaSqm }),
      valuation.currency,
      valuation.valueLow,
      valuation.valueMid,
      valuation.valueHigh,
      valuation.confidence,
      valuation.method,
      JSON.stringify({ adjustments: valuation.adjustments, listings: valuation.comparables }),
      valuation.explanation,
    ],
  );

  if (input.listingId) {
    await execute(
      `UPDATE property_listing_details
          SET ai_valuation_low = ?, ai_valuation_mid = ?, ai_valuation_high = ?, ai_valuation_at = CURRENT_TIMESTAMP
        WHERE listing_id = ?`,
      [valuation.valueLow, valuation.valueMid, valuation.valueHigh, input.listingId],
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Nearby places (§11)                                                        */
/* -------------------------------------------------------------------------- */

export interface NearbyPlace {
  id: number;
  placeType: string;
  name: string | null;
  distanceM: number | null;
  walkMinutes: number | null;
  driveMinutes: number | null;
}

export async function getNearbyPlaces(listingId: number): Promise<NearbyPlace[]> {
  const rows = await queryRows<Row>(
    `SELECT id, place_type, name, distance_m, walk_minutes, drive_minutes
       FROM property_nearby_places
      WHERE listing_id = ?
      ORDER BY distance_m IS NULL, distance_m ASC`,
    [listingId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    placeType: String(row.place_type),
    name: row.name as string | null,
    distanceM: row.distance_m === null ? null : Number(row.distance_m),
    walkMinutes: row.walk_minutes === null ? null : Number(row.walk_minutes),
    driveMinutes: row.drive_minutes === null ? null : Number(row.drive_minutes),
  }));
}

/* -------------------------------------------------------------------------- */
/* Viewings                                                                   */
/* -------------------------------------------------------------------------- */

export type ViewingStatus = 'requested' | 'confirmed' | 'rescheduled' | 'completed' | 'cancelled' | 'no_show';

export interface Viewing {
  id: number;
  listingId: number;
  listingTitle: string | null;
  visitorId: number;
  agentId: number | null;
  scheduledAt: string;
  durationMin: number;
  mode: string;
  status: ViewingStatus;
  notes: string | null;
  createdAt: string;
}

const mapViewing = (row: Row): Viewing => ({
  id: Number(row.id),
  listingId: Number(row.listing_id),
  listingTitle: (row.listing_title as string | null) ?? null,
  visitorId: Number(row.visitor_id),
  agentId: row.agent_id === null ? null : Number(row.agent_id),
  scheduledAt: (row.scheduled_at as Date).toISOString(),
  durationMin: Number(row.duration_min),
  mode: String(row.mode),
  status: row.status as ViewingStatus,
  notes: row.notes as string | null,
  createdAt: (row.created_at as Date).toISOString(),
});

export interface ViewingRequest {
  scheduledAt: string;
  durationMin?: number;
  mode?: 'in_person' | 'video_call' | 'virtual_tour';
  notes?: string | null;
}

export async function requestViewing(listingId: number, visitorId: number, input: ViewingRequest): Promise<Viewing> {
  const listing = await queryOne<Row>(
    'SELECT id, user_id, status FROM listings WHERE id = ? AND deleted_at IS NULL',
    [listingId],
  );
  if (!listing) throw notFound('Listing');
  if (Number(listing.user_id) === visitorId) {
    throw badRequest('You cannot book a viewing on your own listing');
  }

  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw badRequest('Provide a valid viewing date and time');
  }
  if (scheduledAt.getTime() <= Date.now()) {
    throw badRequest('Viewings can only be scheduled in the future');
  }

  const id = await insertAndGetId(
    `INSERT INTO property_viewings (listing_id, visitor_id, scheduled_at, duration_min, mode, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      listingId,
      visitorId,
      scheduledAt.toISOString().slice(0, 19).replace('T', ' '),
      input.durationMin ?? 30,
      input.mode ?? 'in_person',
      input.notes ?? null,
    ],
  );

  const created = await loadViewing(id);
  if (!created) throw notFound('Viewing');
  return created;
}

const loadViewing = async (id: number): Promise<Viewing | null> => {
  const row = await queryOne<Row>(
    `SELECT v.*, l.title AS listing_title, l.user_id AS owner_id
       FROM property_viewings v
       JOIN listings l ON l.id = v.listing_id
      WHERE v.id = ?`,
    [id],
  );
  return row ? mapViewing(row) : null;
};

export async function listViewings(params: {
  userId: number;
  role: 'visitor' | 'owner';
  status?: ViewingStatus | null;
}): Promise<Viewing[]> {
  const rows = await queryRows<Row>(
    `SELECT v.*, l.title AS listing_title
       FROM property_viewings v
       JOIN listings l ON l.id = v.listing_id
      WHERE ${params.role === 'owner' ? 'l.user_id = ?' : 'v.visitor_id = ?'}
        AND (? IS NULL OR v.status = ?)
      ORDER BY v.scheduled_at DESC
      LIMIT 200`,
    [params.userId, params.status ?? null, params.status ?? null],
  );
  return rows.map(mapViewing);
}

/** Visitors may only walk away from their own request; the owner drives the rest. */
const VISITOR_ALLOWED_STATUSES: ViewingStatus[] = ['cancelled', 'rescheduled'];

export async function updateViewingStatus(
  id: number,
  userId: number,
  input: { status: ViewingStatus; notes?: string | null },
): Promise<Viewing> {
  const row = await queryOne<Row>(
    `SELECT v.id, v.visitor_id, l.user_id AS owner_id
       FROM property_viewings v
       JOIN listings l ON l.id = v.listing_id
      WHERE v.id = ?`,
    [id],
  );
  if (!row) throw notFound('Viewing');

  const isVisitor = Number(row.visitor_id) === userId;
  const isOwner = Number(row.owner_id) === userId;
  if (!isVisitor && !isOwner) throw forbidden('This viewing does not belong to you');
  if (isVisitor && !isOwner && !VISITOR_ALLOWED_STATUSES.includes(input.status)) {
    throw forbidden(`Only the listing owner can mark a viewing as "${input.status}"`);
  }

  await execute(
    'UPDATE property_viewings SET status = ?, notes = COALESCE(?, notes) WHERE id = ?',
    [input.status, input.notes ?? null, id],
  );

  const updated = await loadViewing(id);
  if (!updated) throw notFound('Viewing');
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Amenity catalogue                                                          */
/* -------------------------------------------------------------------------- */

export interface AmenityGroup {
  groupCode: string;
  amenities: Array<{ id: number; code: string; name: string; icon: string | null; appliesTo: unknown; isFilterable: boolean }>;
}

export const listAmenities = (): Promise<AmenityGroup[]> =>
  remember('property:amenities', 3600, async () => {
    const rows = await queryRows<Row>(
      `SELECT id, code, name, icon, group_code, applies_to, is_filterable
         FROM property_amenities
        WHERE is_active = 1
        ORDER BY group_code, sort_order, name`,
    );

    const groups = new Map<string, AmenityGroup>();
    for (const row of rows) {
      const groupCode = String(row.group_code);
      const group = groups.get(groupCode) ?? { groupCode, amenities: [] };
      group.amenities.push({
        id: Number(row.id),
        code: String(row.code),
        name: String(row.name),
        icon: row.icon as string | null,
        appliesTo: row.applies_to ?? null,
        isFilterable: row.is_filterable === 1,
      });
      groups.set(groupCode, group);
    }
    return [...groups.values()];
  });
