import { env } from '../../config/env';
import { heuristicIpDriver } from './heuristic.driver';
import type { IpReputationDriver } from './types';

export type { IpReputationDriver, IpReputationLookup } from './types';

/**
 * IP intelligence abstraction. Swap drivers with IP_REPUTATION_DRIVER.
 * Never hard-code a single vendor in domain code.
 */
export function ipReputationDriver(): IpReputationDriver {
  const name = env.IP_REPUTATION_DRIVER;
  if (name === 'heuristic' || name === 'none') return heuristicIpDriver;
  return heuristicIpDriver;
}
