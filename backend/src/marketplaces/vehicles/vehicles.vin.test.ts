import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeVin, isValidVinFormat, mileageLooksAnomalous, normalizeVin } from './vehicles.vin';

describe('VIN decode', () => {
  it('accepts a 17-character ISO 3779 VIN without I, O or Q', () => {
    const vin = 'JHMCM56133C012345';
    assert.equal(isValidVinFormat(vin), true);
    const decoded = decodeVin(vin);
    assert.equal(decoded.validFormat, true);
    assert.equal(decoded.wmi, 'JHM');
    assert.equal(decoded.country, 'Japan');
    assert.match(decoded.disclaimer, /not legal ownership/i);
  });

  it('rejects I, O and Q', () => {
    assert.equal(isValidVinFormat('IHMCM56133C012345'), false);
    assert.equal(decodeVin('not-a-vin').validFormat, false);
  });

  it('normalises whitespace and never claims theft or registration status', () => {
    assert.equal(normalizeVin(' jhm cm56133c012345 '), 'JHMCM56133C012345');
    const decoded = decodeVin('WVWZZZ1JZXW000001');
    assert.doesNotMatch(decoded.disclaimer, /stolen|cleared|registered/i);
  });
});

describe('mileage anomaly', () => {
  it('flags an odometer that went backwards', () => {
    const result = mileageLooksAnomalous({ previousKm: 80_000, nextKm: 12_000, daysBetween: 30 });
    assert.equal(result.anomalous, true);
  });

  it('does not flag a first reading', () => {
    const result = mileageLooksAnomalous({ previousKm: null, nextKm: 12_000, daysBetween: null });
    assert.equal(result.anomalous, false);
  });
});
