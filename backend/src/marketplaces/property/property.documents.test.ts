import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../core/errors';
import { assertSafePropertyDocumentFile, verifyPropertyDocument } from './property.documents';

describe('property document security', () => {
  it('rejects public storage paths', () => {
    assert.throws(
      () => assertSafePropertyDocumentFile('uploads/public/title.pdf', 'application/pdf'),
      (error: unknown) => error instanceof AppError && error.status === 400,
    );
  });

  it('rejects executable uploads', () => {
    assert.throws(
      () => assertSafePropertyDocumentFile('document/ownership.exe', 'application/pdf'),
      (error: unknown) => error instanceof AppError && error.status === 400,
    );
  });

  it('rejects unexpected MIME types', () => {
    assert.throws(
      () => assertSafePropertyDocumentFile('document/title.pdf', 'application/x-msdownload'),
      (error: unknown) => error instanceof AppError && error.status === 400,
    );
  });

  it('accepts private PDF and image documents', () => {
    assert.doesNotThrow(() =>
      assertSafePropertyDocumentFile('document/ownership.pdf', 'application/pdf'),
    );
    assert.doesNotThrow(() =>
      assertSafePropertyDocumentFile('verification/map.png', 'image/png'),
    );
  });

  it('does not let a client mark a document verified', async () => {
    await assert.rejects(
      () =>
        verifyPropertyDocument({
          documentId: 1,
          actorId: 99,
          isStaff: false,
          decision: 'verified',
        }),
      (error: unknown) => error instanceof AppError && error.status === 403,
    );
  });
});
