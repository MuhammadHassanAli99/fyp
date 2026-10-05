import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request ambient state. Middleware fills it once; any layer can read it
 * without threading a `ctx` parameter through every signature.
 *
 * Everything here is resolved in this order: explicit header → authenticated
 * user preference → GeoIP → platform default.
 */
export interface RequestContext {
  requestId: string;
  startedAt: number;

  /** Principal */
  userId: number | null;
  sessionId: number | null;
  guestUuid: string | null;
  roles: string[];
  permissions: string[];
  isStaff: boolean;

  /** Locale resolution (§1, §28) */
  countryId: number | null;
  countryCode: string;
  language: string;
  currency: string;
  timezone: string;
  measurementSystem: 'metric' | 'imperial';

  /** Client */
  platformId: number | null;
  platform: string;
  appVersion: string | null;
  deviceId: number | null;
  /** Stable client installation UUID from X-Device-Id (never the fingerprint hash). */
  installationId: string | null;
  deviceHash: string | null;
  ip: string | null;
  userAgent: string | null;

  /** Active marketplace, when the route is scoped to one */
  marketplaceId: number | null;
  marketplaceCode: string | null;

  /** Risk decision from the risk guard (§19) */
  riskScore: number;
  riskDecision: 'allow' | 'challenge' | 'review' | 'block';
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(context: RequestContext, fn: () => T): T => storage.run(context, fn);

export const getContext = (): RequestContext | undefined => storage.getStore();

/**
 * Non-request callers (jobs, event handlers) get a synthetic context so that
 * shared code can rely on locale defaults being present.
 */
export function requireContext(): RequestContext {
  const context = storage.getStore();
  if (!context) throw new Error('RequestContext accessed outside of a request scope');
  return context;
}

export const contextOrDefaults = (defaults: Partial<RequestContext> = {}): RequestContext => {
  const existing = storage.getStore();
  if (existing) return existing;
  return {
    requestId: 'system',
    startedAt: Date.now(),
    userId: null,
    sessionId: null,
    guestUuid: null,
    roles: [],
    permissions: [],
    isStaff: false,
    countryId: null,
    countryCode: 'US',
    language: 'en',
    currency: 'USD',
    timezone: 'UTC',
    measurementSystem: 'metric',
    platformId: null,
    platform: 'system',
    appVersion: null,
    deviceId: null,
    installationId: null,
    deviceHash: null,
    ip: null,
    userAgent: null,
    marketplaceId: null,
    marketplaceCode: null,
    riskScore: 0,
    riskDecision: 'allow',
    ...defaults,
  };
};
