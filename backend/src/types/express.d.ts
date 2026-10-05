import type { RequestContext } from '../core/context';
import type { GrantScope, PrincipalGrant } from '../middleware/grants';

/**
 * Fields that middleware attaches to the request. Declared here so every
 * handler sees the same, typed shape.
 */
export interface AuthPrincipal {
  userId: number;
  sessionId: number;
  roles: string[];
  permissions: string[];
  grants: PrincipalGrant[];
  scopes: GrantScope[];
  mfaSatisfied: boolean;
  isStaff: boolean;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
}

export interface DeviceInfo {
  id: number | null;
  uuid: string | null;
  fingerprintHash: string | null;
  platformId: number | null;
  platform: string;
  appVersion: string | null;
  isRooted: boolean;
  isJailbroken: boolean;
  isEmulator: boolean;
  isDebugging: boolean;
  isAutomation: boolean;
}

export interface ValidatedPayload {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

declare global {
  namespace Express {
    interface Request {
      /** Ambient per-request state, also available via getContext(). */
      context: RequestContext;
      /** Present only when a valid access token was supplied. */
      auth: AuthPrincipal | null;
      /** Guest session uuid, for browse-without-login (§1). */
      guestUuid: string | null;
      device: DeviceInfo;
      /** Output of the validate() middleware — always prefer this over req.body. */
      valid: ValidatedPayload;
      /** Marketplace resolved from the route or the X-Marketplace header. */
      marketplaceId: number | null;
      marketplaceCode: string | null;
    }
  }
}
