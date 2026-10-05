import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { env } from '../../config/env';
import { cache } from '../../config/cache';
import { loggerFor } from '../../config/logger';
import { execute, queryRows, type Row } from '../../db/query';
import { storage } from '../../providers/storage';
import { ffmpegAvailable, transcodeToHls } from '../../providers/media/ffmpeg';

const log = loggerFor('media.transcode');

function storagePathFromUrl(url: string, objectKey?: string | null): string | null {
  if (objectKey && !objectKey.includes('..')) return objectKey.replace(/^\/+/, '').replace(/\\/g, '/');
  const bases = [env.CDN_PUBLIC_URL, env.STORAGE_PUBLIC_URL].filter((value): value is string => Boolean(value?.trim()));
  for (const base of bases) {
    const prefix = base.replace(/\/+$/, '');
    if (url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}\\`)) {
      return url.slice(prefix.length).replace(/^\/+/, '').replace(/\\/g, '/');
    }
  }
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\/+/, '');
    if (env.S3_BUCKET && pathname.startsWith(`${env.S3_BUCKET}/`)) {
      return pathname.slice(env.S3_BUCKET.length + 1);
    }
    return pathname || null;
  } catch {
    return null;
  }
}

function hlsPrefix(sourcePath: string, id: number): string {
  const dir = path.posix.dirname(sourcePath.replace(/\\/g, '/'));
  return dir && dir !== '.' ? `${dir}/hls/${id}` : `hls/${id}`;
}

async function uploadHls(prefix: string, result: Awaited<ReturnType<typeof transcodeToHls>>) {
  const playlist = await readFile(result.playlistPath);
  await storage.put(`${prefix}/playlist.m3u8`, playlist, 'application/vnd.apple.mpegurl');
  for (const segment of result.segmentPaths) {
    const bytes = await readFile(segment);
    await storage.put(`${prefix}/${path.basename(segment)}`, bytes, 'video/mp2t');
  }
  let posterUrl: string | null = null;
  if (result.posterPath) {
    const poster = await readFile(result.posterPath);
    await storage.put(`${prefix}/poster.jpg`, poster, 'image/jpeg');
    posterUrl = storage.publicUrl(`${prefix}/poster.jpg`);
  }
  return {
    playlistUrl: storage.publicUrl(`${prefix}/playlist.m3u8`),
    posterUrl,
    durationSecs: result.durationSecs,
  };
}

async function transcodeFile(sourcePath: string, prefix: string) {
  const workDir = await mkdtemp(path.join(tmpdir(), 'hls-'));
  const inputPath = path.join(workDir, 'source');
  try {
    const bytes = await storage.read(sourcePath);
    await writeFile(inputPath, bytes);
    const hls = await transcodeToHls(inputPath, workDir);
    return uploadHls(prefix, hls);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function processListingVideos(limit: number): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT id, url FROM listing_media
      WHERE kind = 'video' AND status = 'processing'
      ORDER BY id
      LIMIT ?`,
    [limit],
  );
  let done = 0;
  for (const row of rows) {
    const id = Number(row.id);
    const lockKey = `transcode:lm:${id}`;
    if ((await cache.get<number>(lockKey)) !== null) continue;
    await cache.set(lockKey, 1, 15 * 60);

    const source = storagePathFromUrl(String(row.url));
    if (!source) {
      await execute(`UPDATE listing_media SET status = 'failed' WHERE id = ?`, [id]);
      log.warn({ id }, 'listing video has no storage path');
      continue;
    }
    try {
      const prefix = hlsPrefix(source, id);
      const output = await transcodeFile(source, prefix);
      await execute(
        `UPDATE listing_media
            SET url = ?, thumb_url = COALESCE(?, thumb_url), duration_secs = COALESCE(?, duration_secs),
                mime_type = 'application/vnd.apple.mpegurl', status = 'ready'
          WHERE id = ?`,
        [output.playlistUrl, output.posterUrl, output.durationSecs, id],
      );
      done += 1;
    } catch (error) {
      log.warn({ err: error, id }, 'listing video transcode failed');
      await execute(`UPDATE listing_media SET status = 'failed' WHERE id = ?`, [id]);
    }
  }
  return done;
}

async function processReviewVideos(limit: number): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT id, url, object_key FROM review_media
      WHERE kind = 'video' AND transcode_status IN ('pending', 'processing')
      ORDER BY id
      LIMIT ?`,
    [limit],
  );
  let done = 0;
  for (const row of rows) {
    const id = Number(row.id);
    const claimed = await execute(
      `UPDATE review_media SET transcode_status = 'processing' WHERE id = ? AND transcode_status IN ('pending','processing')`,
      [id],
    );
    if (!claimed.affectedRows) continue;

    const source = storagePathFromUrl(String(row.url), (row.object_key as string | null) ?? null);
    if (!source) {
      await execute(`UPDATE review_media SET transcode_status = 'failed' WHERE id = ?`, [id]);
      continue;
    }
    try {
      const prefix = hlsPrefix(source, id);
      const output = await transcodeFile(source, prefix);
      await execute(
        `UPDATE review_media
            SET url = ?, thumb_url = COALESCE(?, thumb_url), object_key = ?,
                mime_type = 'application/vnd.apple.mpegurl', transcode_status = 'ready',
                moderation_status = 'approved'
          WHERE id = ?`,
        [output.playlistUrl, output.posterUrl, `${prefix}/playlist.m3u8`, id],
      );
      done += 1;
    } catch (error) {
      log.warn({ err: error, id }, 'review video transcode failed');
      await execute(`UPDATE review_media SET transcode_status = 'failed' WHERE id = ?`, [id]);
    }
  }
  return done;
}

/** Process a small batch of pending listing/review videos. No-op without ffmpeg. */
export async function processMediaTranscodes(limit = 2): Promise<number> {
  if (!(await ffmpegAvailable())) return 0;
  const listing = await processListingVideos(limit);
  const remaining = Math.max(0, limit - listing);
  const reviews = remaining > 0 ? await processReviewVideos(remaining) : 0;
  if (listing + reviews > 0) {
    log.info({ listing, reviews }, 'hls transcode batch');
  }
  return listing + reviews;
}
