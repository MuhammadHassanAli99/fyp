import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromMinorUnits, multiplyMoney, roundToDigits, toMinorUnits } from './money';
import { formatInTimezone } from './datetime.service';
import { formatNational } from './phone.service';
import { normalizeUnitCode } from './units.service';

describe('money precision', () => {
  it('rounds JPY to zero decimals and KWD to three', () => {
    assert.equal(roundToDigits(123.456, 0), 123);
    assert.equal(roundToDigits(1.2345, 3), 1.235);
  });

  it('converts via minor units without dropping gold-scale amounts', () => {
    const minor = toMinorUnits(5000000.5, 2);
    assert.equal(minor, 500000050n);
    assert.equal(fromMinorUnits(minor, 2), 5000000.5);
  });

  it('applies FX as presentation math only', () => {
    assert.equal(multiplyMoney(100, 280, 2), 28000);
    assert.equal(multiplyMoney(1, 0.3075, 3), 0.308);
  });
});

describe('datetime localization', () => {
  it('keeps the UTC instant and projects Karachi display', () => {
    const result = formatInTimezone({
      utc: '2026-08-20T00:00:00.000Z',
      timezone: 'Asia/Karachi',
      dateFormat: 'dd/MM/yyyy',
      timeFormat: 'HH:mm',
    });
    assert.equal(result.utc, '2026-08-20T00:00:00.000Z');
    assert.equal(result.timezone, 'Asia/Karachi');
    assert.equal(result.date, '20/08/2026');
    assert.match(result.time, /0[45]:00/);
  });
});

describe('units aliases', () => {
  it('maps display names onto canonical codes', () => {
    assert.equal(normalizeUnitCode('sq ft'), 'sqft');
    assert.equal(normalizeUnitCode('ozt'), 'troy_ounce');
    assert.equal(normalizeUnitCode('kilogram'), 'kg');
    assert.equal(normalizeUnitCode('gallon'), 'gal');
  });
});

describe('phone national mask', () => {
  it('fills # placeholders without dropping extra digits', () => {
    assert.equal(formatNational('3001234567', '### #######'), '300 1234567');
    assert.equal(formatNational('4155552671', '(###) ###-####'), '(415) 555-2671');
  });
});
