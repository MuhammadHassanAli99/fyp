import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidIanaTimeZone, isWithinQuietHours, resolveTimeZone, zonedParts } from './notifications.timezone';

describe('timezone + quiet hours', () => {
  it('accepts IANA identifiers and rejects junk', () => {
    assert.equal(isValidIanaTimeZone('Asia/Karachi'), true);
    assert.equal(isValidIanaTimeZone('Asia/Dubai'), true);
    assert.equal(isValidIanaTimeZone('Europe/London'), true);
    assert.equal(isValidIanaTimeZone('America/New_York'), true);
    assert.equal(isValidIanaTimeZone('Australia/Sydney'), true);
    assert.equal(isValidIanaTimeZone('Asia/Tokyo'), true);
    assert.equal(isValidIanaTimeZone('Not/AZone'), false);
    assert.equal(resolveTimeZone('nope'), 'UTC');
  });

  it('evaluates wrapping quiet hours in the user timezone, not the server timezone', () => {
    // 23:00–07:00 Asia/Karachi. 18:30 UTC is 23:30 PKT in August (UTC+5).
    const late = new Date('2026-08-17T18:30:00.000Z');
    assert.equal(isWithinQuietHours(late, '23:00', '07:00', 'Asia/Karachi', null), true);
    const afternoon = new Date('2026-08-17T09:00:00.000Z');
    assert.equal(isWithinQuietHours(afternoon, '23:00', '07:00', 'Asia/Karachi', null), false);
  });

  it('reads DST-aware wall-clock parts', () => {
    const winter = zonedParts(new Date('2026-01-15T12:00:00.000Z'), 'Europe/London');
    const summer = zonedParts(new Date('2026-07-15T12:00:00.000Z'), 'Europe/London');
    assert.equal(winter.hour, 12);
    assert.equal(summer.hour, 13);
  });
});
