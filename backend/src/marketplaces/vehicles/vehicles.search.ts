/**
 * Natural-language vehicle search. Maps phrases onto existing listing filters.
 */

const TYPE_ALIASES: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /\bmotorcycles?\b|\bbikes?\b/i, type: 'motorcycle' },
  { pattern: /\bbuses?\b/i, type: 'bus' },
  { pattern: /\btrucks?\b/i, type: 'truck' },
  { pattern: /\bvans?\b/i, type: 'van' },
  { pattern: /\btaxis?\b/i, type: 'taxi' },
  { pattern: /\brickshaws?\b/i, type: 'rickshaw' },
  { pattern: /\bexcavators?\b|\bmachinery\b/i, type: 'heavy_machinery' },
  { pattern: /\btractors?\b|\bagriculture\b/i, type: 'agriculture_equipment' },
  { pattern: /\bboats?\b/i, type: 'boat' },
  { pattern: /\byachts?\b/i, type: 'yacht' },
  { pattern: /\bjet\s*skis?\b/i, type: 'jet_ski' },
  { pattern: /\bcars?\b|\bsedans?\b|\bsuvs?\b/i, type: 'car' },
];

export interface ParsedVehicleQuery {
  q: string;
  operation?: 'sell' | 'rent' | 'buy' | 'auction';
  vehicleType?: string;
  fuelType?: string;
  transmission?: string;
  yearMin?: number;
  mileageMax?: number;
  cityHint?: string;
}

export function parseVehicleQuery(raw: string): ParsedVehicleQuery {
  const text = raw.trim();
  const result: ParsedVehicleQuery = { q: text };

  if (/\bfor\s+rent\b|\brent\b|\brental\b/i.test(text)) result.operation = 'rent';
  else if (/\bauction\b|\bbid\b/i.test(text)) result.operation = 'auction';
  else if (/\bwanted\b|\bto\s+buy\b/i.test(text)) result.operation = 'buy';
  else if (/\bfor\s+sale\b|\bsell\b|\bsale\b/i.test(text)) result.operation = 'sell';

  if (/\belectric\b|\bev\b/i.test(text)) result.fuelType = 'electric';
  else if (/\bhybrid\b/i.test(text)) result.fuelType = 'hybrid';
  else if (/\bdiesel\b/i.test(text)) result.fuelType = 'diesel';
  else if (/\bpetrol\b|\bgasoline\b/i.test(text)) result.fuelType = 'petrol';

  if (/\bautomatic\b/i.test(text)) result.transmission = 'automatic';
  else if (/\bmanual\b/i.test(text)) result.transmission = 'manual';
  else if (/\bcvt\b/i.test(text)) result.transmission = 'cvt';

  for (const alias of TYPE_ALIASES) {
    if (alias.pattern.test(text)) {
      result.vehicleType = alias.type;
      break;
    }
  }

  const year = text.match(/\b(19|20)\d{2}\b/);
  if (year) result.yearMin = Number(year[0]);
  const km = text.match(/(\d+)\s*(?:k\s*)?km/i);
  if (km) result.mileageMax = Number(km[1]) * ( /k\s*km/i.test(text) ? 1000 : 1);

  const inCity = text.match(/\bin\s+([A-Za-z][A-Za-z\s]{1,40})$/i);
  if (inCity) result.cityHint = inCity[1]!.trim();

  return result;
}
