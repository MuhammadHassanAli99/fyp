import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env';
import { badRequest, serviceUnavailable } from '../../core/errors';
import { hmacSha256, safeEqual, uuid } from '../../core/security/crypto';

export type StoragePurpose =
  | 'listing_media'
  | 'avatar'
  | 'cover'
  | 'document'
  | 'verification'
  | 'review_media'
  | 'ad_creative'
  | 'chat_attachment'
  | 'search_image'
  | 'search_voice';

export interface UploadTokenClaims {
  purpose: StoragePurpose;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  maxBytes: number;
  exp: number;
  jti: string;
}

export interface SignedUpload {
  token: string;
  storagePath: string;
  uploadUrl: string;
  /** Alias of publicUrl — Flutter clients read `fileUrl`. */
  fileUrl: string;
  publicUrl: string;
  mimeType: string;
  expiresAt: string;
  headers: Record<string, string>;
}

export interface StoredObject {
  storagePath: string;
  fileUrl: string;
  bytes: number;
  mimeType: string;
}

interface StorageDriver {
  readonly name: string;
  sign(input: {
    purpose: StoragePurpose;
    storagePath: string;
    mimeType: string;
    sizeBytes: number;
    maxBytes: number;
    ttlSeconds: number;
  }): Promise<SignedUpload>;
  put(storagePath: string, data: Buffer, mimeType: string): Promise<StoredObject>;
  read(storagePath: string): Promise<Buffer>;
  exists(storagePath: string): Promise<boolean>;
  delete(storagePath: string): Promise<void>;
  publicUrl(storagePath: string): string;
}

const PRIVATE_PREFIXES = ['verification/', 'document/', 'private/', 'exports/'];

function resolveRoot(): string {
  return path.isAbsolute(env.STORAGE_LOCAL_DIR)
    ? env.STORAGE_LOCAL_DIR
    : path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR);
}

function assertSafeStoragePath(storagePath: string): string {
  const normalized = storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
    throw badRequest('Invalid storage path');
  }
  return normalized;
}

function encodeToken(claims: UploadTokenClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sig = hmacSha256(payload);
  return `${payload}.${sig}`;
}

function decodeToken(token: string): UploadTokenClaims {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) throw badRequest('Invalid upload token');
  const expected = hmacSha256(payload);
  if (!safeEqual(sig, expected)) throw badRequest('Invalid upload token signature');
  let claims: UploadTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as UploadTokenClaims;
  } catch {
    throw badRequest('Invalid upload token payload');
  }
  if (!claims.exp || Date.now() > claims.exp) throw badRequest('Upload token expired');
  if (!claims.storagePath || !claims.mimeType) throw badRequest('Upload token incomplete');
  return claims;
}

const consumedTokens = new Set<string>();

class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';

  async sign(input: {
    purpose: StoragePurpose;
    storagePath: string;
    mimeType: string;
    sizeBytes: number;
    maxBytes: number;
    ttlSeconds: number;
  }): Promise<SignedUpload> {
    const storagePath = assertSafeStoragePath(input.storagePath);
    const claims: UploadTokenClaims = {
      purpose: input.purpose,
      storagePath,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      maxBytes: input.maxBytes,
      exp: Date.now() + input.ttlSeconds * 1000,
      jti: uuid(),
    };
    const token = encodeToken(claims);
    const publicUrl = this.publicUrl(storagePath);
    return {
      token,
      storagePath,
      uploadUrl: `${env.APP_URL}${env.API_PREFIX}/uploads/local/${token}`,
      fileUrl: publicUrl,
      publicUrl,
      mimeType: input.mimeType,
      expiresAt: new Date(claims.exp).toISOString(),
      headers: { 'Content-Type': input.mimeType },
    };
  }

  async put(storagePath: string, data: Buffer, mimeType: string): Promise<StoredObject> {
    const relative = assertSafeStoragePath(storagePath);
    const absolute = path.join(resolveRoot(), relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, data);
    return {
      storagePath: relative,
      fileUrl: this.publicUrl(relative),
      bytes: data.byteLength,
      mimeType,
    };
  }

  async read(storagePath: string): Promise<Buffer> {
    const relative = assertSafeStoragePath(storagePath);
    const absolute = path.join(resolveRoot(), relative);
    try {
      return await fs.readFile(absolute);
    } catch {
      throw badRequest('Object not found in storage');
    }
  }

  async exists(storagePath: string): Promise<boolean> {
    const relative = assertSafeStoragePath(storagePath);
    const absolute = path.join(resolveRoot(), relative);
    try {
      await fs.access(absolute);
      return true;
    } catch {
      return false;
    }
  }

  async delete(storagePath: string): Promise<void> {
    const relative = assertSafeStoragePath(storagePath);
    const absolute = path.join(resolveRoot(), relative);
    await fs.unlink(absolute).catch(() => undefined);
  }

  publicUrl(storagePath: string): string {
    const relative = assertSafeStoragePath(storagePath);
    const base = (env.CDN_PUBLIC_URL || env.STORAGE_PUBLIC_URL).replace(/\/+$/, '');
    return `${base}/${relative}`;
  }
}

class UnconfiguredStorageDriver implements StorageDriver {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  private fail(): never {
    throw serviceUnavailable(`STORAGE_DRIVER=${this.name} is not configured`);
  }
  sign(): Promise<SignedUpload> {
    this.fail();
  }
  put(): Promise<StoredObject> {
    this.fail();
  }
  read(): Promise<Buffer> {
    this.fail();
  }
  exists(): Promise<boolean> {
    this.fail();
  }
  delete(): Promise<void> {
    this.fail();
  }
  publicUrl(storagePath: string): string {
    const relative = assertSafeStoragePath(storagePath);
    return `${env.STORAGE_PUBLIC_URL.replace(/\/+$/, '')}/${relative}`;
  }
}

function createDriver(): StorageDriver {
  switch (env.STORAGE_DRIVER) {
    case 'local':
      return new LocalStorageDriver();
    case 's3':
      return new UnconfiguredStorageDriver('s3');
    case 'gcs':
      return new UnconfiguredStorageDriver('gcs');
    case 'azure':
      return new UnconfiguredStorageDriver('azure');
    default:
      return new LocalStorageDriver();
  }
}

export const storage: StorageDriver = createDriver();

export function isLocalStorage(): boolean {
  return env.STORAGE_DRIVER === 'local';
}

export function isStorageReady(): boolean {
  return env.STORAGE_DRIVER === 'local' || env.STORAGE_DRIVER === 's3';
}

export function isPrivateStoragePath(storagePath: string): boolean {
  const normalized = storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return PRIVATE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export async function verifyUploadToken(token: string): Promise<UploadTokenClaims> {
  const claims = decodeToken(token);
  if (consumedTokens.has(claims.jti)) throw badRequest('Upload token already used');
  return claims;
}

export async function markUploadTokenConsumed(claims: UploadTokenClaims): Promise<void> {
  consumedTokens.add(claims.jti);
}
