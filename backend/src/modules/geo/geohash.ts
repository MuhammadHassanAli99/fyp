/**
 * Public geohash for clustering. Precision maps to zoom; never encode hidden
 * private coordinates — callers must pass already-public lat/lng.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(lat: number, lng: number, precision = 8): string {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;

  while (hash.length < precision) {
    if (even) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch = (ch << 1) + 1;
        minLng = mid;
      } else {
        ch <<= 1;
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch = (ch << 1) + 1;
        minLat = mid;
      } else {
        ch <<= 1;
        maxLat = mid;
      }
    }
    even = !even;
    bit += 1;
    if (bit === 5) {
      hash += BASE32[ch] ?? '0';
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

export function geohashPrecisionForZoom(zoom: number): number {
  if (zoom <= 5) return 2;
  if (zoom <= 8) return 3;
  if (zoom <= 11) return 4;
  if (zoom <= 13) return 5;
  if (zoom <= 15) return 6;
  return 8;
}

export function decodeGeohashCenter(hash: string): { lat: number; lng: number } {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let even = true;
  for (const char of hash) {
    const idx = BASE32.indexOf(char);
    if (idx < 0) continue;
    for (let mask = 16; mask >= 1; mask >>= 1) {
      if (even) {
        const mid = (minLng + maxLng) / 2;
        if (idx & mask) minLng = mid;
        else maxLng = mid;
      } else {
        const mid = (minLat + maxLat) / 2;
        if (idx & mask) minLat = mid;
        else maxLat = mid;
      }
      even = !even;
    }
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}
