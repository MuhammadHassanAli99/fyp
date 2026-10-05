import { queryOne, queryRows, type Row } from '../../db/query';
import { toBoolean, toNumber } from '../../db/sql';
import { getCurrencyDecimals } from '../locale/fx.service';
import { roundToDigits } from '../locale/money';

export interface TaxQuote {
  countryId: number;
  regionId: number | null;
  code: string | null;
  kind: string | null;
  name: string | null;
  rate: number;
  inclusive: boolean;
  taxAmount: number;
  netAmount: number;
  grossAmount: number;
  currency: string | null;
  version: {
    effectiveFrom: string | null;
    effectiveUntil: string | null;
  };
  appliesTo: string;
}

export type TaxAppliesTo = 'subscription' | 'promotion' | 'advertisement' | 'commission' | 'all';

/**
 * Central tax engine. Rates live in `tax_rules` (country / optional region,
 * applies_to, effective_from / effective_to). Product-type specificity is
 * encoded in `code` prefixes (GOLD_, PROPERTY_, VEHICLE_) when present.
 * Do not scatter VAT math through Flutter screens.
 */
export async function quoteTax(input: {
  countryId: number;
  amount: number;
  appliesTo?: TaxAppliesTo;
  regionId?: number | null;
  cityId?: number | null;
  marketplace?: 'gold' | 'property' | 'vehicles' | null;
  productType?: string | null;
  transactionType?: string | null;
  at?: Date | string | null;
  currency?: string | null;
}): Promise<TaxQuote> {
  const appliesTo = input.appliesTo ?? 'subscription';
  const at = toSqlDate(input.at);
  const amount = Math.max(0, input.amount);
  const digits = input.currency ? await getCurrencyDecimals(input.currency) : 2;

  const row = await selectRule({
    countryId: input.countryId,
    regionId: input.regionId ?? null,
    appliesTo,
    marketplace: input.marketplace ?? null,
    productType: input.productType ?? null,
    at,
  });

  if (!row) {
    const vat = await countryVat(input.countryId);
    if (vat > 0 && (appliesTo === 'all' || appliesTo === 'commission')) {
      return buildQuote({
        countryId: input.countryId,
        regionId: input.regionId ?? null,
        code: 'COUNTRY_VAT',
        kind: 'vat',
        name: 'Country VAT',
        rate: vat,
        inclusive: false,
        amount,
        digits,
        currency: input.currency ?? null,
        effectiveFrom: null,
        effectiveTo: null,
        appliesTo,
      });
    }
    return emptyQuote(input.countryId, input.regionId ?? null, amount, input.currency ?? null, appliesTo);
  }

  const rate = toNumber(row.rate) ?? 0;
  return buildQuote({
    countryId: input.countryId,
    regionId: row.region_id === null ? null : Number(row.region_id),
    code: (row.code as string | null) ?? null,
    kind: (row.kind as string | null) ?? null,
    name: (row.name as string | null) ?? null,
    rate,
    inclusive: toBoolean(row.is_inclusive),
    amount,
    digits,
    currency: input.currency ?? null,
    effectiveFrom: row.effective_from ? toIsoDate(row.effective_from as Date) : null,
    effectiveTo: row.effective_to ? toIsoDate(row.effective_to as Date) : null,
    appliesTo,
  });
}

export async function listActiveTaxRules(countryId: number, regionId?: number | null) {
  const rows = await queryRows<Row>(
    `SELECT id, country_id, region_id, code, name, kind, rate, applies_to, is_inclusive,
            effective_from, effective_to
       FROM tax_rules
      WHERE country_id = ?
        AND is_active = 1
        AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
        AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        AND (region_id IS NULL OR region_id = ?)
      ORDER BY region_id IS NULL, applies_to, code`,
    [countryId, regionId ?? 0],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    countryId: Number(row.country_id),
    regionId: row.region_id === null ? null : Number(row.region_id),
    code: String(row.code),
    name: String(row.name),
    kind: String(row.kind),
    rate: toNumber(row.rate) ?? 0,
    appliesTo: String(row.applies_to),
    isInclusive: toBoolean(row.is_inclusive),
    effectiveFrom: row.effective_from ? toIsoDate(row.effective_from as Date) : null,
    effectiveUntil: row.effective_to ? toIsoDate(row.effective_to as Date) : null,
    version: row.effective_from ? toIsoDate(row.effective_from as Date) : 'current',
  }));
}

