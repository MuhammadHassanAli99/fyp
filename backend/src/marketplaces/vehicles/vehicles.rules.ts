export function mapTypeOperation(operation: string): string {
  if (operation === 'auction' || operation === 'exchange') return 'sell';
  return operation;
}

export function isTypeOperationAllowed(
  allowedOperations: readonly string[],
  operation: string,
): boolean {
  if (allowedOperations.length === 0) return true;
  return allowedOperations.includes(mapTypeOperation(operation));
}

export function riskBand(score: number): 'low' | 'medium' | 'high' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/** Fraud scoring never auto-bans from a single pipeline run. */
export const VEHICLE_FRAUD_AUTO_BAN = false as const;

export const ROAD_VEHICLES = [
  'car',
  'motorcycle',
  'bus',
  'truck',
  'van',
  'taxi',
  'rickshaw',
] as const;

export const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export const VEHICLE_MARKETPLACE_ID = 3;

export const VALUATION_DISCLAIMER =
  'This is an automated estimate from asking prices, market index data and depreciation curves — not an inspection, appraisal or a guaranteed price.';

export const LEGAL_AI_DISCLAIMER =
  'AI must never independently claim legal ownership, customs clearance, registration or theft status.';

export function dealRatingFor(priceVsMarketPct: number): 'great' | 'good' | 'fair' | 'high' | 'overpriced' {
  if (priceVsMarketPct <= -15) return 'great';
  if (priceVsMarketPct <= -5) return 'good';
  if (priceVsMarketPct < 8) return 'fair';
  if (priceVsMarketPct < 20) return 'high';
  return 'overpriced';
}
