import { fineGoldWeight, mulDecimal, roundDecimal, subDecimal } from '../../core/decimal';

export const GRAMS_PER_TOLA = '11.6638';
export const GRAMS_PER_TROY_OUNCE = '31.1035';

export type WeightUnit = 'gram' | 'tola' | 'ounce' | 'kg';

export function toGrams(value: string | number, unit: string): string {
  switch (unit) {
    case 'tola':
      return mulDecimal(value, GRAMS_PER_TOLA, 3);
    case 'ounce':
      return mulDecimal(value, GRAMS_PER_TROY_OUNCE, 3);
    case 'kg':
      return mulDecimal(value, 1000, 3);
    default:
      return roundDecimal(value, 3);
  }
}

export function fromGrams(grams: string | number, unit: string): string {
  switch (unit) {
    case 'tola':
      return mulDecimal(grams, '0.085735', 3);
    case 'ounce':
      return mulDecimal(grams, '0.0321507', 3);
    case 'kg':
      return mulDecimal(grams, '0.001', 3);
    default:
      return roundDecimal(grams, 3);
  }
}

export function netGoldWeight(grossG: string | number, stoneG: string | number | null | undefined): string {
  const stone = stoneG === null || stoneG === undefined ? '0' : stoneG;
  const net = subDecimal(grossG, stone, 3);
  return net.startsWith('-') ? '0.000' : net;
}

const STANDARD_MILLS: Record<number, number> = {
  24: 999,
  23: 958,
  22: 916,
  21: 875,
  18: 750,
  14: 585,
  10: 416,
  9: 375,
};

export function computeFineGoldWeight(netG: string | number, fineness: number | null | undefined, karat: number | null | undefined): string | null {
  const mills =
    fineness && fineness > 0
      ? fineness
      : karat && karat > 0
        ? (STANDARD_MILLS[Math.round(karat)] ?? Math.round((karat / 24) * 1000))
        : null;
  if (!mills) return null;
  return fineGoldWeight(netG, mills);
}

export function mapMakingChargeType(raw: string | undefined | null): 'flat' | 'per_gram' | 'percent' | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase().replace(/-/g, '_');
  if (value === 'fixed' || value === 'flat') return 'flat';
  if (value === 'per_gram' || value === 'pergram') return 'per_gram';
  if (value === 'percentage' || value === 'percent') return 'percent';
  return undefined;
}
