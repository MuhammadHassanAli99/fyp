/**
 * Price / currency parsing for search. Keeps original amount + currency.
 * Conversion onto the platform base is applied later with an FX timestamp.
 */

export const SUPPORTED_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'PKR', 'INR', 'SAR', 'AED', 'CAD', 'AUD', 'TRY', 'JPY',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const COUNTRY_CURRENCY: Record<string, SupportedCurrency> = {
  PK: 'PKR',
  IN: 'INR',
  AE: 'AED',
  SA: 'SAR',
  US: 'USD',
  GB: 'GBP',
  CA: 'CAD',
  AU: 'AUD',
  TR: 'TRY',
  JP: 'JPY',
  DE: 'EUR',
  FR: 'EUR',
  ES: 'EUR',
  IT: 'EUR',
  NL: 'EUR',
};

const CURRENCY_WORDS: Array<{ currency: SupportedCurrency; pattern: RegExp }> = [
  { currency: 'USD', pattern: /\b(usd|dollars?|bucks)\b/i },
  { currency: 'EUR', pattern: /\b(eur|euros?)\b/i },
  { currency: 'GBP', pattern: /\b(gbp|pounds?|£)\b/i },
  { currency: 'PKR', pattern: /\b(pkr|rupees?|rs\.?)\b/i },
  { currency: 'INR', pattern: /\b(inr|₹)\b/i },
  { currency: 'SAR', pattern: /\b(sar|riyals?)\b/i },
  { currency: 'AED', pattern: /\b(aed|dirhams?)\b/i },
  { currency: 'CAD', pattern: /\b(cad)\b/i },
  { currency: 'AUD', pattern: /\b(aud)\b/i },
  { currency: 'TRY', pattern: /\b(try|lira)\b/i },
  { currency: 'JPY', pattern: /\b(jpy|yen)\b/i },
];

const SCALE: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  thousands: 1_000,
  lakh: 100_000,
  lakhs: 100_000,
  lac: 100_000,
  lacs: 100_000,
  crore: 10_000_000,
  crores: 10_000_000,
  cr: 10_000_000,
  m: 1_000_000,
  million: 1_000_000,
  millions: 1_000_000,
  billion: 1_000_000_000,
};

export interface ParsedPrice {
  min?: number;
  max?: number;
  currency: string;
  originalAmount: number;
  originalCurrency: string;
}

export function currencyForCountry(countryCode: string, fallback: string): string {
  return COUNTRY_CURRENCY[countryCode.toUpperCase()] ?? fallback.toUpperCase();
}

export function detectCurrency(text: string, fallback: string): string {
  for (const rule of CURRENCY_WORDS) {
    if (rule.pattern.test(text)) return rule.currency;
  }
  return fallback.toUpperCase();
}

function scaleNumber(raw: string, suffix: string | undefined): number {
  const value = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(value)) return 0;
  const key = (suffix ?? '').toLowerCase();
  return value * (SCALE[key] ?? 1);
}

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const SUFFIX = String.raw`(k|m|lakh|lakhs|lac|lacs|crore|crores|cr|million|millions|thousand|thousands|billion)?`;

export function parsePriceRange(text: string, fallbackCurrency: string, countryCode: string): ParsedPrice | null {
  const currency = detectCurrency(text, currencyForCountry(countryCode, fallbackCurrency));
  const under = text.match(
    new RegExp(
      String.raw`(?:under|below|less than|upto|up to|max|se kam|s\.?kam|<=)\s*${NUMBER}\s*${SUFFIX}`,
      'i',
    ),
  );
  if (under?.[1]) {
    const max = scaleNumber(under[1], under[2]);
    return { max, currency, originalAmount: max, originalCurrency: currency };
  }

  const underPost = text.match(
    new RegExp(
      String.raw`${NUMBER}\s*${SUFFIX}\s*(?:se kam|se kam hai|tak|or less|or under)`,
      'i',
    ),
  );
  if (underPost?.[1]) {
    const max = scaleNumber(underPost[1], underPost[2]);
    return { max, currency, originalAmount: max, originalCurrency: currency };
  }

  const over = text.match(
    new RegExp(String.raw`(?:above|over|more than|from|min|>=)\s*${NUMBER}\s*${SUFFIX}`, 'i'),
  );
  if (over?.[1]) {
    const min = scaleNumber(over[1], over[2]);
    return { min, currency, originalAmount: min, originalCurrency: currency };
  }

  const between = text.match(
    new RegExp(
      String.raw`between\s*${NUMBER}\s*${SUFFIX}\s*(?:and|to|-)\s*${NUMBER}\s*${SUFFIX}`,
      'i',
    ),
  );
  if (between?.[1] && between[3]) {
    const min = scaleNumber(between[1], between[2]);
    const max = scaleNumber(between[3], between[4]);
    return { min, max, currency, originalAmount: max, originalCurrency: currency };
  }

  return null;
}

export function parseWeightGrams(text: string): number | null {
  const gram = text.match(/(\d+(?:\.\d+)?)\s*(?:g|gm|gram|grams)\b/i);
  if (gram?.[1]) return Number(gram[1]);
  const tola = text.match(/(\d+(?:\.\d+)?)\s*tola/i);
  if (tola?.[1]) return Number((Number(tola[1]) * 11.6638).toFixed(3));
  const ounce = text.match(/(\d+(?:\.\d+)?)\s*(?:oz|ounce|troy ounce)/i);
  if (ounce?.[1]) return Number((Number(ounce[1]) * 31.1035).toFixed(3));
  return null;
}
