import type { IpReputationDriver, IpReputationLookup } from './types';

const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|::1|fc|fd)/i;

/**
 * Development / offline driver. Does not call a vendor.
 * RFC1918 and loopback are treated as clean shared networks, never as VPN fraud.
 */
export const heuristicIpDriver: IpReputationDriver = {
  name: 'heuristic',
  async lookup(ip: string): Promise<IpReputationLookup | null> {
    const trimmed = ip.trim();
    if (!trimmed) return null;
    if (PRIVATE.test(trimmed) || trimmed === 'localhost') {
      return {
        ip: trimmed,
        isVpn: false,
        isProxy: false,
        isTor: false,
        isDatacenter: false,
        isRelay: false,
        isAbuser: false,
        threatLevel: 'none',
        riskScore: 0,
        provider: 'heuristic',
        ttlSeconds: 86_400,
      };
    }
    return {
      ip: trimmed,
      isVpn: false,
      isProxy: false,
      isTor: false,
      isDatacenter: false,
      isRelay: false,
      isAbuser: false,
      threatLevel: 'none',
      riskScore: 0,
      provider: 'heuristic',
      ttlSeconds: 21_600,
    };
  },
};
