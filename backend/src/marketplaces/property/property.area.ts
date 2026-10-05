import { divDecimal, mulDecimal, roundDecimal } from '../../core/decimal';
import { validationFailed } from '../../core/errors';

/**
 * Square metres per unit as decimal strings.
 *
 * Authoritative area conversion must not use IEEE-754. Original value + unit
 * are always stored; sqm is the canonical comparison column.
 */
export const AREA_TO_SQM: Record<string, string> = {
  sqm: '1',
  sqft: '0.09290304',
  sqyd: '0.83612736',
  marla: '25.29285264',
  kanal: '505.8570528',
  acre: '4046.8564224',
  hectare: '10000',
  bigha: '1618.74',
  cent: '40.468564224',
  ground: '222.967',
  dunam: '1000',
};

/** Numeric factors for SQL filter bounds only — storage still uses decimal strings. */
export const AREA_TO_SQM_NUMBER: Record<string, number> = Object.fromEntries(
  Object.entries(AREA_TO_SQM).map(([code, factor]) => [code, Number(factor)]),
);

export function normalizeAreaUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\s+/g, '');
}

export function knownAreaUnit(unit: string): boolean {
  return normalizeAreaUnit(unit) in AREA_TO_SQM;
}

export function toSqmDecimal(value: string | number, unit: string): string {
  const code = normalizeAreaUnit(unit);
  const factor = AREA_TO_SQM[code];
  if (!factor) {
    throw validationFailed([
      {
        field: 'details.areaUnit',
        message: `Unknown area unit "${unit}". Supported: ${Object.keys(AREA_TO_SQM).join(', ')}`,
      },
    ]);
  }
  return mulDecimal(value, factor, 4);
}

export function fromSqmDecimal(sqm: string | number, unit: string): string {
  const code = normalizeAreaUnit(unit);
  const factor = AREA_TO_SQM[code];
  if (!factor) {
    throw validationFailed([{ field: 'unit', message: `Unknown area unit "${unit}"` }]);
  }
  return divDecimal(sqm, factor, 4);
}

/** Legacy numeric helpers used by existing filters. Prefer decimal for persistence. */
export function toSqm(value: number, unit: string): number {
  return Number(toSqmDecimal(value, unit));
}

export function fromSqm(sqm: number, unit: string): number {
  return Number(fromSqmDecimal(sqm, unit));
}

export function convertArea(value: string | number, fromUnit: string, toUnit: string): string {
  return roundDecimal(fromSqmDecimal(toSqmDecimal(value, fromUnit), toUnit), 4);
}
