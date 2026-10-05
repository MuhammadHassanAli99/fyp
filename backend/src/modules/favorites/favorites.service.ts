import { execute, insertAndGetId, queryCount, queryOne, queryRows, transaction, type Row } from '../../db/query';
import { toBoolean, toNumber } from '../../db/sql';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { uuid } from '../../core/security/crypto';
import { eventBus } from '../../core/events/event-bus';
import type { DomainEventName, DomainEventPayloads } from '../../core/events/domain-events';
import { emitToUser } from '../../realtime/socket';
import { env } from '../../config/env';
import { createShareToken, revokeShareTokens, type ShareTargetType } from '../share/share.tokens';
import {
  MAX_FOLDER_DEPTH,
  SORT_SQL,
  availabilityFromListing,
  availabilityFromPart,
  childDepthIfMoved,
  isFavoriteEntityType,
  wouldCreateCycle,
  type CollectionVisibility,
  type FavoriteEntityType,
  type FavoriteSort,
} from './favorites.rules';
import type {
  FavoriteCollectionRecord,
  FavoriteRecord,
  ListFavoritesQuery,
  ResolvedFavoriteTarget,
} from './favorites.types';

const DEFAULT_COLLECTION_NAME = 'Saved';

async function publish<K extends DomainEventName>(
  name: K,
  aggregateType: string,
  aggregateId: number,
  payload: DomainEventPayloads[K],
): Promise<void> {
  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, name, aggregateType, aggregateId, payload);
    void eventBus.publishAfterCommit(event);
  });
}

function emitFavoriteRealtime(userId: number, event: string, payload: unknown): void {
  emitToUser(userId, event, payload);
}

async function loadParentMap(userId: number): Promise<Map<number, number | null>> {
  const rows = await queryRows<Row>('SELECT id, parent_id FROM favorite_collections WHERE user_id = ?', [userId]);
  return new Map(rows.map((row) => [Number(row.id), row.parent_id === null ? null : Number(row.parent_id)]));
}

async function assertCollectionOwned(userId: number, collectionId: number | null): Promise<Row | null> {
  if (collectionId === null) return null;
  const row = await queryOne<Row>('SELECT * FROM favorite_collections WHERE id = ?', [collectionId]);
  if (!row) throw notFound('Collection');
  if (Number(row.user_id) !== userId) throw forbidden('This collection belongs to someone else');
  return row;
}

async function refreshCollectionCount(collectionId: number | null, connection?: Parameters<typeof execute>[2]): Promise<void> {
  if (collectionId === null) return;
  await execute(
    `UPDATE favorite_collections
        SET item_count = (SELECT COUNT(*) FROM favorites WHERE collection_id = ?)
      WHERE id = ?`,
    [collectionId, collectionId],
    connection,
  );
}

export async function ensureDefaultCollection(userId: number): Promise<number> {
  const existing = await queryOne<Row>(
    'SELECT id FROM favorite_collections WHERE user_id = ? AND is_default = 1 ORDER BY id LIMIT 1',
    [userId],
  );
  if (existing) return Number(existing.id);

  return insertAndGetId(
    `INSERT INTO favorite_collections (user_id, name, is_default, visibility, sort_order)
     VALUES (?, ?, 1, 'private', 0)`,
    [userId, DEFAULT_COLLECTION_NAME],
  );
}

