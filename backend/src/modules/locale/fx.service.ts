import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { remember, cache, cacheKeys } from '../../config/cache';
import { toNumber } from '../../db/sql';
import { env } from '../../config/env';
import { bumpConfigVersion, isRateStale } from './config-versions';
import { loggerFor } from '../../config/logger';
import { multiplyMoney } from './money';

const log = loggerFor('fx');

/**
 * Currency conversion (§1 Currency).
 *
 * Rates are stored against a single base currency, so any pair is derived as
 * `quote / base`. That keeps the table O(n) instead of O(n²) and means one sync
 * job refreshes every pair at once.
 *
 * Listing prices are always *stored* in the seller's currency. Conversion is a
 * presentation concern applied per request, which is why this returns the rate
 * alongside the amount — the UI can then say "converted at 1 USD = 280 PKR".
 */
export interface ConvertedAmount {
  amount: number;
  currency: string;
  rate: number;
  base: string;
  asOf: string | null;
  stale: boolean;
}

const loadRateTable = () =>
  remember('fx:table', 300, async () => {
    const rows = await queryRows<Row>(
      'SELECT base_currency, quote_currency, rate, fetched_at FROM exchange_rates',
    );
    const table = new Map<string, { rate: number; asOf: string }>();
    for (const row of rows) {
      table.set(`${row.base_currency}:${row.quote_currency}`, {
        rate: toNumber(row.rate) ?? 0,
        asOf: (row.fetched_at as Date).toISOString(),
      });
    }
    return table;
  });

/** Rate to convert 1 unit of `from` into `to`. */
export async function getRate(
  from: string,
  to: string,
): Promise<{ rate: number; asOf: string | null; stale: boolean } | null> {
  const source = from.toUpperCase();
  const target = to.toUpperCase();
  if (source === target) return { rate: 1, asOf: null, stale: false };

  const table = await loadRateTable();
  const base = env.BASE_CURRENCY.toUpperCase();
  const wrap = (entry: { rate: number; asOf: string | null }) => ({
    rate: entry.rate,
    asOf: entry.asOf,
    stale: isRateStale(entry.asOf),
  });

  const direct = table.get(`${source}:${target}`);
  if (direct && direct.rate > 0) return wrap(direct);

  const inverse = table.get(`${target}:${source}`);
  if (inverse && inverse.rate > 0) return wrap({ rate: 1 / inverse.rate, asOf: inverse.asOf });

  const baseToSource = source === base ? { rate: 1, asOf: null as string | null } : table.get(`${base}:${source}`);
  const baseToTarget = target === base ? { rate: 1, asOf: null as string | null } : table.get(`${base}:${target}`);

  if (baseToSource && baseToTarget && baseToSource.rate > 0) {
    return wrap({
      rate: baseToTarget.rate / baseToSource.rate,
      asOf: baseToTarget.asOf ?? baseToSource.asOf,
    });
  }

  log.warn({ from: source, to: target }, 'no exchange rate path available');
  return null;
}

export async function convertAmount(amount: number, from: string, to: string): Promise<ConvertedAmount | null> {
  const rate = await getRate(from, to);
  if (!rate) return null;

  const decimals = await getCurrencyDecimals(to);
  return {
    amount: multiplyMoney(amount, rate.rate, decimals),
    currency: to.toUpperCase(),
    rate: rate.rate,
    base: from.toUpperCase(),
    asOf: rate.asOf,
    stale: rate.stale,
  };
}

/** JPY has no minor unit; KWD has three. Rounding to 2 everywhere looks wrong. */
export const getCurrencyDecimals = (code: string) =>
  remember(`fx:decimals:${code}`, 3600, async () => {
    const row = await queryOne<Row>('SELECT decimal_digits FROM currencies WHERE code = ?', [code.toUpperCase()]);
    return row ? Number(row.decimal_digits) : 2;
  });

export const listCurrencies = () =>
  remember(cacheKeys.currencies(), 3600, async () => {
    const rows = await queryRows<Row>(
      `SELECT c.code, c.name, c.symbol, c.symbol_position, c.decimal_digits, c.thousands_sep, c.decimal_sep,
              r.rate AS rate_from_base
         FROM currencies c
         LEFT JOIN exchange_rates r ON r.base_currency = ? AND r.quote_currency = c.code
        WHERE c.is_active = 1
        ORDER BY c.code`,
      [env.BASE_CURRENCY],
    );
    return rows.map((row) => ({
      code: String(row.code),
      name: String(row.name),
      symbol: String(row.symbol),
      symbolPosition: String(row.symbol_position) as 'prefix' | 'suffix',
      decimalDigits: Number(row.decimal_digits),
      thousandsSeparator: String(row.thousands_sep),
      decimalSeparator: String(row.decimal_sep),
      rateFromBase: toNumber(row.rate_from_base),
    }));
  });

/** Called by the FX sync job. Also snapshots history for charts and audits. */
export async function upsertRates(
  rates: Array<{ base: string; quote: string; rate: number }>,
  provider: string,
): Promise<number> {
  let written = 0;
  for (const entry of rates) {
    if (!(entry.rate > 0)) continue;
    await execute(
      `INSERT INTO exchange_rates (base_currency, quote_currency, rate, provider, fetched_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE rate = VALUES(rate), provider = VALUES(provider), fetched_at = CURRENT_TIMESTAMP`,
      [entry.base.toUpperCase(), entry.quote.toUpperCase(), entry.rate, provider],
    );
    await execute(
      `INSERT INTO exchange_rate_history (base_currency, quote_currency, rate, provider, as_of_date)
       VALUES (?, ?, ?, ?, CURRENT_DATE)
       ON DUPLICATE KEY UPDATE rate = VALUES(rate)`,
      [entry.base.toUpperCase(), entry.quote.toUpperCase(), entry.rate, provider],
    );
    written += 1;
  }

  await cache.del('fx:table');
  await cache.del(cacheKeys.currencies());
  await bumpConfigVersion('exchangeRates').catch((error) => log.warn({ err: error }, 'could not bump FX version'));
  return written;
}

/** Formats an amount using the currency's own conventions (§28 Currency formats). */
export async function formatMoney(amount: number, currency: string, locale?: string): Promise<string> {
  const currencies = await listCurrencies();
  const definition = currencies.find((item) => item.code === currency.toUpperCase());
  if (!definition) return `${amount} ${currency}`;

  const formatted = new Intl.NumberFormat(locale ?? 'en-US', {
    minimumFractionDigits: definition.decimalDigits,
    maximumFractionDigits: definition.decimalDigits,
  }).format(amount);

  return definition.symbolPosition === 'prefix' ? `${definition.symbol}${formatted}` : `${formatted} ${definition.symbol}`;
}
