export type TrustBand = 'new' | 'bronze' | 'silver' | 'gold' | 'platinum';
export type TrustLevel = 'new' | 'building' | 'established' | 'trusted';

export const MAX_NEGATIVE_EVENT = -12;
export const MAX_POSITIVE_EVENT = 20;

export function clampEventDelta(delta: number): number {
  if (delta < MAX_NEGATIVE_EVENT) return MAX_NEGATIVE_EVENT;
  if (delta > MAX_POSITIVE_EVENT) return MAX_POSITIVE_EVENT;
  return delta;
}

export function bandFromScore(score: number): TrustBand {
  if (score >= 85) return 'platinum';
  if (score >= 70) return 'gold';
  if (score >= 50) return 'silver';
  if (score >= 25) return 'bronze';
  return 'new';
}

export function levelFromBand(band: TrustBand): TrustLevel {
  if (band === 'gold' || band === 'platinum') return 'trusted';
  if (band === 'silver') return 'established';
  if (band === 'bronze') return 'building';
  return 'new';
}

export function applyEvents(events: Array<{ delta: number; status: string }>): number {
  let score = 0;
  for (const event of events) {
    if (event.status !== 'applied') continue;
    // Historical positives stay; a single incoming penalty is still capped.
    const delta = event.delta < 0 ? Math.max(event.delta, MAX_NEGATIVE_EVENT) : event.delta;
    score += delta;
  }
  return Math.max(0, Math.min(100, Math.round(score * 100) / 100));
}
