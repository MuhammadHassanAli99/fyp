import path from 'node:path';
import { env } from '../../config/env';
import { badRequest, forbidden } from '../../core/errors';
import { hmacSha256, safeEqual } from '../../core/security/crypto';
import { storage } from '../../providers/storage';
import { mediaScan } from '../../providers/media-scan';
import { loggerFor } from '../../config/logger';
import type { AttachmentInput, AttachmentKind } from './chat.types';

const log = loggerFor('chat.media');

const CHAT_PREFIX = `chat_attachment/`;

export interface MediaReadClaims {
  attachmentId: number;
  userId: number;
  expiresAt: number;
}

export function signMediaReadToken(claims: MediaReadClaims): string {
  const encoded = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${encoded}.${hmacSha256(encoded)}`;
}

export function verifyMediaReadToken(token: string): MediaReadClaims {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) throw badRequest('Malformed media token');
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, hmacSha256(encoded))) throw forbidden('Invalid media token');
  let claims: MediaReadClaims;
  try {
    claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as MediaReadClaims;
  } catch {
    throw badRequest('Malformed media token');
  }
  if (!claims.attachmentId || !claims.userId || claims.expiresAt < Date.now()) {
    throw forbidden('Media link has expired');
  }
  return claims;
}

export function publicMediaUrl(token: string): string {
  return `${env.API_PREFIX}/chat/media/${token}`;
}

/**
 * Clients must only attach objects they just uploaded under their own prefix.
 * A raw URL pointing at someone else's listing photo is rejected.
 */
export function assertOwnedStorageRef(userId: number, input: AttachmentInput): string {
  const raw = input.storageKey || input.url || '';
  if (!raw) throw badRequest('Attachment storage key is required');

  let storageKey = raw;
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const url = new URL(raw);
      const idx = url.pathname.indexOf('/uploads/');
      storageKey = idx >= 0 ? url.pathname.slice(idx + '/uploads/'.length) : url.pathname.replace(/^\/+/, '');
    }
  } catch {
    throw badRequest('Invalid attachment URL');
  }

  storageKey = storageKey.replace(/^\/+/, '');
  if (storageKey.includes('..') || path.isAbsolute(storageKey)) {
    throw badRequest('Invalid storage path');
  }
  const expected = `${CHAT_PREFIX}${userId}/`;
  if (!storageKey.startsWith(expected)) {
    throw forbidden('Attachment does not belong to this account');
  }
  return storageKey;
}

export function signedAttachmentUrls(params: {
  attachmentId: number;
  userId: number;
  storageKey?: string | null;
  thumbnailKey?: string | null;
  fallbackUrl?: string | null;
  fallbackThumb?: string | null;
}): { url: string | null; thumbUrl: string | null } {
  const ttl = Date.now() + env.CHAT_MEDIA_URL_TTL_SECONDS * 1000;
  if (params.storageKey) {
    const token = signMediaReadToken({ attachmentId: params.attachmentId, userId: params.userId, expiresAt: ttl });
    const url = publicMediaUrl(token);
    return { url, thumbUrl: params.fallbackThumb ?? url };
  }
  return { url: params.fallbackUrl ?? null, thumbUrl: params.fallbackThumb ?? params.fallbackUrl ?? null };
}

export async function scanStoredObject(storageKey: string, claimedMime: string, filename?: string | null) {
  try {
    const buffer = await storage.read(storageKey);
    const result = await mediaScan.scan({
      buffer,
      claimedMime,
      filename: filename ?? null,
      purpose: 'chat_attachment',
    });
    if (result.verdict === 'blocked') {
      log.warn({ storageKey, reasons: result.reasons }, 'chat attachment blocked by scanner');
    }
    return result;
  } catch (error) {
    log.warn({ err: error }, 'media scan skipped (object unreadable)');
    return { verdict: 'skipped' as const, detectedMime: null, reasons: ['unreadable'], driver: 'heuristic-magic' };
  }
}

export function kindFromMime(mime: string | null | undefined, fallback: AttachmentKind): AttachmentKind {
  const value = (mime ?? '').toLowerCase();
  if (value.startsWith('image/')) return 'image';
  if (value.startsWith('video/')) return 'video';
  if (value.startsWith('audio/')) return 'audio';
  if (value === 'application/pdf' || value.includes('officedocument') || value === 'text/plain') return 'document';
  return fallback;
}
