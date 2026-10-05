import { VIN_PATTERN } from './vehicles.rules';

/**
 * ISO 3779 model-year codes for 2010–2039. I, O, Q, U, Z and 0 are unused.
 */
const YEAR_CODES: Record<string, number> = {
  A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017,
  J: 2018, K: 2019, L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025,
  T: 2026, V: 2027, W: 2028, X: 2029, Y: 2030,
  1: 2031, 2: 2032, 3: 2033, 4: 2034, 5: 2035, 6: 2036, 7: 2037, 8: 2038, 9: 2039,
};

const REGION_BY_FIRST: Record<string, string> = {
  '1': 'United States',
  '2': 'Canada',
  '3': 'Mexico',
  '4': 'United States',
  '5': 'United States',
  J: 'Japan',
  K: 'South Korea',
  L: 'China',
  S: 'United Kingdom',
  W: 'Germany',
  V: 'France',
  Z: 'Italy',
  M: 'India',
  N: 'Turkey',
  T: 'Switzerland',
  Y: 'Sweden',
  '6': 'Australia',
  '9': 'South America',
};

export interface VinDecode {
  vin: string;
  validFormat: boolean;
  wmi: string | null;
  vds: string | null;
  vis: string | null;
  year: number | null;
  country: string | null;
  manufacturerHint: string | null;
  disclaimer: string;
}

export function normalizeVin(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, '');
}

export function isValidVinFormat(vin: string): boolean {
  return VIN_PATTERN.test(normalizeVin(vin));
}

/**
 * Heuristic decode only. This is not an authoritative manufacturer decode
 * and never implies theft, registration or ownership status.
 */
export function decodeVin(raw: string): VinDecode {
  const vin = normalizeVin(raw);
  const validFormat = VIN_PATTERN.test(vin);
  const disclaimer =
    'VIN decode is a format and WMI heuristic. It is not legal ownership, customs clearance, registration or theft status.';
  if (!validFormat) {
    return {
      vin,
      validFormat: false,
      wmi: null,
      vds: null,
      vis: null,
      year: null,
      country: null,
      manufacturerHint: null,
      disclaimer,
    };
  }
  const yearChar = vin[9] ?? '';
  return {
    vin,
    validFormat: true,
    wmi: vin.slice(0, 3),
    vds: vin.slice(3, 9),
    vis: vin.slice(9),
    year: YEAR_CODES[yearChar] ?? null,
    country: REGION_BY_FIRST[vin[0] ?? ''] ?? null,
    manufacturerHint: vin.slice(0, 3),
    disclaimer,
  };
}

export function mileageLooksAnomalous(params: {
  previousKm: number | null;
  nextKm: number;
  daysBetween: number | null;
}): { anomalous: boolean; reason: string | null } {
  if (params.previousKm === null) return { anomalous: false, reason: null };
  if (params.nextKm < params.previousKm) {
    return { anomalous: true, reason: 'Odometer reading decreased versus a previous record' };
  }
  const delta = params.nextKm - params.previousKm;
  if (params.daysBetween !== null && params.daysBetween > 0 && params.daysBetween < 3650) {
    const perYear = delta / (params.daysBetween / 365);
    if (perYear > 120_000) {
      return { anomalous: true, reason: 'Mileage increased faster than a realistic annual distance' };
    }
  }
  return { anomalous: false, reason: null };
}
