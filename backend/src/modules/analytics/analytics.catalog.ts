/** Canonical analytics event names. Prefer existing dotted domain names. */
export const ANALYTICS_EVENTS = [
  'app.opened',
  'session.started',
  'session.ended',
  'page.viewed',
  'listing.viewed',
  'listing.created',
  'listing.updated',
  'listing.published',
  'listing.sold',
  'listing.rented',
  'listing.favorited',
  'favorite.added',
  'listing.shared',
  'search.performed',
  'search.result_clicked',
  'lead.created',
  'lead.contacted',
  'lead.converted',
  'offer.created',
  'offer.accepted',
  'message.sent',
  'call.started',
  'call.ended',
  'payment.succeeded',
  'order.created',
  'subscription.started',
  'subscription.renewed',
  'promotion.viewed',
  'promotion.clicked',
  'promotion.converted',
  'user.registered',
  'user.logged_in',
  'user.logged_out',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

const EVENT_SET = new Set<string>(ANALYTICS_EVENTS);

/** Domain event names and spec aliases mapped onto the catalogue. */
export const DOMAIN_TO_ANALYTICS: Record<string, AnalyticsEventName> = {
  'listing.viewed': 'listing.viewed',
  'listing.created': 'listing.created',
  'listing.updated': 'listing.updated',
  'listing.published': 'listing.published',
  'listing.sold': 'listing.sold',
  'listing.rented': 'listing.rented',
  'favorite.added': 'favorite.added',
  'listing.favorited': 'listing.favorited',
  'search.performed': 'search.performed',
  'lead.created': 'lead.created',
  'offer.created': 'offer.created',
  'offer.accepted': 'offer.accepted',
  'message.sent': 'message.sent',
  'call.started': 'call.started',
  'call.ended': 'call.ended',
  'payment.succeeded': 'payment.succeeded',
  'payment.completed': 'payment.succeeded',
  'order.created': 'order.created',
  'subscription.started': 'subscription.started',
  'subscription.renewed': 'subscription.renewed',
  'user.registered': 'user.registered',
  'user.logged_in': 'user.logged_in',
  'user.login': 'user.logged_in',
  'user.logout': 'user.logged_out',
};

export const GUEST_EVENTS = new Set<AnalyticsEventName>([
  'app.opened',
  'session.started',
  'session.ended',
  'page.viewed',
  'listing.viewed',
  'search.performed',
  'search.result_clicked',
  'promotion.viewed',
  'promotion.clicked',
]);

export function isAllowedEvent(name: string): name is AnalyticsEventName {
  return EVENT_SET.has(name);
}

export function normalizeEventName(raw: string): AnalyticsEventName | null {
  const trimmed = raw.trim();
  if (isAllowedEvent(trimmed)) return trimmed;
  if (DOMAIN_TO_ANALYTICS[trimmed]) return DOMAIN_TO_ANALYTICS[trimmed];
  const dotted = trimmed.replace(/_/g, '.');
  if (isAllowedEvent(dotted)) return dotted;
  return DOMAIN_TO_ANALYTICS[dotted] ?? null;
}

export function guestMayIngest(name: AnalyticsEventName, userId: number | null): boolean {
  return Boolean(userId) || GUEST_EVENTS.has(name);
}

export function funnelRates(stepIndex: number, current: number, previous: number, startCount: number) {
  return {
    fromPrevious: stepIndex === 0 || previous === 0 ? 100 : Number(((current / previous) * 100).toFixed(2)),
    fromStart: startCount === 0 ? 0 : Number(((current / startCount) * 100).toFixed(2)),
  };
}

export type RevenueSource = 'subscription' | 'promotion' | 'advertisement' | 'verification' | 'inspection' | 'commission' | 'other';

export function mapRevenueSource(kind: string): RevenueSource {
  if ((PLATFORM_REVENUE_KINDS as readonly string[]).includes(kind)) return kind as RevenueSource;
  return 'other';
}

export type TrafficSource = 'direct' | 'organic' | 'paid' | 'social' | 'referral' | 'email' | 'push' | 'affiliate';

export function mapTrafficSource(utmSource: string | null, referrer: string | null): TrafficSource {
  const source = (utmSource ?? '').toLowerCase();
  if (!source && !referrer) return 'direct';
  if (/google|bing|yahoo|duckduckgo/.test(source) || /google|bing/.test(referrer ?? '')) return 'organic';
  if (/cpc|ppc|paid|ads|adwords/.test(source)) return 'paid';
  if (/facebook|instagram|twitter|tiktok|linkedin|whatsapp/.test(source)) return 'social';
  if (/email|newsletter/.test(source)) return 'email';
  if (/push/.test(source)) return 'push';
  if (/affiliate/.test(source)) return 'affiliate';
  if (source || referrer) return 'referral';
  return 'direct';
}

/** Unknown seller ids are ignored so a client cannot probe authorization with 403. */
export function applyRequestedSellerFilter(ownerUserIds: number[], requestedSeller?: number): number[] {
  if (requestedSeller && ownerUserIds.includes(requestedSeller)) return [requestedSeller];
  return ownerUserIds;
}

export const PLATFORM_REVENUE_KINDS = ['subscription', 'promotion', 'advertisement', 'verification', 'inspection'] as const;

export const GMV_ORDER_KINDS = [
  'listing_purchase',
  'rental_payment',
  'booking_payment',
  'parts_purchase',
  'escrow',
] as const;

export const RENTAL_ORDER_KINDS = ['rental_payment', 'booking_payment', 'rental_deposit'] as const;

export interface FunnelSeed {
  code: string;
  name: string;
  marketplaceId: number | null;
  steps: string[];
  windowHours: number;
}

export const FUNNEL_SEEDS: FunnelSeed[] = [
  {
    code: 'platform.visitor_to_sale',
    name: 'Visitor to purchase',
    marketplaceId: null,
    steps: [
      'session.started',
      'search.performed',
      'listing.viewed',
      'favorite.added',
      'message.sent',
      'lead.created',
      'offer.created',
      'listing.sold',
    ],
    windowHours: 168,
  },
  {
    code: 'gold.visitor_to_sale',
    name: 'Gold visitor to sale',
    marketplaceId: 1,
    steps: ['search.performed', 'listing.viewed', 'lead.created', 'listing.sold'],
    windowHours: 168,
  },
  {
    code: 'property.visitor_to_rental',
    name: 'Property visitor to rental',
    marketplaceId: 2,
    steps: ['search.performed', 'listing.viewed', 'lead.created', 'listing.rented'],
    windowHours: 336,
  },
  {
    code: 'vehicles.visitor_to_sale',
    name: 'Vehicle visitor to sale',
    marketplaceId: 3,
    steps: ['search.performed', 'listing.viewed', 'lead.created', 'offer.created', 'listing.sold'],
    windowHours: 168,
  },
];

export const RETENTION_DAYS = [1, 7, 14, 30, 60, 90] as const;
