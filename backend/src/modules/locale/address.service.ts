import { queryOne, type Row } from '../../db/query';
import { remember } from '../../config/cache';
import { toJson } from '../../db/sql';
import { badRequest, notFound } from '../../core/errors';

/**
 * Country-driven address rules. Field order, required vs optional, and
 * postal validation come from `countries.address_format` / postal_code_regex.
 * Screens must not hardcode a US-style street/city/state/zip layout.
 */

export const ADDRESS_FIELDS = [
  'street',
  'address_line1',
  'address_line2',
  'building',
  'unit',
  'district',
  'area',
  'city',
  'province',
  'state',
  'region',
  'postal_code',
  'country',
] as const;

export type AddressField = (typeof ADDRESS_FIELDS)[number];

const FIELD_ALIASES: Record<string, AddressField> = {
  line1: 'address_line1',
  line2: 'address_line2',
  address: 'address_line1',
  street: 'address_line1',
  zip: 'postal_code',
  zipcode: 'postal_code',
  postcode: 'postal_code',
  state: 'region',
  province: 'region',
};

const ALWAYS_REQUIRED = new Set<AddressField>(['address_line1', 'city', 'country']);
const OPTIONAL_BY_DEFAULT = new Set<AddressField>(['address_line2', 'building', 'unit', 'district', 'area']);

export interface AddressRules {
  countryId: number;
  iso2: string;
  fields: AddressField[];
  required: AddressField[];
  optional: AddressField[];
  postalCodeRegex: string | null;
  postalCodeRequired: boolean;
}

export interface AddressInput {
  street?: string;
  addressLine1?: string;
  addressLine2?: string;
  building?: string;
  unit?: string;
  district?: string;
  area?: string;
  city?: string;
  province?: string;
  state?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export async function getAddressRules(countryId: number): Promise<AddressRules> {
  return remember(`ref:address-rules:${countryId}`, 3600, async () => {
    const row = await queryOne<Row>(
      `SELECT id, iso2, address_format, postal_code_regex FROM countries WHERE id = ? AND is_active = 1`,
      [countryId],
    );
    if (!row) throw notFound('Country');
    const raw = toJson<string[] | Record<string, unknown> | null>(row.address_format, null);
    const fields = normalizeFieldList(raw);
    const postalCodeRegex = (row.postal_code_regex as string | null) ?? null;
    const postalCodeRequired = fields.includes('postal_code') && postalCodeRegex !== null;
    const required = fields.filter(
      (field) => ALWAYS_REQUIRED.has(field) || (field === 'postal_code' && postalCodeRequired) || field === 'region',
    ).filter((field) => !OPTIONAL_BY_DEFAULT.has(field));
    const optional = fields.filter((field) => !required.includes(field));
    return {
      countryId: Number(row.id),
      iso2: String(row.iso2),
      fields,
      required: [...new Set(required)],
      optional,
      postalCodeRegex,
      postalCodeRequired,
    };
  });
}

export async function validateAddress(countryId: number, input: AddressInput): Promise<{
  valid: boolean;
  errors: Record<string, string>;
  normalized: Record<string, string>;
  formatted: string;
}> {
  const rules = await getAddressRules(countryId);
  const normalized = normalizeAddress(input);
  const errors: Record<string, string> = {};

  for (const field of rules.required) {
    const key = toCamel(field);
    if (!normalized[key]) errors[key] = `${field} is required`;
  }

  if (rules.postalCodeRegex && normalized.postalCode) {
    try {
      const regex = new RegExp(rules.postalCodeRegex);
      if (!regex.test(normalized.postalCode)) {
        errors.postalCode = 'Postal code does not match this country format';
      }
    } catch {
      // Invalid regex in reference data is a data issue, not a client error.
    }
  } else if (rules.postalCodeRequired && !normalized.postalCode) {
    errors.postalCode = 'Postal code is required';
  }

  const formatted = formatAddress(rules, normalized);
  return { valid: Object.keys(errors).length === 0, errors, normalized, formatted };
}

export function formatAddress(rules: AddressRules, values: Record<string, string>): string {
  const lines: string[] = [];
  for (const field of rules.fields) {
    if (field === 'country') continue;
    const value = values[toCamel(field)];
    if (value) lines.push(value);
  }
  return lines.join(', ');
}

function normalizeFieldList(raw: string[] | Record<string, unknown> | null): AddressField[] {
  const source = Array.isArray(raw) ? raw : raw && Array.isArray(raw.fields) ? (raw.fields as string[]) : [];
  const fields = source
    .map((entry) => FIELD_ALIASES[entry] ?? (ADDRESS_FIELDS.includes(entry as AddressField) ? (entry as AddressField) : null))
    .filter((entry): entry is AddressField => entry !== null);
  if (!fields.includes('country')) fields.push('country');
  if (fields.length === 0) {
    return ['address_line1', 'address_line2', 'city', 'region', 'postal_code', 'country'];
  }
  return [...new Set(fields)];
}

function normalizeAddress(input: AddressInput): Record<string, string> {
  const line1 = trim(input.addressLine1 ?? input.street);
  return {
    street: line1,
    addressLine1: line1,
    addressLine2: trim(input.addressLine2),
    building: trim(input.building),
    unit: trim(input.unit),
    district: trim(input.district),
    area: trim(input.area),
    city: trim(input.city),
    province: trim(input.province ?? input.region ?? input.state),
    state: trim(input.state ?? input.region ?? input.province),
    region: trim(input.region ?? input.state ?? input.province),
    postalCode: trim(input.postalCode).toUpperCase(),
    country: trim(input.country).toUpperCase(),
  };
}

const trim = (value?: string | null) => (value ?? '').trim();

function toCamel(field: AddressField): string {
  return field.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function assertValidAddress(valid: boolean): void {
  if (!valid) throw badRequest('Address failed country validation');
}
