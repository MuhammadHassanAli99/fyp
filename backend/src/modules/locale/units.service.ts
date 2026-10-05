import { queryOne, queryRows, type Row } from '../../db/query';
import { remember } from '../../config/cache';
import { toNumber } from '../../db/sql';
import { badRequest } from '../../core/errors';

/**
 * Canonical measurement conversion.
 *
 * Database stores canonical units (sqm / gram / metre / litre). Display units
 * are derived here. Never persist a converted display value as the source of truth.
 */

export type UnitDimension = 'area' | 'weight' | 'distance' | 'volume';

export interface MeasurementUnit {
  code: string;
  dimension: UnitDimension;
  name: string;
  symbol: string;
  toBaseFactor: number;
}

const CANONICAL: Record<UnitDimension, string> = {
  area: 'sqm',
  weight: 'gram',
  distance: 'm',
  volume: 'l',
};

const ALIASES: Record<string, string> = {
  g: 'gram',
  grams: 'gram',
  kilogram: 'kg',
  kilograms: 'kg',
  oz: 'ounce',
  ozt: 'troy_ounce',
  troy: 'troy_ounce',
  lb: 'pound',
  lbs: 'pound',
  km: 'km',
  kilometre: 'km',
  kilometer: 'km',
  mile: 'mi',
  miles: 'mi',
  metre: 'm',
  meter: 'm',
  sq_m: 'sqm',
  sq_ft: 'sqft',
  sq_yd: 'sqyd',
  liter: 'l',
  litre: 'l',
  liters: 'l',
  gallons: 'gal',
  gallon: 'gal',
};

export const listUnits = (dimension?: UnitDimension) =>
  remember(`ref:units:svc:${dimension ?? 'all'}`, 3600, async () => {
    const rows = await queryRows<Row>(
      dimension
        ? `SELECT code, dimension, name, symbol, to_base_factor
             FROM measurement_units WHERE is_active = 1 AND dimension = ?
            ORDER BY dimension, to_base_factor`
        : `SELECT code, dimension, name, symbol, to_base_factor
             FROM measurement_units WHERE is_active = 1
            ORDER BY dimension, to_base_factor`,
      dimension ? [dimension] : [],
    );
    return rows.map(mapUnit);
  });

export const getUnit = async (code: string): Promise<MeasurementUnit | null> => {
  const normalized = normalizeUnitCode(code);
  const units = await listUnits();
  return units.find((unit) => unit.code === normalized) ?? null;
};

export function normalizeUnitCode(code: string): string {
  const raw = code.trim().toLowerCase().replace(/\s+/g, '_');
  return ALIASES[raw] ?? raw;
}

export function canonicalUnit(dimension: UnitDimension): string {
  return CANONICAL[dimension];
}

export async function toCanonical(value: number, from: string): Promise<{
  value: number;
  unit: string;
  dimension: UnitDimension;
}> {
  const unit = await requireUnit(from);
  return {
    value: value * unit.toBaseFactor,
    unit: CANONICAL[unit.dimension],
    dimension: unit.dimension,
  };
}

export async function fromCanonical(
  canonicalValue: number,
  to: string,
  dimension?: UnitDimension,
): Promise<{ value: number; unit: string; symbol: string; dimension: UnitDimension }> {
  const unit = await requireUnit(to);
  if (dimension && unit.dimension !== dimension) {
    throw badRequest(`Unit ${unit.code} is ${unit.dimension}, expected ${dimension}`);
  }
  if (!(unit.toBaseFactor > 0)) throw badRequest(`Unit ${unit.code} has an invalid conversion factor`);
  return {
    value: canonicalValue / unit.toBaseFactor,
    unit: unit.code,
    symbol: unit.symbol,
    dimension: unit.dimension,
  };
}

export async function convertMeasurement(value: number, from: string, to: string): Promise<{
  original: { value: number; unit: string };
  converted: { value: number; unit: string; symbol: string };
  dimension: UnitDimension;
  canonical: { value: number; unit: string };
}> {
  if (!Number.isFinite(value)) throw badRequest('Measurement value must be a finite number');
  const source = await requireUnit(from);
  const target = await requireUnit(to);
  if (source.dimension !== target.dimension) {
    throw badRequest(`Cannot convert ${source.dimension} (${source.code}) to ${target.dimension} (${target.code})`);
  }
  const canonical = value * source.toBaseFactor;
  const converted = canonical / target.toBaseFactor;
  return {
    original: { value, unit: source.code },
    converted: {
      value: Number(converted.toPrecision(12)),
      unit: target.code,
      symbol: target.symbol,
    },
    dimension: source.dimension,
    canonical: { value: Number(canonical.toPrecision(12)), unit: CANONICAL[source.dimension] },
  };
}

async function requireUnit(code: string): Promise<MeasurementUnit> {
  const unit = await getUnit(code);
  if (!unit) {
    const row = await queryOne<Row>(
      'SELECT code FROM measurement_units WHERE code = ?',
      [normalizeUnitCode(code)],
    );
    if (!row) throw badRequest(`Unknown measurement unit "${code}"`);
  }
  if (!unit) throw badRequest(`Unknown measurement unit "${code}"`);
  return unit;
}

const mapUnit = (row: Row): MeasurementUnit => ({
  code: String(row.code),
  dimension: String(row.dimension) as UnitDimension,
  name: String(row.name),
  symbol: String(row.symbol),
  toBaseFactor: toNumber(row.to_base_factor) ?? 1,
});
