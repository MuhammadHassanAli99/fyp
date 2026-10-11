import type { SearchQuery } from './search.dsl';

export interface PartHit {
  kind: 'part';
  id: number;
  uuid: string;
  name: string;
  brand: string | null;
  categoryCode: string;
  price: number | null;
  currency: string | null;
  conditionCode: string | null;
  marketplaceCode: 'vehicles';
  placement: 'organic';
}

/**
 * Parts search was vehicle-only (vehicle_parts / vehicle_part_compatibility,
 * compatible makes & models). Now that the Vehicles marketplace has been
 * removed (API is Gold-only), this always returns no results rather than
 * dropping the vehicle_parts table/migration.
 */
export async function searchParts(
  dsl: SearchQuery,
  _ctx: { language: string; currency: string; countryId: number | null; viewerId: number | null },
): Promise<PartHit[]> {
  void dsl;
  void _ctx;
  return [];
}
