export interface IpReputationLookup {
  ip: string;
  countryCode?: string | null;
  asn?: number | null;
  asnOrg?: string | null;
  isVpn: boolean;
  isProxy: boolean;
  isTor: boolean;
  isDatacenter: boolean;
  isRelay: boolean;
  isAbuser: boolean;
  threatLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  provider: string;
  ttlSeconds: number;
}

export interface IpReputationDriver {
  readonly name: string;
  lookup(ip: string): Promise<IpReputationLookup | null>;
}
