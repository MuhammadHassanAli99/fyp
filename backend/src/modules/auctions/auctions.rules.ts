import { addDecimal, roundDecimal } from '../../core/decimal';

/** Server-side next-bid floor. Flutter must never compute this. */
export function minimumNextBid(
  current: string | number | null,
  start: string | number,
  increment: string | number,
): string {
  if (current === null || current === undefined) {
    return roundDecimal(start, 2);
  }
  return addDecimal(current, increment, 2);
}

export function isSelfBid(sellerId: number, bidderId: number): boolean {
  return sellerId === bidderId;
}
