import path from 'node:path';
import { env } from '../../config/env';
import { badRequest } from '../../core/errors';
import { storage, verifyUploadToken, markUploadTokenConsumed, type StoragePurpose } from '../../providers/storage';
import { uuid } from '../../core/security/crypto';
import { mediaScan } from '../../providers/media-scan';

const PURPOSE_MAX_BYTES: Record<StoragePurpose, number> = {
  listing_media: 10 * 1024 * 1024,
  avatar: 5 * 1024 * 1024,
  cover: 8 * 1024 * 1024,
  document: 15 * 1024 * 1024,
  verification: 15 * 1024 * 1024,
  review_media: 25 * 1024 * 1024,
  ad_creative: 25 * 1024 * 1024,
  chat_attachment: 25 * 1024 * 1024,
  search_image: 8 * 1024 * 1024,
  search_voice: 12 * 1024 * 1024,
};

const ALLOWED_MIME: Record<StoragePurpose, string[]> = {
  listing_media: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
  avatar: ['image/jpeg', 'image/png', 'image/webp'],
  cover: ['image/jpeg', 'image/png', 'image/webp'],
  document: ['application/pdf', 'image/jpeg', 'image/png'],
  verification: ['application/pdf', 'image/jpeg', 'image/png'],
  review_media: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'],
  ad_creative: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'],
  chat_attachment: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/mp4',
    'audio/m4a',
    'audio/aac',
    'audio/webm',
    'audio/wav',
    'audio/x-m4a',
    'audio/ogg',
  ],
  search_image: ['image/jpeg', 'image/png', 'image/webp'],
  search_voice: [
    'audio/mpeg',
    'audio/mp4',
    'audio/m4a',
    'audio/aac',
    'audio/webm',
    'audio/wav',
    'audio/x-m4a',
    'audio/ogg',
  ],
};

export async function signUpload(userId: number, input: {
  purpose: StoragePurpose;
  mimeType: string;
  sizeBytes: number;
  filename?: string | null;
}) {
  const maxBytes = PURPOSE_MAX_BYTES[input.purpose];
  if (input.sizeBytes <= 0 || input.sizeBytes > maxBytes) {
    throw badRequest(`File size must be between 1 byte and ${maxBytes} bytes`);
  }

  const allowed = ALLOWED_MIME[input.purpose];
  if (!allowed.includes(input.mimeType)) {
    throw badRequest(`MIME type ${input.mimeType} is not allowed for ${input.purpose}`);
  }

  const ext = path.extname(input.filename ?? '').slice(0, 16) || guessExt(input.mimeType);
  const storagePath = path.posix.join(input.purpose, String(userId), `${uuid()}${ext}`);

  return storage.sign({
    purpose: input.purpose,
    storagePath,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    maxBytes,
    ttlSeconds: 900,
  });
}

export async function relayLocalUpload(token: string, data: Buffer, contentType: string) {
  const claims = await verifyUploadToken(token);
  if (data.byteLength > claims.maxBytes) throw badRequest('Uploaded file exceeds the signed size limit');
  const expected = claims.mimeType.toLowerCase();
  const actual = (contentType || expected).toLowerCase();
  // Allow octet-stream (some clients strip mime) as long as size matches the signed plan.
  if (actual && actual !== expected && actual !== 'application/octet-stream') {
    throw badRequest('Content-Type does not match the signed upload');
  }

  const scan = await mediaScan.scan({
    buffer: data,
    claimedMime: claims.mimeType,
    purpose: scanPurpose(claims.storagePath),
  });
  if (scan.verdict === 'blocked') {
    throw badRequest('This file failed media security checks');
  }
  if (scan.verdict === 'suspicious' && (claims.storagePath.startsWith('verification/') || claims.storagePath.startsWith('document/'))) {
    throw badRequest('This file failed media security checks');
  }

  const stored = await storage.put(claims.storagePath, data, claims.mimeType);
  await markUploadTokenConsumed(claims);
  return stored;
}

function scanPurpose(storagePath: string): 'chat_attachment' | 'listing_media' | 'document' | 'avatar' | 'other' {
  if (storagePath.startsWith('chat_attachment/')) return 'chat_attachment';
  if (storagePath.startsWith('listing_media/') || storagePath.startsWith('review_media/') || storagePath.startsWith('ad_creative/')) {
    return 'listing_media';
  }
  if (storagePath.startsWith('document/') || storagePath.startsWith('verification/')) return 'document';
  if (storagePath.startsWith('avatar/') || storagePath.startsWith('cover/')) return 'avatar';
  return 'other';
}

function guessExt(mimeType: string): string {
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'video/mp4') return '.mp4';
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'audio/mpeg') return '.mp3';
  if (mimeType === 'audio/mp4' || mimeType === 'audio/m4a' || mimeType === 'audio/x-m4a') return '.m4a';
  if (mimeType === 'audio/aac') return '.aac';
  if (mimeType === 'audio/webm') return '.webm';
  if (mimeType === 'audio/wav') return '.wav';
  if (mimeType === 'audio/ogg') return '.ogg';
  if (mimeType === 'video/webm') return '.webm';
  if (mimeType.includes('wordprocessingml')) return '.docx';
  if (mimeType.includes('spreadsheetml')) return '.xlsx';
  if (mimeType === 'text/plain') return '.txt';
  return '';
}

export function getPublicBaseUrl(): string {
  return env.STORAGE_PUBLIC_URL;
}