async function selectRule(input: {
  countryId: number;
  regionId: number | null;
  appliesTo: TaxAppliesTo;
  marketplace: string | null;
  productType: string | null;
  at: string;
}): Promise<Row | null> {
  const rows = await queryRows<Row>(
    `SELECT code, name, kind, rate, is_inclusive, region_id, applies_to, effective_from, effective_to
       FROM tax_rules
      WHERE country_id = ?
        AND is_active = 1
        AND (applies_to = ? OR applies_to = 'all')
        AND (region_id IS NULL OR region_id = ?)
        AND (effective_from IS NULL OR effective_from <= ?)
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY
        CASE WHEN region_id = ? THEN 0 ELSE 1 END,
        CASE applies_to WHEN ? THEN 0 ELSE 1 END,
        CASE
          WHEN ? IS NOT NULL AND UPPER(code) LIKE CONCAT(UPPER(?), '_%') THEN 0
          WHEN ? IS NOT NULL AND UPPER(code) LIKE CONCAT(UPPER(?), '_%') THEN 1
          ELSE 2
        END,
        id
      LIMIT 8`,
    [
      input.countryId,
      input.appliesTo,
      input.regionId,
      input.at,
      input.at,
      input.regionId,
      input.appliesTo,
      input.marketplace,
      input.marketplace,
      input.productType,
      input.productType,
    ],
  );
  return rows[0] ?? null;
}

async function countryVat(countryId: number): Promise<number> {
  const row = await queryOne<Row>('SELECT vat_rate FROM countries WHERE id = ?', [countryId]);
  return toNumber(row?.vat_rate) ?? 0;
}

function buildQuote(input: {
  countryId: number;
  regionId: number | null;
  code: string | null;
  kind: string | null;
  name: string | null;
  rate: number;
  inclusive: boolean;
  amount: number;
  digits: number;
  currency: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  appliesTo: string;
}): TaxQuote {
  if (input.rate <= 0) {
    return emptyQuote(input.countryId, input.regionId, input.amount, input.currency, input.appliesTo);
  }

  if (input.inclusive) {
    const net = roundToDigits(input.amount / (1 + input.rate / 100), input.digits);
    return {
      countryId: input.countryId,
      regionId: input.regionId,
      code: input.code,
      kind: input.kind,
      name: input.name,
      rate: input.rate,
      inclusive: true,
      taxAmount: roundToDigits(input.amount - net, input.digits),
      netAmount: net,
      grossAmount: roundToDigits(input.amount, input.digits),
      currency: input.currency,
      version: { effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveTo },
      appliesTo: input.appliesTo,
    };
  }

  const taxAmount = roundToDigits((input.amount * input.rate) / 100, input.digits);
  const net = roundToDigits(input.amount, input.digits);
  return {
    countryId: input.countryId,
    regionId: input.regionId,
    code: input.code,
    kind: input.kind,
    name: input.name,
    rate: input.rate,
    inclusive: false,
    taxAmount,
    netAmount: net,
    grossAmount: roundToDigits(net + taxAmount, input.digits),
    currency: input.currency,
    version: { effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveTo },
    appliesTo: input.appliesTo,
  };
}

function emptyQuote(
  countryId: number,
  regionId: number | null,
  amount: number,
  currency: string | null,
  appliesTo: string,
): TaxQuote {
  return {
    countryId,
    regionId,
    code: null,
    kind: null,
    name: null,
    rate: 0,
    inclusive: false,
    taxAmount: 0,
    netAmount: amount,
    grossAmount: amount,
    currency,
    version: { effectiveFrom: null, effectiveUntil: null },
    appliesTo,
  };
}

function toSqlDate(value?: Date | string | null): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function toIsoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}
