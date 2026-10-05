import { createHash } from 'node:crypto';
import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { storage } from '../../providers/storage';
import { loggerFor } from '../../config/logger';
import { sha256 } from '../../core/security/crypto';

const log = loggerFor('risk.image');

/** 64-bit average hash of sampled bytes — cheap exact/near-exact duplicate hint when pixels are unavailable. */
export function contentFingerprint(buffer: Buffer): string {
  if (buffer.length === 0) return sha256('empty');
  const samples = Buffer.alloc(64);
  for (let i = 0; i < 64; i += 1) {
    const index = Math.floor((i * (buffer.length - 1)) / 63);
    samples[i] = buffer[index] ?? 0;
  }
  const mean = samples.reduce((sum, n) => sum + n, 0) / 64;
  let bits = '';
  for (const value of samples) bits += value >= mean ? '1' : '0';
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

export async function hashListingMedia(mediaId: number, listingId: number | null): Promise<void> {
  const media = await queryOne<Row>(
    `SELECT id, listing_id, url, perceptual_hash FROM listing_media WHERE id = ?`,
    [mediaId],
  );
  if (!media) return;
  const path = extractStoragePath(String(media.url ?? ''));
  if (!path) return;
  try {
    const buffer = await storage.read(path);
    const digest = sha256(buffer);
    const phash = contentFingerprint(buffer);
    await execute(`UPDATE listing_media SET perceptual_hash = COALESCE(perceptual_hash, ?) WHERE id = ?`, [
      phash,
      mediaId,
    ]);
    await execute(
      `INSERT INTO media_hashes (media_id, listing_id, phash, sha256, first_seen_listing_id)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE phash = VALUES(phash), sha256 = VALUES(sha256)`,
      [mediaId, listingId ?? media.listing_id, phash, digest, listingId ?? media.listing_id],
    );
  } catch (error) {
    log.debug({ err: error, mediaId }, 'media hash skipped');
  }
}

export async function similarMediaListingIds(listingId: number): Promise<number[]> {
  const rows = await queryRows<Row>(
    `SELECT DISTINCT other.listing_id AS listing_id
       FROM media_hashes mine
       JOIN media_hashes other ON (other.phash = mine.phash OR other.sha256 = mine.sha256)
      WHERE mine.listing_id = ? AND other.listing_id IS NOT NULL AND other.listing_id <> mine.listing_id`,
    [listingId],
  );
  return rows.map((row) => Number(row.listing_id)).filter((id) => Number.isFinite(id));
}

function extractStoragePath(url: string): string | null {
  const marker = '/uploads/';
  const index = url.indexOf(marker);
  if (index >= 0) return url.slice(index + marker.length);
  if (url && !url.startsWith('http')) return url.replace(/^\/+/, '');
  return null;
}

export { createHash, insertAndGetId };
