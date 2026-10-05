import { hmacSha256, safeEqual } from '../../core/security/crypto';

export interface InvalidTrafficInput {
  isSelfClick: boolean;
  hasImpression: boolean;
  duplicateWithinWindow: boolean;
  clickCountWindow: number;
  impressionCountWindow: number;
  isBotUa: boolean;
}

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua || ua.trim().length < 8) return true;
  return /bot|crawler|spider|headless|curl\/|wget|python-requests|httpclient|scrapy/i.test(ua);
}

/**
 * Invalid traffic is classified before billing. A valid click still requires
 * a prior impression; self-clicks and velocity spikes are never billed.
 */
export function classifyInvalidTraffic(input: InvalidTrafficInput): { invalid: boolean; reason: string | null } {
  if (input.isBotUa) return { invalid: true, reason: 'bot' };
  if (input.isSelfClick) return { invalid: true, reason: 'self_click' };
  if (!input.hasImpression) return { invalid: true, reason: 'missing_impression' };
  if (input.duplicateWithinWindow) return { invalid: true, reason: 'duplicate' };
  if (input.clickCountWindow >= 12) return { invalid: true, reason: 'click_velocity' };
  if (input.impressionCountWindow >= 40) return { invalid: true, reason: 'impression_velocity' };
  return { invalid: false, reason: null };
}

export function eventCost(pricingModel: string, bid: number, kind: 'impression' | 'click' | 'conversion' | 'view'): number {
  const amount = Math.max(0, bid);
  if (kind === 'impression') {
    if (pricingModel === 'cpm') return amount / 1000;
    return 0;
  }
  if (kind === 'click') {
    if (pricingModel === 'cpc' || pricingModel === 'sponsored') return amount;
    return 0;
  }
  if (kind === 'view') {
    if (pricingModel === 'cpv') return amount;
    return 0;
  }
  if (pricingModel === 'cpa') return amount;
  return 0;
}

export function signDeliveryToken(params: {
  creativeUuid: string;
  campaignId: number;
  placementCode: string;
  exp: number;
}): string {
  const payload = `${params.creativeUuid}|${params.campaignId}|${params.placementCode}|${params.exp}`;
  return `${payload}.${hmacSha256(payload)}`;
}

export function verifyDeliveryToken(token: string): {
  creativeUuid: string;
  campaignId: number;
  placementCode: string;
} | null {
  const lastDot = token.lastIndexOf('.');
  if (lastDot <= 0) return null;
  const payload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  if (!safeEqual(hmacSha256(payload), signature)) return null;
  const [creativeUuid, campaignIdRaw, placementCode, expRaw] = payload.split('|');
  const exp = Number(expRaw);
  if (!creativeUuid || !placementCode || !Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  const campaignId = Number(campaignIdRaw);
  if (!Number.isFinite(campaignId) || campaignId <= 0) return null;
  return { creativeUuid, campaignId, placementCode };
}
