import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { getRate } from '../../modules/locale/fx.service';

const log = loggerFor('goldrate.provider');

/**
 * Gold rate sourcing (§5 Live gold rates).
 *
 * There is no free public metals API worth depending on, so the shipped driver
 * does not invent one: it derives every country/currency/karat rate from the
 * one authoritative number an operator maintains — the international 24K spot
 * price in USD per gram — plus the FX table. Every derived rate is therefore
 * explainable, and a metalprice/goldapi driver slots in behind this interface
 * without the gold module changing.
 */
export interface GoldRateQuote {
  countryId: number | null;
  cityId: number | null;
  currency: string;
  metal: string;
  karat: number;
  ratePerGram: number;
  source: string;
}

export interface GoldRateDriver {
  readonly name: string;
  fetchRates(): Promise<GoldRateQuote[]>;
}

/** Karats quoted on the gold home screen (§5 Purity). */
const KARATS = [24, 22, 21, 18, 14] as const;

class StaticGoldRateDriver implements GoldRateDriver {
  readonly name = 'derived';

  async fetchRates(): Promise<GoldRateQuote[]> {
    // The anchor: international spot, 24K, base currency, no country.
    const anchor = await queryRows<Row>(
      `SELECT currency, rate_per_gram FROM gold_rates
        WHERE metal = 'gold' AND country_id IS NULL AND city_id IS NULL AND karat = 24.00
        ORDER BY (currency = ?) DESC, as_of DESC
        LIMIT 1`,
      [env.BASE_CURRENCY],
    );

    const spot = anchor[0];
    const spotPerGram = toNumber(spot?.rate_per_gram);
    if (!spot || spotPerGram === null || spotPerGram <= 0) {
      log.warn('no international 24K spot rate is stored; seed one before enabling gold.rates.sync');
      return [];
    }

    const spotCurrency = String(spot.currency);

    // Which country/currency pairs already exist decides what to refresh:
    // the job maintains the markets an operator has onboarded, and never
    // fabricates a market nobody configured.
    const targets = await queryRows<Row>(
      `SELECT DISTINCT country_id, city_id, currency FROM gold_rates WHERE metal = 'gold'`,
    );

    const quotes: GoldRateQuote[] = [];

    for (const target of targets) {
      const currency = String(target.currency);
      const conversion = await getRate(spotCurrency, currency);
      if (!conversion) {
        log.debug({ from: spotCurrency, to: currency }, 'skipping gold rate: no FX path');
        continue;
      }

      const pureRate = spotPerGram * conversion.rate;
      for (const karat of KARATS) {
        quotes.push({
          countryId: target.country_id === null ? null : Number(target.country_id),
          cityId: target.city_id === null ? null : Number(target.city_id),
          currency,
          metal: 'gold',
          karat,
          // Purity is linear in karat: 22K is 22/24 of pure gold by mass.
          ratePerGram: Number(((pureRate * karat) / 24).toFixed(4)),
          source: this.name,
        });
      }
    }

    log.info({ quotes: quotes.length, spotCurrency, spotPerGram }, 'gold rates derived from spot + FX');
    return quotes;
  }
}

const staticDriver = new StaticGoldRateDriver();

export const goldRateDriver: GoldRateDriver = (() => {
  if (env.GOLD_RATE_DRIVER !== 'static') {
    log.warn(
      { driver: env.GOLD_RATE_DRIVER },
      'no external metals driver is installed; deriving rates from the stored spot price instead',
    );
  }
  return staticDriver;
})();
