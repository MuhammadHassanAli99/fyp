/**
 * Fixed-precision money helpers. Listing and payment amounts stay in their
 * original currency; conversion is presentation only and must never overwrite
 * the stored amount. Rounding uses the currency's decimal_digits, not a
 * universal 2-decimal assumption (JPY 0, KWD 3).
 */

export function roundToDigits(amount: number, digits: number): number {
  if (!Number.isFinite(amount)) return 0;
  const places = Math.max(0, Math.min(8, Math.trunc(digits)));
  const factor = 10 ** places;
  return Math.round((amount + Number.EPSILON) * factor) / factor;
}

/** Converts a major-unit amount into integer minor units for exact arithmetic. */
export function toMinorUnits(amount: number, digits: number): bigint {
  const places = Math.max(0, Math.min(8, Math.trunc(digits)));
  const factor = 10 ** places;
  return BigInt(Math.round((amount + Number.EPSILON) * factor));
}

export function fromMinorUnits(minor: bigint, digits: number): number {
  const places = Math.max(0, Math.min(8, Math.trunc(digits)));
  const factor = 10 ** places;
  return Number(minor) / factor;
}

export function multiplyMoney(amount: number, rate: number, digits: number): number {
  if (!(rate > 0) || !Number.isFinite(amount)) return roundToDigits(0, digits);
  return roundToDigits(amount * rate, digits);
}
