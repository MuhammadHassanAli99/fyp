import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseVehicleQuery } from './vehicles.search';

describe('vehicle query parser', () => {
  it('parses a car for sale', () => {
    const parsed = parseVehicleQuery('car for sale in Lahore');
    assert.equal(parsed.operation, 'sell');
    assert.equal(parsed.vehicleType, 'car');
    assert.equal(parsed.cityHint, 'Lahore');
  });

  it('parses motorcycle rentals', () => {
    const parsed = parseVehicleQuery('motorcycle for rent');
    assert.equal(parsed.operation, 'rent');
    assert.equal(parsed.vehicleType, 'motorcycle');
  });

  it('parses electric and diesel fuels', () => {
    assert.equal(parseVehicleQuery('electric SUV').fuelType, 'electric');
    assert.equal(parseVehicleQuery('diesel truck').fuelType, 'diesel');
    assert.equal(parseVehicleQuery('diesel truck').vehicleType, 'truck');
  });

  it('parses marine and machinery types', () => {
    assert.equal(parseVehicleQuery('yacht').vehicleType, 'yacht');
    assert.equal(parseVehicleQuery('jet ski').vehicleType, 'jet_ski');
    assert.equal(parseVehicleQuery('excavator').vehicleType, 'heavy_machinery');
  });
});
