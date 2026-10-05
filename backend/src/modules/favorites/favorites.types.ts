import type { CollectionVisibility, FavoriteEntityType, FavoriteSort } from './favorites.rules';

export interface FavoriteRecord {
  id: number;
  userId: number;
  listingId: number | null;
  listingUuid: string | null;
  marketplaceId: number;
  marketplaceCode: string;
  entityType: FavoriteEntityType;
  entityId: number;
  collectionId: number | null;
  note: string | null;
  title: string;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
  priceAtSave: number | null;
  status: string | null;
  availability: string;
  categoryId: number | null;
  categoryName: string | null;
  notifyPriceDrop: boolean;
  notifyStatusChange: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FavoriteCollectionRecord {
  id: number;
  userId: number;
  parentId: number | null;
  marketplaceId: number | null;
  marketplaceCode: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
  isPublic: boolean;
  visibility: CollectionVisibility;
  shareToken: string | null;
  itemCount: number;
  sortOrder: number;
  depth: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListFavoritesQuery {
  page: number;
  perPage: number;
  collectionId?: number | null;
  marketplace?: string | null;
  entityType?: FavoriteEntityType | null;
  categoryId?: number | null;
  q?: string | null;
  sort?: FavoriteSort;
}

export interface ResolvedFavoriteTarget {
  marketplaceId: number;
  marketplaceCode: string;
  entityType: FavoriteEntityType;
  entityId: number;
  listingId: number | null;
  title: string;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
  status: string;
}