async function resolveTarget(input: {
  listingId?: number;
  entityType?: string;
  entityId?: number;
  marketplaceId?: number;
}): Promise<ResolvedFavoriteTarget> {
  if (input.listingId) {
    const listing = await queryOne<Row>(
      `SELECT l.id, l.marketplace_id, l.title, l.price, l.currency, l.status, l.deleted_at, m.code AS marketplace_code,
              (SELECT lm.thumb_url FROM listing_media lm WHERE lm.listing_id = l.id AND lm.is_primary = 1 LIMIT 1) AS image_url
         FROM listings l
         JOIN marketplaces m ON m.id = l.marketplace_id
        WHERE l.id = ?`,
      [input.listingId],
    );
    if (!listing || listing.deleted_at) throw notFound('Listing');
    if (String(listing.status) === 'draft') throw badRequest('Draft listings cannot be saved');
    return {
      marketplaceId: Number(listing.marketplace_id),
      marketplaceCode: String(listing.marketplace_code),
      entityType: 'listing',
      entityId: Number(listing.id),
      listingId: Number(listing.id),
      title: String(listing.title),
      imageUrl: (listing.image_url as string | null) ?? null,
      price: toNumber(listing.price),
      currency: (listing.currency as string | null) ?? null,
      status: String(listing.status),
    };
  }

  if (input.entityType === 'vehicle_part' && input.entityId) {
    const part = await queryOne<Row>(
      `SELECT vp.id, vp.name, vp.price, vp.currency, vp.status, vp.deleted_at, vp.listing_id, m.id AS marketplace_id, m.code AS marketplace_code
         FROM vehicle_parts vp
         JOIN marketplaces m ON m.code = 'vehicles'
        WHERE vp.id = ?`,
      [input.entityId],
    );
    if (!part || part.deleted_at) throw notFound('Vehicle part');
    if (String(part.status) === 'draft') throw badRequest('Draft parts cannot be saved');
    return {
      marketplaceId: Number(part.marketplace_id),
      marketplaceCode: String(part.marketplace_code),
      entityType: 'vehicle_part',
      entityId: Number(part.id),
      listingId: part.listing_id === null ? null : Number(part.listing_id),
      title: String(part.name),
      imageUrl: null,
      price: toNumber(part.price),
      currency: (part.currency as string | null) ?? null,
      status: String(part.status),
    };
  }

  if (input.entityType && !isFavoriteEntityType(input.entityType)) {
    throw badRequest('Unsupported entity type');
  }

  throw badRequest('Specify listingId or entityType and entityId');
}

