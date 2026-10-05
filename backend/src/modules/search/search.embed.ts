import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { sha256 } from '../../core/security/crypto';
import { orchestrate } from '../ai/ai.orchestrator';
import { loggerFor } from '../../config/logger';
import { buildSearchDocument, embedTextFor } from './search.document';

const log = loggerFor('search.embed');

export function encodeVector(values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 4);
  for (let i = 0; i < values.length; i += 1) buffer.writeFloatLE(values[i]!, i * 4);
  return buffer;
}

export function decodeVector(buffer: Buffer): number[] {
  const values: number[] = [];
  for (let i = 0; i + 3 < buffer.length; i += 4) values.push(buffer.readFloatLE(i));
  return values;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function embedListingIfNeeded(listingId: number): Promise<void> {
  const document = await buildSearchDocument(listingId);
  if (!document) return;
  const text = embedTextFor(document);
  const contentHash = sha256(text);
  const existing = await queryOne<Row>(
    `SELECT id, content_hash FROM ai_embeddings
      WHERE entity_type = 'listing' AND entity_id = ? AND embedding_kind = 'text'
      LIMIT 1`,
    [listingId],
  );
  if (existing && String(existing.content_hash) === contentHash) {
    await execute('UPDATE listing_search_index SET embedding_id = ? WHERE listing_id = ?', [
      Number(existing.id),
      listingId,
    ]).catch(() => undefined);
    return;
  }

  const orch = await orchestrate(
    {
      task: 'embed',
      skipEntitlement: true,
      skipQuota: true,
      entityType: 'listing',
      entityId: listingId,
      input: { listingId },
    },
    (driver) => driver.embed({ texts: [text] }),
  );
  const result = orch.result;
  const vector = result.vectors[0];
  if (!vector || vector.length === 0) return;
  const encoded = encodeVector(vector);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  await execute(
    `INSERT INTO ai_embeddings (entity_type, entity_id, embedding_kind, model, dimensions, vector_data, vector_norm, content_hash)
     VALUES ('listing', ?, 'text', ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE vector_data = VALUES(vector_data), vector_norm = VALUES(vector_norm),
       content_hash = VALUES(content_hash), model = VALUES(model), dimensions = VALUES(dimensions)`,
    [listingId, result.model, vector.length, encoded, norm, contentHash],
  );

  const row = await queryOne<Row>(
    `SELECT id FROM ai_embeddings WHERE entity_type = 'listing' AND entity_id = ? AND embedding_kind = 'text' LIMIT 1`,
    [listingId],
  );
  if (row) {
    await execute('UPDATE listing_search_index SET embedding_id = ?, content_hash = ? WHERE listing_id = ?', [
      Number(row.id),
      document.contentHash,
      listingId,
    ]).catch(() => undefined);
  }
}

export async function embedPendingListings(limit = 40): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT listing_id FROM listing_search_index
      WHERE embedding_id IS NULL OR content_hash IS NULL
      ORDER BY indexed_at DESC
      LIMIT ?`,
    [limit],
  );
  let count = 0;
  for (const row of rows) {
    try {
      await embedListingIfNeeded(Number(row.listing_id));
      count += 1;
    } catch (error) {
      log.warn({ err: error, listingId: Number(row.listing_id) }, 'listing embed skipped');
    }
  }
  return count;
}

export async function embedQuery(text: string): Promise<number[] | null> {
  if (!text.trim()) return null;
  const orch = await orchestrate(
    { task: 'embed', skipEntitlement: true, skipQuota: true, input: { length: text.length } },
    (driver) => driver.embed({ texts: [text.slice(0, 1000)] }),
  );
  return orch.result.vectors[0] ?? null;
}

export async function loadListingVectors(listingIds: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (listingIds.length === 0) return map;
  const rows = await queryRows<Row>(
    `SELECT entity_id, vector_data FROM ai_embeddings
      WHERE entity_type = 'listing' AND embedding_kind = 'text'
        AND entity_id IN (${listingIds.map(() => '?').join(', ')})`,
    listingIds,
  );
  for (const row of rows) {
    const buffer = row.vector_data as Buffer;
    if (Buffer.isBuffer(buffer)) map.set(Number(row.entity_id), decodeVector(buffer));
  }
  return map;
}
