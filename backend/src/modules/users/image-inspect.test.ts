import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inspectImage, looksMalicious } from './image-inspect';

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

describe('image inspect', () => {
  it('reads PNG dimensions and rejects tiny images', () => {
    assert.throws(() => inspectImage(png(16, 16)));
    const ok = inspectImage(png(128, 128));
    assert.equal(ok.kind, 'png');
    assert.equal(ok.width, 128);
    assert.equal(ok.height, 128);
  });

  it('rejects PE executables disguised as images', () => {
    const pe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    assert.equal(looksMalicious(pe), true);
    assert.throws(() => inspectImage(pe));
  });

  it('rejects HTML uploaded as an image', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    assert.throws(() => inspectImage(html));
  });

  it('rejects MIME mismatch', () => {
    assert.throws(() => inspectImage(png(128, 128), 'image/jpeg'));
  });
});
