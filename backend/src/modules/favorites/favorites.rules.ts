export const MAX_FOLDER_DEPTH = 4;

export const FAVORITE_ENTITY_TYPES = ['listing', 'vehicle_part'] as const;
export type FavoriteEntityType = (typeof FAVORITE_ENTITY_TYPES)[number];

export const COLLECTION_VISIBILITY = ['private', 'shared', 'public'] as const;
export type CollectionVisibility = (typeof COLLECTION_VISIBILITY)[number];

export const FAVORITE_SORTS = ['newest', 'oldest', 'price_asc', 'price_desc'] as const;
export type FavoriteSort = (typeof FAVORITE_SORTS)[number];

export function isFavoriteEntityType(value: string): value is FavoriteEntityType {
  return (FAVORITE_ENTITY_TYPES as readonly string[]).includes(value);
}

/** Listing lifecycle shown on a saved card. Favorites are never hard-deleted with the listing. */
export function availabilityFromListing(status: string | null | undefined, deletedAt: Date | string | null | undefined): string {
  if (deletedAt) return 'unavailable';
  if (!status) return 'unavailable';
  switch (status) {
    case 'published':
      return 'available';
    case 'sold':
    case 'rented':
    case 'expired':
    case 'archived':
    case 'reserved':
    case 'draft':
    case 'rejected':
      return status;
    default:
      return 'unavailable';
  }
}

export function availabilityFromPart(status: string | null | undefined, deletedAt: Date | string | null | undefined): string {
  if (deletedAt) return 'unavailable';
  if (!status) return 'unavailable';
  if (status === 'active') return 'available';
  if (status === 'sold' || status === 'reserved' || status === 'archived' || status === 'draft') return status;
  return 'unavailable';
}

/**
 * Walk ancestors. Returns true if moving `folderId` under `newParentId` would
 * create a cycle (A→B→A) or a self-parent.
 */
export function wouldCreateCycle(
  folderId: number,
  newParentId: number | null,
  parentById: Map<number, number | null>,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === folderId) return true;
  const seen = new Set<number>([folderId]);
  let current: number | null = newParentId;
  while (current !== null) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentById.has(current) ? (parentById.get(current) ?? null) : null;
  }
  return false;
}

/** Root collections have depth 1. Nested folders increment. */
export function depthOf(id: number | null, parentById: Map<number, number | null>): number {
  if (id === null) return 0;
  let depth = 1;
  const seen = new Set<number>([id]);
  let current = parentById.get(id) ?? null;
  while (current !== null) {
    if (seen.has(current)) return Number.POSITIVE_INFINITY;
    seen.add(current);
    depth += 1;
    current = parentById.get(current) ?? null;
  }
  return depth;
}

export function childDepthIfMoved(
  folderId: number,
  newParentId: number | null,
  parentById: Map<number, number | null>,
): number {
  const parentDepth = newParentId === null ? 0 : depthOf(newParentId, parentById);
  return parentDepth + 1;
}

export function compareCompatible(params: {
  marketplaceA: number;
  marketplaceB: number;
  entityTypeA: string;
  entityTypeB: string;
}): boolean {
  return params.marketplaceA === params.marketplaceB && params.entityTypeA === params.entityTypeB;
}

export const SORT_SQL: Record<FavoriteSort, string> = {
  newest: 'f.created_at DESC, f.id DESC',
  oldest: 'f.created_at ASC, f.id ASC',
  price_asc: 'COALESCE(l.price, vp.price, f.price_at_save) ASC, f.id DESC',
  price_desc: 'COALESCE(l.price, vp.price, f.price_at_save) DESC, f.id DESC',
};
