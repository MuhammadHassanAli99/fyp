import path from 'node:path';
import { execute, insertAndGetId, queryOne, type Row } from '../../db/query';
import { badRequest, notFound } from '../../core/errors';
import { recordAudit } from '../../middleware/audit';
import { storage } from '../../providers/storage';
import { inspectImage } from './image-inspect';
import { getProfile } from './users.service';

const PROFILE_EDGE = 400;
const THUMB_EDGE = 96;

interface VariantPaths {
  originalPath: string;
  profilePath: string;
  thumbPath: string;
}

function ownedAvatarPath(userId: number, storagePath: string): string {
  const normalized = storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = `avatar/${userId}/`;
  if (!normalized.startsWith(prefix) || normalized.includes('..')) {
    throw badRequest('Upload does not belong to this account');
  }
  return normalized;
}

async function maybeResize(data: Buffer, mimeType: string, edge: number): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const importer = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<{ default?: (input: Buffer) => SharpLike }>;
    const sharpMod = await importer('sharp').catch(() => null);
    const sharp = sharpMod?.default;
    if (!sharp) return { buffer: data, mimeType };
    const buffer = await sharp(data)
      .rotate()
      .resize(edge, edge, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return { buffer, mimeType: 'image/webp' };
  } catch {
    return { buffer: data, mimeType };
  }
}

interface SharpLike {
  rotate: () => SharpLike;
  resize: (w: number, h: number, opts: object) => SharpLike;
  webp: (opts: object) => SharpLike;
  toBuffer: () => Promise<Buffer>;
}

export async function confirmAvatar(userId: number, storagePath: string) {
  const originalPath = ownedAvatarPath(userId, storagePath);
  if (!(await storage.exists(originalPath))) throw badRequest('Upload not found. Sign and upload the image first.');

  const original = await storage.read(originalPath);
  const inspected = inspectImage(original);

  const dir = path.posix.dirname(originalPath);
  const stem = path.posix.basename(originalPath, path.posix.extname(originalPath));
  const variants: VariantPaths = {
    originalPath,
    profilePath: path.posix.join(dir, `${stem}_profile.webp`),
    thumbPath: path.posix.join(dir, `${stem}_thumb.webp`),
  };

  const profile = await maybeResize(original, inspected.mimeType, PROFILE_EDGE);
  const thumb = await maybeResize(original, inspected.mimeType, THUMB_EDGE);

  const profileStored =
    profile.buffer === original
      ? { storagePath: originalPath, fileUrl: storage.publicUrl(originalPath) }
      : await storage.put(variants.profilePath, profile.buffer, profile.mimeType);
  const thumbStored =
    thumb.buffer === original
      ? { storagePath: originalPath, fileUrl: storage.publicUrl(originalPath) }
      : await storage.put(variants.thumbPath, thumb.buffer, thumb.mimeType);

  const previous = await queryOne<Row>(
    `SELECT avatar_url, avatar_image_id FROM user_profiles WHERE user_id = ?`,
    [userId],
  );

  const imageId = await insertAndGetId(
    `INSERT INTO profile_images
       (user_id, kind, original_path, profile_path, thumb_path, original_url, profile_url, thumb_url,
        mime_type, width, height, size_bytes, status)
     VALUES (?, 'avatar', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`,
    [
      userId,
      originalPath,
      profileStored.storagePath,
      thumbStored.storagePath,
      storage.publicUrl(originalPath),
      profileStored.fileUrl,
      thumbStored.fileUrl,
      inspected.mimeType,
      inspected.width,
      inspected.height,
      original.byteLength,
    ],
  );

  await execute(
    `INSERT INTO user_profiles (user_id, avatar_url, avatar_image_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE avatar_url = VALUES(avatar_url), avatar_image_id = VALUES(avatar_image_id)`,
    [userId, profileStored.fileUrl, imageId],
  );

  if (previous?.avatar_image_id) {
    await execute(`UPDATE profile_images SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [
      previous.avatar_image_id,
    ]);
  }

  void recordAudit({
    action: 'profile.image_changed',
    entityType: 'user',
    entityId: userId,
    after: { imageId, mimeType: inspected.mimeType, width: inspected.width, height: inspected.height },
  });

  const { refreshProfileCompleteness } = await import('./users.service');
  await refreshProfileCompleteness(userId).catch(() => undefined);

  return getProfile(userId);
}

export async function deleteAvatar(userId: number) {
  const row = await queryOne<Row>(`SELECT avatar_image_id FROM user_profiles WHERE user_id = ?`, [userId]);
  if (!row) throw notFound('Profile');

  if (row.avatar_image_id) {
    const image = await queryOne<Row>(`SELECT original_path, profile_path, thumb_path FROM profile_images WHERE id = ?`, [
      row.avatar_image_id,
    ]);
    if (image) {
      await Promise.allSettled([
        storage.delete(String(image.original_path)),
        image.profile_path ? storage.delete(String(image.profile_path)) : Promise.resolve(),
        image.thumb_path ? storage.delete(String(image.thumb_path)) : Promise.resolve(),
      ]);
    }
    await execute(`UPDATE profile_images SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [
      row.avatar_image_id,
    ]);
  }

  await execute(`UPDATE user_profiles SET avatar_url = NULL, avatar_image_id = NULL WHERE user_id = ?`, [userId]);
  void recordAudit({ action: 'profile.image_deleted', entityType: 'user', entityId: userId });
  return getProfile(userId);
}
