/**
 * Scaled BigInt decimal arithmetic.
 *
 * Authoritative gold prices, making charges, bids and weights must not use
 * IEEE-754 floats. Callers pass decimal strings (or integers) and receive
 * rounded decimal strings.
 */

const DEFAULT_SCALE = 8;

const decimalPattern = /^-?\d+(\.\d+)?$/;

export class DecimalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecimalError';
  }
}

function toScaled(value: string | number, scale: number): bigint {
  const raw = typeof value === 'number' && Number.isFinite(value) ? value.toFixed(scale) : String(value).trim();
  if (!decimalPattern.test(raw)) {
    throw new DecimalError(`Invalid decimal: ${value}`);
  }
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [wholePart, fractionPart = ''] = unsigned.split('.');
  const padded = (fractionPart + '0'.repeat(scale)).slice(0, scale);
  const scaled = BigInt(wholePart || '0') * 10n ** BigInt(scale) + BigInt(padded || '0');
  return negative ? -scaled : scaled;
}

function fromScaled(scaled: bigint, scale: number, outDecimals: number): string {
  const factor = 10n ** BigInt(scale);
  const negative = scaled < 0n;
  let abs = negative ? -scaled : scaled;

  if (outDecimals < scale) {
    const drop = scale - outDecimals;
    const divisor = 10n ** BigInt(drop);
    const remainder = abs % divisor;
    abs = abs / divisor;
    const half = divisor / 2n;
    if (remainder > half || (remainder === half && abs % 2n === 1n)) {
      abs += 1n;
    }
  } else if (outDecimals > scale) {
    abs *= 10n ** BigInt(outDecimals - scale);
  }

  const outFactor = 10n ** BigInt(outDecimals);
  const whole = abs / outFactor;
  const frac = abs % outFactor;
  const fracStr = frac.toString().padStart(outDecimals, '0');
  const body = outDecimals === 0 ? whole.toString() : `${whole.toString()}.${fracStr}`;
  return negative && abs !== 0n ? `-${body}` : body;
}

export function addDecimal(a: string | number, b: string | number, decimals = 2): string {
  const scaledA = toScaled(a, DEFAULT_SCALE);
  const scaledB = toScaled(b, DEFAULT_SCALE);
  return fromScaled(scaledA + scaledB, DEFAULT_SCALE, decimals);
}

export function subDecimal(a: string | number, b: string | number, decimals = 2): string {
  const scaledA = toScaled(a, DEFAULT_SCALE);
  const scaledB = toScaled(b, DEFAULT_SCALE);
  return fromScaled(scaledA - scaledB, DEFAULT_SCALE, decimals);
}

export function mulDecimal(a: string | number, b: string | number, decimals = 4): string {
  const scaledA = toScaled(a, DEFAULT_SCALE);
  const scaledB = toScaled(b, DEFAULT_SCALE);
  const product = scaledA * scaledB;
  return fromScaled(product, DEFAULT_SCALE * 2, decimals);
}

export function divDecimal(a: string | number, b: string | number, decimals = 4): string {
  const divisor = toScaled(b, DEFAULT_SCALE);
  if (divisor === 0n) throw new DecimalError('Division by zero');
  const dividend = toScaled(a, DEFAULT_SCALE) * 10n ** BigInt(DEFAULT_SCALE);
  return fromScaled(dividend / divisor, DEFAULT_SCALE, decimals);
}

export function cmpDecimal(a: string | number, b: string | number): number {
  const scaledA = toScaled(a, DEFAULT_SCALE);
  const scaledB = toScaled(b, DEFAULT_SCALE);
  if (scaledA === scaledB) return 0;
  return scaledA > scaledB ? 1 : -1;
}

export function maxDecimal(a: string | number, b: string | number, decimals = 4): string {
  return cmpDecimal(a, b) >= 0 ? fromScaled(toScaled(a, DEFAULT_SCALE), DEFAULT_SCALE, decimals) : fromScaled(toScaled(b, DEFAULT_SCALE), DEFAULT_SCALE, decimals);
}

export function roundDecimal(value: string | number, decimals = 2): string {
  return fromScaled(toScaled(value, DEFAULT_SCALE), DEFAULT_SCALE, decimals);
}

export function toNumberSafe(value: string | number, decimals = 4): number {
  return Number(roundDecimal(value, decimals));
}

/** Fine gold weight = net gold weight × (fineness / 1000). */
export function fineGoldWeight(netWeightG: string | number, fineness: number): string {
  if (fineness <= 0 || fineness > 1000) {
    throw new DecimalError(`Invalid fineness: ${fineness}`);
  }
  return mulDecimal(netWeightG, divDecimal(fineness, 1000, 8), 3);
}

export function makingChargeAmount(params: {
  type: 'flat' | 'per_gram' | 'percent';
  value: string | number;
  netWeightG: string | number;
  metalValue: string | number;
}): string {
  if (params.type === 'per_gram') {
    return mulDecimal(params.value, params.netWeightG, 2);
  }
  if (params.type === 'percent') {
    return mulDecimal(params.metalValue, divDecimal(params.value, 100, 8), 2);
  }
  return roundDecimal(params.value, 2);
}
