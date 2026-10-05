import type { PoolConnection } from '../../db/pool';
import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { toJson } from '../../db/sql';

export interface ListingSnapshot {
  title: string | null;
  description: string | null;
  price: string | number | null;
  currency: string | null;
  categoryId: number;
  operation: string;
  status: string;
  lifecycleStatus: string;
  transactionStatus: string;
  cityId: number | null;
  details?: Record<string, unknown>;
}

export async function nextListingVersion(listingId: number, connection: PoolConnection): Promise<number> {
  const row = await queryOne<Row>(
    'SELECT current_version FROM listings WHERE id = ? FOR UPDATE',
    [listingId],
    connection,
  );
  return Number(row?.current_version ?? 0) + 1;
}

export async function writeListingVersion(params: {
  listingId: number;
  version: number;
  snapshot: ListingSnapshot;
  changedFields: string[];
  changedBy: number | null;
  reason?: string | null;
  connection: PoolConnection;
}): Promise<void> {
  await execute(
    `INSERT INTO listing_versions (listing_id, version, snapshot, changed_fields, changed_by, reason)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      params.listingId,
      params.version,
      JSON.stringify(params.snapshot),
      JSON.stringify(params.changedFields),
      params.changedBy,
      params.reason ?? null,
    ],
    params.connection,
  );
  await execute('UPDATE listings SET current_version = ? WHERE id = ?', [params.version, params.listingId], params.connection);
}

export function snapshotFromRow(row: Row, details?: Record<string, unknown> | null): ListingSnapshot {
  return {
    title: (row.title as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    price: (row.price as string | number | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    categoryId: Number(row.category_id),
    operation: String(row.operation),
    status: String(row.status),
    lifecycleStatus: String(row.lifecycle_status ?? row.status),
    transactionStatus: String(row.transaction_status ?? 'available'),
    cityId: row.city_id === null || row.city_id === undefined ? null : Number(row.city_id),
    details: details ?? undefined,
  };
}

export async function listListingVersions(listingId: number, limit = 50) {
  const rows = await queryRows<Row>(
    `SELECT version, snapshot, changed_fields, changed_by, reason, created_at
       FROM listing_versions
      WHERE listing_id = ?
      ORDER BY version DESC
      LIMIT ?`,
    [listingId, limit],
  );
  return rows.map((row) => ({
    version: Number(row.version),
    snapshot: toJson<ListingSnapshot>(row.snapshot, {
      title: null,
      description: null,
      price: null,
      currency: null,
      categoryId: 0,
      operation: 'sell',
      status: 'draft',
      lifecycleStatus: 'draft',
      transactionStatus: 'available',
      cityId: null,
    }),
    changedFields: toJson<string[]>(row.changed_fields, []),
    changedBy: row.changed_by === null ? null : Number(row.changed_by),
    reason: (row.reason as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}
