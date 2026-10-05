import { queryOne, type Row } from '../../db/query';
import { remember } from '../../config/cache';
import { badRequest, notFound } from '../../core/errors';

/**
 * International phone handling. Authoritative storage is E.164 where the
 * number is complete. National display is derived from country dial_code.
 */

export interface PhoneParts {
  countryId: number;
  iso2: string;
  dialCode: string;
  nationalNumber: string;
  e164: string;
  valid: boolean;
}

export async function getPhoneRules(countryId: number): Promise<{
  countryId: number;
  iso2: string;
  dialCode: string;
  phoneFormat: string | null;
}> {
  return remember(`ref:phone-rules:${countryId}`, 3600, async () => {
    const row = await queryOne<Row>(
      `SELECT id, iso2, dial_code, phone_format FROM countries WHERE id = ? AND is_active = 1`,
      [countryId],
    );
    if (!row) throw notFound('Country');
    return {
      countryId: Number(row.id),
      iso2: String(row.iso2),
      dialCode: String(row.dial_code),
      phoneFormat: (row.phone_format as string | null) ?? null,
    };
  });
}

export async function normalizePhone(input: {
  countryId?: number;
  iso2?: string;
  number: string;
}): Promise<PhoneParts> {
  const raw = input.number.trim();
  if (!raw) throw badRequest('Phone number is required');

  const country = await resolveCountry(input.countryId, input.iso2, raw);
  const digits = raw.replace(/[^\d+]/g, '');
  const dialDigits = country.dialCode.replace(/\D/g, '');

  let national = digits.replace(/^\+/, '');
  if (national.startsWith(dialDigits)) national = national.slice(dialDigits.length);
  if (national.startsWith('0')) national = national.replace(/^0+/, '');
  national = national.replace(/\D/g, '');

  const e164 = `+${dialDigits}${national}`;
  const valid = national.length >= 4 && national.length <= 15 && /^\+[1-9]\d{4,14}$/.test(e164);

  return {
    countryId: country.countryId,
    iso2: country.iso2,
    dialCode: country.dialCode,
    nationalNumber: national,
    e164,
    valid,
  };
}

export function formatNational(nationalNumber: string, mask: string | null): string {
  if (!mask) return nationalNumber;
  let i = 0;
  let out = '';
  for (const char of mask) {
    if (char === '#') {
      if (i >= nationalNumber.length) break;
      out += nationalNumber[i];
      i += 1;
    } else {
      out += char;
    }
  }
  if (i < nationalNumber.length) out += nationalNumber.slice(i);
  return out;
}

async function resolveCountry(countryId: number | undefined, iso2: string | undefined, raw: string) {
  if (countryId) return getPhoneRules(countryId);
  if (iso2) {
    const row = await queryOne<Row>(
      `SELECT id FROM countries WHERE iso2 = ? OR iso3 = ?`,
      [iso2.toUpperCase(), iso2.toUpperCase()],
    );
    if (!row) throw notFound('Country');
    return getPhoneRules(Number(row.id));
  }
  const plus = raw.trim().startsWith('+') ? raw.replace(/[^\d]/g, '') : null;
  if (plus) {
    const rows = await queryOne<Row>(
      `SELECT id FROM countries
        WHERE is_active = 1 AND REPLACE(dial_code, '+', '') = LEFT(?, LENGTH(REPLACE(dial_code, '+', '')))
        ORDER BY LENGTH(REPLACE(dial_code, '+', '')) DESC LIMIT 1`,
      [plus],
    );
    if (rows) return getPhoneRules(Number(rows.id));
  }
  throw badRequest('Country is required to normalize a national phone number');
}