function mapFavorite(row: Row): FavoriteRecord {
  const entityType = (row.entity_type as FavoriteEntityType) ?? 'listing';
  const listingStatus = (row.listing_status as string | null) ?? null;
  const listingDeleted = (row.listing_deleted_at as Date | null) ?? null;
  const partStatus = (row.part_status as string | null) ?? null;
  const partDeleted = (row.part_deleted_at as Date | null) ?? null;
  const availability =
    entityType === 'vehicle_part'
      ? availabilityFromPart(partStatus, partDeleted)
      : availabilityFromListing(listingStatus, listingDeleted);

  const title =
    (row.listing_title as string | null) ??
    (row.part_name as string | null) ??
    (row.title_snapshot as string | null) ??
    'Saved item';

  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    listingId: row.listing_id === null || row.listing_id === undefined ? null : Number(row.listing_id),
    listingUuid: (row.listing_uuid as string | null) ?? null,
    marketplaceId: Number(row.marketplace_id),
    marketplaceCode: String(row.marketplace_code ?? ''),
    entityType,
    entityId: Number(row.entity_id),
    collectionId: row.collection_id === null ? null : Number(row.collection_id),
    note: (row.note as string | null) ?? null,
    title,
    imageUrl: (row.image_url as string | null) ?? (row.image_url_snapshot as string | null) ?? null,
    price: toNumber(row.current_price) ?? toNumber(row.price_at_save),
    currency: (row.current_currency as string | null) ?? (row.currency as string | null) ?? null,
    priceAtSave: toNumber(row.price_at_save),
    status: listingStatus ?? partStatus,
    availability,
    categoryId: row.category_id === null || row.category_id === undefined ? null : Number(row.category_id),
    categoryName: (row.category_name as string | null) ?? null,
    notifyPriceDrop: toBoolean(row.notify_price_drop) ?? true,
    notifyStatusChange: toBoolean(row.notify_status_change) ?? true,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

const FAVORITE_SELECT = `
  SELECT f.id, f.user_id, f.listing_id, f.marketplace_id, f.entity_type, f.entity_id, f.collection_id,
         f.note, f.title_snapshot, f.image_url_snapshot, f.price_at_save, f.currency,
         f.notify_price_drop, f.notify_status_change, f.created_at, f.updated_at,
         m.code AS marketplace_code,
         l.uuid AS listing_uuid, l.title AS listing_title, l.price AS current_price, l.currency AS current_currency,
         l.status AS listing_status, l.deleted_at AS listing_deleted_at, l.category_id,
         c.name AS category_name,
         vp.name AS part_name, vp.price AS part_price, vp.status AS part_status, vp.deleted_at AS part_deleted_at,
         COALESCE(
           (SELECT lm.thumb_url FROM listing_media lm WHERE lm.listing_id = f.listing_id AND lm.is_primary = 1 LIMIT 1),
           f.image_url_snapshot
         ) AS image_url
    FROM favorites f
    JOIN marketplaces m ON m.id = f.marketplace_id
    LEFT JOIN listings l ON l.id = f.listing_id
    LEFT JOIN categories c ON c.id = l.category_id
    LEFT JOIN vehicle_parts vp ON f.entity_type = 'vehicle_part' AND vp.id = f.entity_id
`;

export async function listFavorites(userId: number, query: ListFavoritesQuery) {
  const page = Math.max(1, query.page);
  const perPage = Math.min(100, Math.max(1, query.perPage));
  const sort: FavoriteSort = query.sort && SORT_SQL[query.sort] ? query.sort : 'newest';
  const where: string[] = ['f.user_id = ?'];
  const params: unknown[] = [userId];

  if (query.collectionId) {
    where.push('f.collection_id = ?');
    params.push(query.collectionId);
  }
  if (query.marketplace) {
    where.push('m.code = ?');
    params.push(query.marketplace);
  }
  if (query.entityType && isFavoriteEntityType(query.entityType)) {
    where.push('f.entity_type = ?');
    params.push(query.entityType);
  }
  if (query.categoryId) {
    where.push('l.category_id = ?');
    params.push(query.categoryId);
  }
  if (query.q && query.q.trim().length > 0) {
    const like = `%${query.q.trim().slice(0, 120)}%`;
    where.push('(COALESCE(l.title, vp.name, f.title_snapshot) LIKE ?)');
    params.push(like);
  }

  const whereSql = where.join(' AND ');
  const total = await queryCount(`SELECT COUNT(*) FROM favorites f JOIN marketplaces m ON m.id = f.marketplace_id LEFT JOIN listings l ON l.id = f.listing_id LEFT JOIN vehicle_parts vp ON f.entity_type = 'vehicle_part' AND vp.id = f.entity_id WHERE ${whereSql}`, params);

  const rows = await queryRows<Row>(
    `${FAVORITE_SELECT}
      WHERE ${whereSql}
      ORDER BY ${SORT_SQL[sort]}
      LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage],
  );

  return {
    items: rows.map(mapFavorite),
    total,
    page,
    perPage,
  };
}

export async function getFavorite(userId: number, favoriteId: number): Promise<FavoriteRecord> {
  const row = await queryOne<Row>(`${FAVORITE_SELECT} WHERE f.id = ?`, [favoriteId]);
  if (!row) throw notFound('Favorite');
  if (Number(row.user_id) !== userId) throw forbidden('This favorite belongs to someone else');
  return mapFavorite(row);
}

export async function favoriteStatus(
  userId: number,
  input: { listingId?: number; entityType?: string; entityId?: number },
): Promise<{ saved: boolean; favoriteId: number | null }> {
  let row: Row | null = null;
  if (input.listingId) {
    row = await queryOne<Row>(
      `SELECT id FROM favorites WHERE user_id = ? AND entity_type = 'listing' AND entity_id = ?`,
      [userId, input.listingId],
    );
  } else if (input.entityType && input.entityId) {
    row = await queryOne<Row>(
      `SELECT id FROM favorites WHERE user_id = ? AND entity_type = ? AND entity_id = ?`,
      [userId, input.entityType, input.entityId],
    );
  } else {
    throw badRequest('Specify listingId or entityType and entityId');
  }
  return { saved: Boolean(row), favoriteId: row ? Number(row.id) : null };
}

export async function addFavorite(
  userId: number,
  input: {
    listingId?: number;
    entityType?: string;
    entityId?: number;
    marketplaceId?: number;
    collectionId?: number | null;
    note?: string | null;
  },
): Promise<{ saved: true; created: boolean; favorite: FavoriteRecord }> {
  const target = await resolveTarget(input);
  const collection = await assertCollectionOwned(userId, input.collectionId ?? null);
  if (collection?.marketplace_id !== undefined && collection.marketplace_id !== null) {
    if (Number(collection.marketplace_id) !== target.marketplaceId) {
      throw badRequest('This collection only accepts items from its marketplace');
    }
  }

  await ensureDefaultCollection(userId);

  const existing = await queryOne<Row>(
    `SELECT id, collection_id FROM favorites
      WHERE user_id = ? AND marketplace_id = ? AND entity_type = ? AND entity_id = ?`,
    [userId, target.marketplaceId, target.entityType, target.entityId],
  );

  if (existing) {
    if (input.collectionId && Number(existing.collection_id) !== input.collectionId) {
      await moveFavorite(userId, Number(existing.id), input.collectionId);
    }
    const favorite = await getFavorite(userId, Number(existing.id));
    return { saved: true, created: false, favorite };
  }

  const id = await transaction(async (connection) => {
    const inserted = await insertAndGetId(
      `INSERT INTO favorites
         (user_id, listing_id, marketplace_id, entity_type, entity_id, collection_id, note,
          title_snapshot, image_url_snapshot, price_at_save, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        target.listingId,
        target.marketplaceId,
        target.entityType,
        target.entityId,
        input.collectionId ?? null,
        input.note ?? null,
        target.title,
        target.imageUrl,
        target.price,
        target.currency,
      ],
      connection,
    );

    if (target.listingId) {
      await execute('UPDATE listings SET favorite_count = favorite_count + 1 WHERE id = ?', [target.listingId], connection).catch(
        () => undefined,
      );
    }
    await refreshCollectionCount(input.collectionId ?? null, connection);

    const event = await eventBus.enqueue(connection, 'favorite.added', 'favorite', inserted, {
      userId,
      favoriteId: inserted,
      listingId: target.listingId,
      marketplaceId: target.marketplaceId,
      entityType: target.entityType,
      entityId: target.entityId,
      collectionId: input.collectionId ?? null,
    });
    void eventBus.publishAfterCommit(event);
    return inserted;
  });

  const favorite = await getFavorite(userId, id);
  emitFavoriteRealtime(userId, 'favorite:created', favorite);
  return { saved: true, created: true, favorite };
}

