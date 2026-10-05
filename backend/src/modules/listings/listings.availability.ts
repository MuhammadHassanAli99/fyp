import type { PoolConnection } from '../../db/pool';
import { execute, queryRows, type Row } from '../../db/query';
import { conflict } from '../../core/errors';

export type AvailabilityKind = 'booking' | 'reserved' | 'rented' | 'blocked' | 'maintenance';

export async function listAvailability(listingId: number, from: Date, to: Date) {
  const rows = await queryRows<Row>(
    `SELECT id, kind, starts_at, ends_at, source, source_id, note
       FROM listing_availability_blocks
      WHERE listing_id = ?
        AND starts_at < ?
        AND ends_at > ?
      ORDER BY starts_at`,
    [listingId, to, from],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    kind: String(row.kind),
    startsAt: (row.starts_at as Date).toISOString(),
    endsAt: (row.ends_at as Date).toISOString(),
    source: String(row.source),
    sourceId: row.source_id === null ? null : Number(row.source_id),
    note: (row.note as string | null) ?? null,
  }));
}

export async function addAvailabilityBlock(params: {
  listingId: number;
  kind: AvailabilityKind;
  startsAt: Date;
  endsAt: Date;
  source?: 'listing' | 'property' | 'vehicle' | 'owner' | 'admin' | 'system';
  sourceId?: number | null;
  note?: string | null;
  createdBy?: number | null;
  connection: PoolConnection;
}): Promise<number> {
  if (params.endsAt <= params.startsAt) {
    throw conflict('Availability end must be after start');
  }

  const overlap = await queryRows<Row>(
    `SELECT id FROM listing_availability_blocks
      WHERE listing_id = ?
        AND kind IN ('booking','reserved','rented')
        AND starts_at < ? AND ends_at > ?
      LIMIT 1 FOR UPDATE`,
    [params.listingId, params.endsAt, params.startsAt],
    params.connection,
  );
  if (overlap.length > 0 && (params.kind === 'booking' || params.kind === 'reserved' || params.kind === 'rented')) {
    throw conflict('Those dates overlap an existing reservation');
  }

  const inserted = await execute(
    `INSERT INTO listing_availability_blocks
       (listing_id, kind, starts_at, ends_at, source, source_id, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.listingId,
      params.kind,
      params.startsAt,
      params.endsAt,
      params.source ?? 'listing',
      params.sourceId ?? null,
      params.note ?? null,
      params.createdBy ?? null,
    ],
    params.connection,
  );
  return inserted.insertId;
}

export function isAvailableOn(blocks: Array<{ kind: string; startsAt: Date; endsAt: Date }>, at: Date): boolean {
  return !blocks.some(
    (block) =>
      ['booking', 'reserved', 'rented', 'blocked', 'maintenance'].includes(block.kind) &&
      block.startsAt.getTime() <= at.getTime() &&
      block.endsAt.getTime() > at.getTime(),
  );
}
