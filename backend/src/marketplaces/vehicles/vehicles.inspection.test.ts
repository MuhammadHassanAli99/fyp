import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../core/errors';
import { createStructuredInspection, gradeFor, resultFor } from './vehicles.inspection';

describe('structured vehicle inspection', () => {
  it('maps scores to pass/fail without client-set verification', () => {
    assert.equal(gradeFor(92), 'A+');
    assert.equal(resultFor(85), 'pass');
    assert.equal(resultFor(70), 'pass_with_warnings');
    assert.equal(resultFor(55), 'requires_repair');
    assert.equal(resultFor(20), 'fail');
  });

  it('does not let a non-staff user submit an inspection', async () => {
    await assert.rejects(
      () =>
        createStructuredInspection({
          listingId: 1,
          inspectorId: 9,
          isStaff: false,
          checklistCode: 'car',
          items: [{ itemCode: 'engine', score: 90 }],
        }),
      (error: unknown) => error instanceof AppError && error.status === 403,
    );
  });
});