export async function removeFavorite(userId: number, favoriteId: number): Promise<{ removed: boolean; listingId: number | null }> {
  const row = await queryOne<Row>('SELECT * FROM favorites WHERE id = ?', [favoriteId]);
  if (!row) throw notFound('Favorite');
  if (Number(row.user_id) !== userId) throw forbidden('This favorite belongs to someone else');

  const listingId = row.listing_id === null ? null : Number(row.listing_id);
  const collectionId = row.collection_id === null ? null : Number(row.collection_id);

  await transaction(async (connection) => {
    await execute('DELETE FROM favorites WHERE id = ? AND user_id = ?', [favoriteId, userId], connection);
    if (listingId) {
      await execute('UPDATE listings SET favorite_count = GREATEST(favorite_count - 1, 0) WHERE id = ?', [listingId], connection).catch(
        () => undefined,
      );
    }
    await refreshCollectionCount(collectionId, connection);
    const event = await eventBus.enqueue(connection, 'favorite.removed', 'favorite', favoriteId, {
      userId,
      favoriteId,
      listingId,
      marketplaceId: Number(row.marketplace_id),
      entityType: String(row.entity_type),
      entityId: Number(row.entity_id),
    });
    void eventBus.publishAfterCommit(event);
  });

  emitFavoriteRealtime(userId, 'favorite:removed', { id: favoriteId, listingId });
  return { removed: true, listingId };
}

