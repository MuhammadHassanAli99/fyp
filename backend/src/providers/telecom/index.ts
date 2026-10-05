import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { uuid } from '../../core/security/crypto';

const log = loggerFor('telecom');

/**
 * Masked-calling / PSTN bridge behind one interface.
 *
 * Credentials and real numbers stay in this process. Drivers must never return
 * the callee's real number to callers of this module's public DTO.
 */
export interface MaskedBridgeRequest {
  sessionUuid: string;
  listingId: number | null;
  /** E.164 — never log this value. */
  callerRealNumber?: string | null;
  /** E.164 — never log this value. */
  calleeRealNumber?: string | null;
  ttlSeconds: number;
}

export interface MaskedBridgeResult {
  provider: string;
  providerSessionId: string;
  /** Proxy the buyer may dial. Null for in-app-only bridges. */
  proxyNumber: string | null;
  expiresAt: Date;
}

export interface TelecomDriver {
  readonly name: string;
  allocate(request: MaskedBridgeRequest): Promise<MaskedBridgeResult>;
  revoke(providerSessionId: string): Promise<void>;
}

function redactRequest(request: MaskedBridgeRequest): Record<string, unknown> {
  return {
    sessionUuid: request.sessionUuid,
    listingId: request.listingId,
    ttlSeconds: request.ttlSeconds,
    hasCallerNumber: Boolean(request.callerRealNumber),
    hasCalleeNumber: Boolean(request.calleeRealNumber),
  };
}

class LogTelecomDriver implements TelecomDriver {
  readonly name = 'log';

  async allocate(request: MaskedBridgeRequest): Promise<MaskedBridgeResult> {
    log.info(redactRequest(request), 'masked call allocated (log driver — no PSTN bridge)');
    return {
      provider: this.name,
      providerSessionId: `log_${request.sessionUuid}`,
      proxyNumber: null,
      expiresAt: new Date(Date.now() + request.ttlSeconds * 1000),
    };
  }

  async revoke(providerSessionId: string): Promise<void> {
    log.info({ providerSessionId }, 'masked call revoked (log driver)');
  }
}

class UnconfiguredTelecomDriver implements TelecomDriver {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }

  async allocate(request: MaskedBridgeRequest): Promise<MaskedBridgeResult> {
    log.warn({ driver: this.name, ...redactRequest(request) }, 'telecom driver not configured; using in-app signalling only');
    return {
      provider: this.name,
      providerSessionId: `${this.name}_${uuid()}`,
      proxyNumber: null,
      expiresAt: new Date(Date.now() + request.ttlSeconds * 1000),
    };
  }

  async revoke(providerSessionId: string): Promise<void> {
    log.info({ providerSessionId, driver: this.name }, 'masked call revoke skipped (driver not configured)');
  }
}

export const telecom: TelecomDriver =
  env.TELECOM_DRIVER === 'log' ? new LogTelecomDriver() : new UnconfiguredTelecomDriver(env.TELECOM_DRIVER);
