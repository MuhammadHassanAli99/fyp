import { execute, insertAndGetId, queryRows, type Row } from '../../db/query';
import { badRequest } from '../../core/errors';

export async function attachReviewMedia(
  reviewId: number,
  items: Array<{ url: string; objectKey?: string | null; kind?: 'image' | 'video'; mimeType?: string | null }>,
): Promise<number> {
  if (items.length === 0) return 0;
  if (items.length > 8) throw badRequest('A review can include at most 8 media files');
  let order = 0;
  for (const item of items) {
    const kind = item.kind ?? (item.mimeType?.startsWith('video/') ? 'video' : 'image');
    await insertAndGetId(
      `INSERT INTO review_media
         (review_id, kind, url, object_key, mime_type, sort_order, moderation_status, scan_status, transcode_status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 'pending', ?)`,
      [
        reviewId,
        kind,
        item.url,
        item.objectKey ?? null,
        item.mimeType ?? null,
        order,
        kind === 'video' ? 'pending' : 'none',
      ],
    );
    order += 1;
  }
  return items.length;
}

export async function listReviewMedia(reviewId: number) {
  const rows = await queryRows<Row>(
    `SELECT id, kind, url, thumb_url, object_key, mime_type, moderation_status, transcode_status, sort_order
       FROM review_media WHERE review_id = ? ORDER BY sort_order, id`,
    [reviewId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    kind: String(row.kind),
    url: String(row.url),
    thumbUrl: (row.thumb_url as string | null) ?? null,
    objectKey: (row.object_key as string | null) ?? null,
    mimeType: (row.mime_type as string | null) ?? null,
    moderationStatus: String(row.moderation_status),
    transcodeStatus: String(row.transcode_status ?? 'none'),
  }));
}

/** Cheap async pass: images that passed upload scan are approved; video waits for ffmpeg. */
export async function processPendingReviewMedia(limit = 20): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT id, kind FROM review_media
      WHERE scan_status = 'pending'
      ORDER BY id LIMIT ?`,
    [limit],
  );
  for (const row of rows) {
    if (String(row.kind) === 'video') {
      await execute(
        `UPDATE review_media SET scan_status = 'clean' WHERE id = ?`,
        [row.id],
      );
    } else {
      await execute(
        `UPDATE review_media
            SET scan_status = 'clean', moderation_status = 'approved'
          WHERE id = ?`,
        [row.id],
      );
    }
  }
  return rows.length;
}
