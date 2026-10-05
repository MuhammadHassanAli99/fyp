import { queryOne, type Row } from '../../db/query';
import { getSetting, setSetting } from './settings.service';

export interface ConfigVersionStamps {
  configuration: number;
  countries: number;
  languages: number;
  currencies: number;
  exchangeRates: number;
  features: number;
  exchangeRatesAsOf: string | null;
  featuresUpdatedAt: string | null;
}

const DEFAULT_STAMPS = {
  configuration: 1,
  countries: 1,
  languages: 1,
  currencies: 1,
  exchangeRates: 1,
  features: 1,
} as const;

export async function getConfigVersions(): Promise<ConfigVersionStamps> {
  const [stored, fxAsOf, featuresUpdatedAt] = await Promise.all([
    getSetting<Partial<typeof DEFAULT_STAMPS>>('config.versions', DEFAULT_STAMPS),
    queryOne<Row>('SELECT MAX(fetched_at) AS as_of FROM exchange_rates'),
    queryOne<Row>('SELECT MAX(updated_at) AS updated_at FROM feature_flags'),
  ]);

  return {
    configuration: Number(stored.configuration ?? 1),
    countries: Number(stored.countries ?? 1),
    languages: Number(stored.languages ?? 1),
    currencies: Number(stored.currencies ?? 1),
    exchangeRates: Number(stored.exchangeRates ?? 1),
    features: Number(stored.features ?? 1),
    exchangeRatesAsOf: fxAsOf?.as_of ? new Date(fxAsOf.as_of as Date).toISOString() : null,
    featuresUpdatedAt: featuresUpdatedAt?.updated_at
      ? new Date(featuresUpdatedAt.updated_at as Date).toISOString()
      : null,
  };
}

export async function bumpConfigVersion(key: keyof typeof DEFAULT_STAMPS): Promise<void> {
  const current = await getConfigVersions();
  const next = {
    configuration: current.configuration,
    countries: current.countries,
    languages: current.languages,
    currencies: current.currencies,
    exchangeRates: current.exchangeRates,
    features: current.features,
  };
  next[key] += 1;
  if (key !== 'configuration') next.configuration += 1;
  await setSetting('config.versions', next, 'global', true);
}

/** Rates older than this are still shown, but marked stale for the UI. */
export const FX_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isRateStale(asOf: string | Date | null | undefined, now = Date.now()): boolean {
  if (!asOf) return true;
  const millis = asOf instanceof Date ? asOf.getTime() : Date.parse(asOf);
  if (!Number.isFinite(millis)) return true;
  return now - millis > FX_STALE_AFTER_MS;
}