export async function removeFavoriteByEntity(
  userId: number,
  input: { listingId?: number; entityType?: string; entityId?: number },
): Promise<{ removed: boolean }> {
  const status = await favoriteStatus(userId, input);
  if (!status.favoriteId) return { removed: false };
  await removeFavorite(userId, status.favoriteId);
  return { removed: true };
}

export async function moveFavorite(userId: number, favoriteId: number, collectionId: number | null): Promise<FavoriteRecord> {
  const favorite = await queryOne<Row>('SELECT * FROM favorites WHERE id = ?', [favoriteId]);
  if (!favorite) throw notFound('Favorite');
  if (Number(favorite.user_id) !== userId) throw forbidden('This favorite belongs to someone else');

  const collection = await assertCollectionOwned(userId, collectionId);
  if (collection?.marketplace_id !== undefined && collection.marketplace_id !== null) {
    if (Number(collection.marketplace_id) !== Number(favorite.marketplace_id)) {
      throw badRequest('This collection only accepts items from its marketplace');
    }
  }

  const previous = favorite.collection_id === null ? null : Number(favorite.collection_id);
  await transaction(async (connection) => {
    await execute('UPDATE favorites SET collection_id = ? WHERE id = ?', [collectionId, favoriteId], connection);
    await refreshCollectionCount(previous, connection);
    await refreshCollectionCount(collectionId, connection);
    const event = await eventBus.enqueue(connection, 'favorite.moved', 'favorite', favoriteId, {
      userId,
      favoriteId,
      fromCollectionId: previous,
      toCollectionId: collectionId,
    });
    void eventBus.publishAfterCommit(event);
  });

  const mapped = await getFavorite(userId, favoriteId);
  emitFavoriteRealtime(userId, 'collection:updated', { favoriteId, collectionId });
  return mapped;
}

export async function updateFavorite(
  userId: number,
  favoriteId: number,
  input: { note?: string | null; notifyPriceDrop?: boolean; notifyStatusChange?: boolean },
): Promise<FavoriteRecord> {
  await getFavorite(userId, favoriteId);
  await execute(
    `UPDATE favorites
        SET note = COALESCE(?, note),
            notify_price_drop = COALESCE(?, notify_price_drop),
            notify_status_change = COALESCE(?, notify_status_change)
      WHERE id = ? AND user_id = ?`,
    [
      input.note === undefined ? null : input.note,
      input.notifyPriceDrop === undefined ? null : input.notifyPriceDrop,
      input.notifyStatusChange === undefined ? null : input.notifyStatusChange,
      favoriteId,
      userId,
    ],
  );
  return getFavorite(userId, favoriteId);
}

