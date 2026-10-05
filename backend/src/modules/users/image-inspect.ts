import { badRequest } from '../../core/errors';

export type ImageKind = 'jpeg' | 'png' | 'webp';

export interface InspectedImage {
  kind: ImageKind;
  mimeType: string;
  width: number;
  height: number;
}

const MIN_EDGE = 64;
const MAX_EDGE = 8000;
const MAX_BYTES = 5 * 1024 * 1024;

/** Executable / HTML payloads that must never be stored as a "profile image". */
export function looksMalicious(data: Buffer): boolean {
  if (data.length < 4) return true;
  if (data[0] === 0x4d && data[1] === 0x5a) return true; // PE
  if (data[0] === 0x7f && data[1] === 0x45 && data[2] === 0x4c && data[3] === 0x46) return true; // ELF
  if (data[0] === 0xca && data[1] === 0xfe && data[2] === 0xba && data[3] === 0xbe) return true; // Mach-O
  const head = data.subarray(0, 64).toString('latin1').toLowerCase();
  if (head.includes('<html') || head.includes('<script') || head.includes('<?php')) return true;
  return false;
}

function jpegDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const size = data.readUInt16BE(offset + 2);
    if (size < 2) return null;
    // SOF0 / SOF2
    if (marker === 0xc0 || marker === 0xc2) {
      const height = data.readUInt16BE(offset + 5);
      const width = data.readUInt16BE(offset + 7);
      return { width, height };
    }
    offset += 2 + size;
  }
  return null;
}

function pngDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 24) return null;
  const sig = data.subarray(0, 8);
  if (!sig.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  if (data.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function webpDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 30) return null;
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = data.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    const width = 1 + data.readUIntLE(24, 3);
    const height = 1 + data.readUIntLE(27, 3);
    return { width, height };
  }
  if (chunk === 'VP8 ' && data.length >= 30) {
    const width = data.readUInt16LE(26) & 0x3fff;
    const height = data.readUInt16LE(28) & 0x3fff;
    return { width, height };
  }
  if (chunk === 'VP8L' && data.length >= 25) {
    const bits = data.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function inspectImage(data: Buffer, claimedMime?: string | null): InspectedImage {
  if (data.length === 0) throw badRequest('Empty image');
  if (data.length > MAX_BYTES) throw badRequest(`Image must be at most ${MAX_BYTES} bytes`);
  if (looksMalicious(data)) throw badRequest('This file is not a permitted image');

  let kind: ImageKind | null = null;
  let dims: { width: number; height: number } | null = null;

  const jpeg = jpegDimensions(data);
  const png = pngDimensions(data);
  const webp = webpDimensions(data);

  if (jpeg) {
    kind = 'jpeg';
    dims = jpeg;
  } else if (png) {
    kind = 'png';
    dims = png;
  } else if (webp) {
    kind = 'webp';
    dims = webp;
  }

  if (!kind || !dims) throw badRequest('Unrecognised image format. Use JPEG, PNG or WebP');

  const mimeType = kind === 'jpeg' ? 'image/jpeg' : kind === 'png' ? 'image/png' : 'image/webp';
  if (claimedMime && claimedMime !== 'application/octet-stream' && claimedMime !== mimeType) {
    throw badRequest('File contents do not match the declared MIME type');
  }
  if (dims.width < MIN_EDGE || dims.height < MIN_EDGE) {
    throw badRequest(`Image must be at least ${MIN_EDGE}×${MIN_EDGE} pixels`);
  }
  if (dims.width > MAX_EDGE || dims.height > MAX_EDGE) {
    throw badRequest(`Image must be at most ${MAX_EDGE}×${MAX_EDGE} pixels`);
  }

  return { kind, mimeType, width: dims.width, height: dims.height };
}
