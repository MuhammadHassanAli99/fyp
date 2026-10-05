import { loggerFor } from '../../config/logger';

const log = loggerFor('media-scan');

/**
 * Malware / content-type scan behind one interface.
 *
 * No ClamAV (or other product) is wired. The heuristic driver checks magic
 * bytes against the claimed MIME so a renamed `.jpg.exe` cannot ride into chat.
 * Swap in a real scanner by implementing MediaScanDriver — domain code never
 * imports a vendor SDK.
 */
export type ScanVerdict = 'clean' | 'suspicious' | 'blocked' | 'skipped';

export interface ScanRequest {
  buffer: Buffer;
  claimedMime: string;
  filename?: string | null;
  purpose: 'chat_attachment' | 'listing_media' | 'document' | 'avatar' | 'other';
}

export interface ScanResult {
  verdict: ScanVerdict;
  detectedMime: string | null;
  reasons: string[];
  driver: string;
}

export interface MediaScanDriver {
  readonly name: string;
  scan(request: ScanRequest): Promise<ScanResult>;
}

const EXECUTABLE_MARKERS: Array<{ label: string; test: (buf: Buffer) => boolean }> = [
  { label: 'pe_executable', test: (buf) => buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a },
  { label: 'elf_executable', test: (buf) => buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46 },
  { label: 'macho', test: (buf) => buf.length >= 4 && buf[0] === 0xcf && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe },
];

function sniffMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.toString('ascii', 0, 4) === '%PDF') return 'application/pdf';
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand.startsWith('M4A') || brand.startsWith('mp4a')) return 'audio/mp4';
    return 'video/mp4';
  }
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return 'audio/mpeg';
  if (buffer[0] === 0xff && (buffer[1] === 0xfb || buffer[1] === 0xfa || buffer[1] === 0xf3)) return 'audio/mpeg';
  if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) return 'audio/ogg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'video/webm';
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'application/zip';
  const head = buffer.toString('utf8', 0, Math.min(64, buffer.length)).trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'text/html';
  return null;
}

const MIME_FAMILY: Record<string, string> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/m4a': 'audio',
  'audio/x-m4a': 'audio',
  'audio/aac': 'audio',
  'audio/webm': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'application/pdf': 'document',
  'application/zip': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'text/plain': 'document',
};

function family(mime: string): string | null {
  return MIME_FAMILY[mime.toLowerCase()] ?? null;
}

class HeuristicMediaScanDriver implements MediaScanDriver {
  readonly name = 'heuristic-magic';

  async scan(request: ScanRequest): Promise<ScanResult> {
    const reasons: string[] = [];
    for (const marker of EXECUTABLE_MARKERS) {
      if (marker.test(request.buffer)) {
        log.warn({ purpose: request.purpose, reason: marker.label }, 'blocked executable upload');
        return {
          verdict: 'blocked',
          detectedMime: 'application/octet-stream',
          reasons: [marker.label],
          driver: this.name,
        };
      }
    }

    const detected = sniffMime(request.buffer);
    const claimed = request.claimedMime.toLowerCase();
    const claimedFamily = family(claimed);
    const detectedFamily = detected ? family(detected) : null;

    if (detected === 'text/html') {
      return {
        verdict: 'blocked',
        detectedMime: detected,
        reasons: ['html_content'],
        driver: this.name,
      };
    }

    if (detected && claimedFamily && detectedFamily && claimedFamily !== detectedFamily) {
      // ZIP is the container for docx/xlsx — allow that pairing.
      const officeZip =
        detected === 'application/zip' &&
        (claimed.includes('officedocument') || claimed.includes('msword') || claimed.includes('spreadsheet'));
      if (!officeZip) {
        reasons.push('mime_mismatch');
        return {
          verdict: 'blocked',
          detectedMime: detected,
          reasons,
          driver: this.name,
        };
      }
    }

    if (!detected && claimedFamily === 'image') {
      reasons.push('unrecognised_image_magic');
      return { verdict: 'suspicious', detectedMime: null, reasons, driver: this.name };
    }

    return {
      verdict: 'clean',
      detectedMime: detected,
      reasons,
      driver: this.name,
    };
  }
}

export const mediaScan: MediaScanDriver = new HeuristicMediaScanDriver();

export const sniffMediaMime = sniffMime;
