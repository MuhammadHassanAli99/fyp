import type { ActionType } from './notifications.types';

export interface DeepLink {
  route: string;
  actionType: ActionType;
  actionTarget: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^\d{1,18}$/;
const USERNAME_RE = /^[a-zA-Z0-9._-]{1,64}$/;

const ALLOWED_PREFIXES: Array<{ prefix: string; actionType: ActionType }> = [
  { prefix: '/listing/', actionType: 'listing' },
  { prefix: '/chat/', actionType: 'chat' },
  { prefix: '/calls/', actionType: 'call' },
  { prefix: '/security/devices', actionType: 'security' },
  { prefix: '/subscription', actionType: 'subscription' },
  { prefix: '/profile', actionType: 'system' },
  { prefix: '/marketplace', actionType: 'system' },
  { prefix: '/search', actionType: 'search' },
  { prefix: '/support', actionType: 'support' },
  { prefix: '/orders/', actionType: 'payment' },
  { prefix: '/checkout/', actionType: 'payment' },
  { prefix: '/vehicles/parts', actionType: 'listing' },
  { prefix: '/u/', actionType: 'system' },
];

function isSafeSegment(value: string): boolean {
  if (!value || value.includes('..') || value.includes('//') || value.includes('\\')) return false;
  if (value.includes('://') || value.startsWith('http') || value.startsWith('javascript:')) return false;
  return UUID_RE.test(value) || NUMERIC_RE.test(value) || USERNAME_RE.test(value) || value === 'history' || value === 'saved';
}

/**
 * Only internal route identifiers. Arbitrary URLs, javascript:, and
 * protocol-relative links are rejected.
 */
export function sanitizeDeepLink(input: string | null | undefined): DeepLink | null {
  if (!input) return null;
  let raw = input.trim();
  if (raw.length === 0 || raw.length > 191) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return null;
  if (!raw.startsWith('/')) raw = `/${raw}`;
  const path = raw.split('?')[0]!.split('#')[0]!;

  for (const rule of ALLOWED_PREFIXES) {
    if (path === rule.prefix || path.startsWith(`${rule.prefix}/`) || (rule.prefix !== '/' && path.startsWith(rule.prefix))) {
      if (path === rule.prefix || path === `${rule.prefix}/`) {
        return { route: path, actionType: rule.actionType, actionTarget: null };
      }
      const rest = path.slice(rule.prefix.endsWith('/') ? rule.prefix.length : rule.prefix.length + 1);
      const segment = rest.split('/')[0] ?? '';
      if (segment && !isSafeSegment(segment)) return null;
      return { route: path, actionType: rule.actionType, actionTarget: segment || null };
    }
  }
  return null;
}

export function resolveDeepLink(params: {
  deepLink?: string | null;
  actionType?: ActionType | string | null;
  actionTarget?: string | null;
  entityType?: string | null;
  entityId?: string | number | null;
}): DeepLink {
  const fromInput = sanitizeDeepLink(params.deepLink ?? null);
  if (fromInput) return fromInput;

  const entityId = params.entityId == null ? null : String(params.entityId);
  const target = params.actionTarget ?? entityId;

  const byType: Record<string, string> = {
    listing: target ? `/listing/${target}` : '/home',
    chat: target ? `/chat/${target}` : '/chat',
    call: target && target !== 'history' ? `/calls/${target}` : '/calls/history',
    auction: target ? `/listing/${target}` : '/home',
    payment: target ? `/checkout/${target}` : '/home',
    subscription: '/subscription',
    verification: '/profile/verification',
    review: '/profile',
    search: '/search/saved',
    security: '/security/devices',
    favorite: target ? `/listing/${target}` : '/favorites',
    offer: target ? `/listing/${target}` : '/home',
    system: '/home',
    support: '/support',
    ad: '/home',
    external: '/home',
    none: '/home',
  };

  const actionType = (params.actionType ?? params.entityType ?? 'none') as string;
  const candidate = byType[actionType] ?? '/home';
  return sanitizeDeepLink(candidate) ?? { route: '/home', actionType: 'system', actionTarget: null };
}
