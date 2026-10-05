import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../core/errors';
import { reviewOwnership, reviewVin } from './vehicles.ownership';

describe('vehicle ownership and VIN verification', () => {
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

  it('does not let a client mark a VIN verified', async () => {
    await assert.rejects(
      () =>
        reviewVin({
          vehicleId: 1,
          actorId: 99,
          isStaff: false,
          status: 'verified',
        }),
      (error: unknown) => error instanceof AppError && error.status === 403,
    );
  });
});