function mapCollection(row: Row, depth = 1): FavoriteCollectionRecord {
  const visibility = (row.visibility as CollectionVisibility) ?? (row.is_public === 1 ? 'public' : 'private');
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    marketplaceId: row.marketplace_id === null || row.marketplace_id === undefined ? null : Number(row.marketplace_id),
    marketplaceCode: (row.marketplace_code as string | null) ?? null,
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    icon: (row.icon as string | null) ?? null,
    color: (row.color as string | null) ?? null,
    isDefault: row.is_default === 1,
    isPublic: visibility === 'public',
    visibility,
    shareToken: (row.share_token as string | null) ?? null,
    itemCount: Number(row.item_count ?? 0),
    sortOrder: Number(row.sort_order ?? 0),
    depth,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export async function listCollections(userId: number): Promise<FavoriteCollectionRecord[]> {
  await ensureDefaultCollection(userId);
  const rows = await queryRows<Row>(
    `SELECT c.*, m.code AS marketplace_code
       FROM favorite_collections c
       LEFT JOIN marketplaces m ON m.id = c.marketplace_id
      WHERE c.user_id = ?
      ORDER BY c.is_default DESC, c.sort_order, c.name`,
    [userId],
  );
  const parentById = new Map(rows.map((row) => [Number(row.id), row.parent_id === null ? null : Number(row.parent_id)]));
  return rows.map((row) => mapCollection(row, depthOfSafe(Number(row.id), parentById)));
}

function depthOfSafe(id: number, parentById: Map<number, number | null>): number {
  let depth = 1;
  const seen = new Set<number>([id]);
  let current = parentById.get(id) ?? null;
  while (current !== null) {
    if (seen.has(current)) return depth;
    seen.add(current);
    depth += 1;
    current = parentById.get(current) ?? null;
  }
  return depth;
}

export async function getCollection(
  userId: number | null,
  collectionId: number,
  options: { shareToken?: string | null } = {},
): Promise<{ collection: FavoriteCollectionRecord; items: FavoriteRecord[] }> {
  const row = await queryOne<Row>(
    `SELECT c.*, m.code AS marketplace_code
       FROM favorite_collections c
       LEFT JOIN marketplaces m ON m.id = c.marketplace_id
      WHERE c.id = ?`,
    [collectionId],
  );
  if (!row) throw notFound('Collection');

  const ownerId = Number(row.user_id);
  const visibility = (row.visibility as CollectionVisibility) ?? 'private';
  const isOwner = userId !== null && ownerId === userId;
  const tokenOk =
    Boolean(options.shareToken) &&
    row.share_token === options.shareToken &&
    (row.share_expires_at === null || new Date(row.share_expires_at as Date) > new Date());

  if (!isOwner) {
    if (visibility === 'private') throw forbidden('This collection is private');
    if (visibility === 'shared' && !tokenOk) throw forbidden('This collection is not publicly listed');
  }

  const parentById = await loadParentMap(ownerId);
  const collection = mapCollection(row, depthOfSafe(collectionId, parentById));
  const items = isOwner
    ? (await listFavorites(ownerId, { page: 1, perPage: 50, collectionId })).items
    : (await listFavorites(ownerId, { page: 1, perPage: 50, collectionId })).items;

  return { collection, items };
}

export async function createCollection(
  userId: number,
  input: {
    name: string;
    description?: string | null;
    parentId?: number | null;
    marketplaceId?: number | null;
    icon?: string | null;
    color?: string | null;
  },
): Promise<FavoriteCollectionRecord> {
  await ensureDefaultCollection(userId);
  if (input.parentId) {
    await assertCollectionOwned(userId, input.parentId);
    const parentById = await loadParentMap(userId);
    const nextDepth = childDepthIfMoved(-1, input.parentId, parentById);
    if (nextDepth > MAX_FOLDER_DEPTH) {
      throw badRequest(`Folders cannot nest more than ${MAX_FOLDER_DEPTH} levels`);
    }
  }

  if (input.marketplaceId) {
    const marketplace = await queryOne<Row>('SELECT id FROM marketplaces WHERE id = ?', [input.marketplaceId]);
    if (!marketplace) throw notFound('Marketplace');
  }

  const duplicate = await queryOne<Row>(
    `SELECT id FROM favorite_collections
      WHERE user_id = ? AND name = ? AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)`,
    [userId, input.name, input.parentId ?? null, input.parentId ?? null],
  );
  if (duplicate) throw conflict('A collection with this name already exists here');

  const id = await insertAndGetId(
    `INSERT INTO favorite_collections
       (user_id, marketplace_id, parent_id, name, description, icon, color, visibility, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'private', 100)`,
    [
      userId,
      input.marketplaceId ?? null,
      input.parentId ?? null,
      input.name,
      input.description ?? null,
      input.icon ?? null,
      input.color ?? null,
    ],
  );

  await publish('collection.created', 'favorite_collection', id, { userId, collectionId: id, name: input.name });
  emitFavoriteRealtime(userId, 'collection:updated', { collectionId: id, action: 'created' });
  const created = (await listCollections(userId)).find((item) => item.id === id);
  return created!;
}

export async function updateCollection(
  userId: number,
  collectionId: number,
  input: {
    name?: string;
    description?: string | null;
    parentId?: number | null;
    marketplaceId?: number | null;
    icon?: string | null;
    color?: string | null;
    sortOrder?: number;
  },
): Promise<FavoriteCollectionRecord> {
  const current = await assertCollectionOwned(userId, collectionId);
  if (!current) throw notFound('Collection');
  if (current.is_default === 1 && input.parentId) {
    throw badRequest('The default collection cannot be nested');
  }

  if (input.parentId !== undefined) {
    const parentById = await loadParentMap(userId);
    if (wouldCreateCycle(collectionId, input.parentId, parentById)) {
      throw badRequest('A folder cannot contain itself');
    }
    const nextDepth = childDepthIfMoved(collectionId, input.parentId, parentById);
    if (nextDepth > MAX_FOLDER_DEPTH) {
      throw badRequest(`Folders cannot nest more than ${MAX_FOLDER_DEPTH} levels`);
    }
    if (input.parentId) await assertCollectionOwned(userId, input.parentId);
  }

  await execute(
    `UPDATE favorite_collections
        SET name = COALESCE(?, name),
            description = COALESCE(?, description),
            parent_id = ?,
            marketplace_id = COALESCE(?, marketplace_id),
            icon = COALESCE(?, icon),
            color = COALESCE(?, color),
            sort_order = COALESCE(?, sort_order)
      WHERE id = ? AND user_id = ?`,
    [
      input.name ?? null,
      input.description === undefined ? null : input.description,
      input.parentId === undefined ? current.parent_id : input.parentId,
      input.marketplaceId ?? null,
      input.icon ?? null,
      input.color ?? null,
      input.sortOrder ?? null,
      collectionId,
      userId,
    ],
  );

  await publish('collection.updated', 'favorite_collection', collectionId, { userId, collectionId });
  emitFavoriteRealtime(userId, 'collection:updated', { collectionId, action: 'updated' });
  return (await listCollections(userId)).find((item) => item.id === collectionId)!;
}

export async function deleteCollection(userId: number, collectionId: number): Promise<void> {
  const current = await assertCollectionOwned(userId, collectionId);
  if (!current) throw notFound('Collection');
  if (current.is_default === 1) throw badRequest('The default collection cannot be deleted');

  await transaction(async (connection) => {
    await execute('UPDATE favorites SET collection_id = NULL WHERE collection_id = ? AND user_id = ?', [collectionId, userId], connection);
    await execute('DELETE FROM favorite_collections WHERE id = ? AND user_id = ?', [collectionId, userId], connection);
    const event = await eventBus.enqueue(connection, 'collection.deleted', 'favorite_collection', collectionId, {
      userId,
      collectionId,
    });
    void eventBus.publishAfterCommit(event);
  });
  emitFavoriteRealtime(userId, 'collection:updated', { collectionId, action: 'deleted' });
}

export async function reorderCollections(
  userId: number,
  items: Array<{ id: number; sortOrder: number; parentId?: number | null }>,
): Promise<FavoriteCollectionRecord[]> {
  const parentById = await loadParentMap(userId);
  for (const item of items) {
    await assertCollectionOwned(userId, item.id);
    if (item.parentId !== undefined) {
      if (wouldCreateCycle(item.id, item.parentId, parentById)) {
        throw badRequest('A folder cannot contain itself');
      }
      const nextDepth = childDepthIfMoved(item.id, item.parentId, parentById);
      if (nextDepth > MAX_FOLDER_DEPTH) {
        throw badRequest(`Folders cannot nest more than ${MAX_FOLDER_DEPTH} levels`);
      }
    }
  }

  await transaction(async (connection) => {
    for (const item of items) {
      await execute(
        `UPDATE favorite_collections
            SET sort_order = ?, parent_id = COALESCE(?, parent_id)
          WHERE id = ? AND user_id = ?`,
        [item.sortOrder, item.parentId ?? null, item.id, userId],
        connection,
      );
    }
  });

  emitFavoriteRealtime(userId, 'collection:updated', { action: 'reordered' });
  return listCollections(userId);
}

export async function shareFavoriteResource(
  userId: number,
  input: { targetType: ShareTargetType; targetId: number; accessPolicy?: 'public' | 'restricted'; expiresAt?: Date | null },
): Promise<{ token: string; url: string; visibility?: CollectionVisibility }> {
  if (input.targetType === 'collection') {
    const collection = await assertCollectionOwned(userId, input.targetId);
    if (!collection) throw notFound('Collection');
    const visibility: CollectionVisibility = input.accessPolicy === 'restricted' ? 'shared' : 'public';
    const token = uuid();
    const expiresAt = input.expiresAt ?? null;
    await execute(
      `UPDATE favorite_collections
          SET share_token = ?, visibility = ?, is_public = ?, share_expires_at = ?
        WHERE id = ? AND user_id = ?`,
      [token, visibility, visibility === 'public' ? 1 : 0, expiresAt, input.targetId, userId],
    );
    const created = await createShareToken({
      ownerUserId: userId,
      targetType: 'collection',
      targetId: input.targetId,
      accessPolicy: input.accessPolicy ?? 'public',
      expiresAt,
      token,
    });
    await publish('favorite.shared', 'favorite_collection', input.targetId, {
      userId,
      targetType: 'collection',
      targetId: input.targetId,
      token: created.token,
    });
    return { token: created.token, url: shareUrl(created.token), visibility };
  }

  if (input.targetType === 'favorite') {
    await getFavorite(userId, input.targetId);
  } else if (input.targetType === 'listing') {
    const listing = await queryOne<Row>('SELECT id, status, deleted_at FROM listings WHERE id = ?', [input.targetId]);
    if (!listing || listing.deleted_at) throw notFound('Listing');
  } else if (input.targetType === 'comparison') {
    const set = await queryOne<Row>('SELECT id, user_id FROM comparison_sets WHERE id = ?', [input.targetId]);
    if (!set) throw notFound('Comparison');
    if (set.user_id !== null && Number(set.user_id) !== userId) throw forbidden('This comparison belongs to someone else');
  }

  const created = await createShareToken({
    ownerUserId: userId,
    targetType: input.targetType,
    targetId: input.targetId,
    accessPolicy: input.accessPolicy ?? 'public',
    expiresAt: input.expiresAt ?? null,
  });
  await publish('favorite.shared', input.targetType === 'listing' ? 'listing' : input.targetType, input.targetId, {
    userId,
    targetType: input.targetType,
    targetId: input.targetId,
    token: created.token,
  });
  return { token: created.token, url: shareUrl(created.token) };
}

export async function unshareCollection(userId: number, collectionId: number): Promise<void> {
  await assertCollectionOwned(userId, collectionId);
  await execute(
    `UPDATE favorite_collections
        SET share_token = NULL, visibility = 'private', is_public = 0, share_expires_at = NULL
      WHERE id = ? AND user_id = ?`,
    [collectionId, userId],
  );
  await revokeShareTokens('collection', collectionId, userId);
}

export function shareUrl(token: string): string {
  const web = env.WEB_URL.replace(/\/$/, '');
  return `${web}/share/${token}`;
}
