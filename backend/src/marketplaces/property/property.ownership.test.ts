import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../core/errors';
import { reviewOwnership, setVerificationDimension } from './property.ownership';

describe('property ownership verification', () => {
  it('does not let a client mark ownership verified', async () => {
    await assert.rejects(
      () =>
        reviewOwnership({
          ownershipId: 1,
          actorId: 99,
          isStaff: false,
          status: 'verified',
        }),
      (error: unknown) => error instanceof AppError && error.status === 403,
    );
  });

  it('does not let a client set verification badges', async () => {
    await assert.rejects(
      () =>
        setVerificationDimension({
          propertyId: 1,
          actorId: 99,
          isStaff: false,
          dimension: 'ownership',
          status: 'verified',
        }),
      (error: unknown) => error instanceof AppError && error.status === 403,
    );
  });
});
