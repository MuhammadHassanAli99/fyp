import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';

const log = loggerFor('fx.provider');

/**
 * Exchange-rate sourcing (§1 Currency, §28 Localisation).
 *
 * Rates are always expressed against the platform base currency, matching the
 * single-base layout `exchange_rates` uses. A driver only has to answer "what
 * is 1 base worth in each of these quotes"; triangulation stays in fx.service.
 */
export interface FxQuote {
  base: string;
  quote: string;
  rate: number;
}

export interface FxDriver {
  readonly name: string;
  fetchRates(base: string, quotes: readonly string[]): Promise<FxQuote[]>;
}

/**
 * The default. Deliberately fetches nothing: rates seeded by an operator are
 * treated as authoritative, and silently overwriting them with invented numbers
 * would be worse than not syncing at all.
 */
class StaticFxDriver implements FxDriver {
  readonly name = 'static';

  async fetchRates(base: string, quotes: readonly string[]): Promise<FxQuote[]> {
    log.info(
      { base, quotes: quotes.length },
      'FX_DRIVER=static: keeping the stored rates. Set FX_DRIVER=ecb to sync from the ECB reference feed.',
    );
    return [];
  }
}

/**
 * European Central Bank daily reference rates — public, free, no key, EUR-based.
 * Cross-rates for a non-EUR base are derived from the EUR leg, which is exactly
 * how the ECB intends the feed to be used.
 */
class EcbFxDriver implements FxDriver {
  readonly name = 'ecb';
  private static readonly FEED_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

  async fetchRates(base: string, quotes: readonly string[]): Promise<FxQuote[]> {
    const response = await fetch(EcbFxDriver.FEED_URL, {
      headers: { Accept: 'application/xml' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`ECB feed responded ${response.status}`);
    }

    const eurRates = parseEcbXml(await response.text());
    eurRates.set('EUR', 1);

    const upperBase = base.toUpperCase();
    const eurPerBase = eurRates.get(upperBase);
    if (!eurPerBase || eurPerBase <= 0) {
      throw new Error(`ECB feed does not quote ${upperBase}`);
    }

    const result: FxQuote[] = [];
    for (const quote of quotes) {
      const upperQuote = quote.toUpperCase();
      if (upperQuote === upperBase) continue;
      const eurPerQuote = eurRates.get(upperQuote);
      // A currency the ECB does not publish (PKR, for one) keeps its stored rate.
      if (!eurPerQuote || eurPerQuote <= 0) continue;
      result.push({ base: upperBase, quote: upperQuote, rate: eurPerQuote / eurPerBase });
    }

    log.info({ fetched: result.length, requested: quotes.length }, 'ECB reference rates fetched');
    return result;
  }
}

/**
 * Minimal extraction of `<Cube currency="USD" rate="1.09"/>`. A full XML parser
 * is not a dependency worth adding for one fixed-shape document.
 */
function parseEcbXml(xml: string): Map<string, number> {
  const rates = new Map<string, number>();
  const pattern = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g;
  for (const match of xml.matchAll(pattern)) {
    const code = match[1];
    const value = Number(match[2]);
    if (code && Number.isFinite(value) && value > 0) rates.set(code, value);
  }
  return rates;
}

const staticDriver = new StaticFxDriver();

export const fxDriver: FxDriver = (() => {
  switch (env.FX_DRIVER) {
    case 'ecb':
      return new EcbFxDriver();
    case 'openexchange':
      log.warn('FX_DRIVER=openexchange has no driver installed; using the static driver');
      return staticDriver;
    default:
      return staticDriver;
  }
})();
