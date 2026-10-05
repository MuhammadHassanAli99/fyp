import { goldRateDriver } from '../../providers/goldrate';
import { upsertGoldRate } from './gold.service';
import { generateForecasts } from './gold.ai';
import { tickAuctions } from '../../modules/auctions/auctions.service';
import { execute, queryRows, type Row } from '../../db/query';
import { loggerFor } from '../../config/logger';

const log = loggerFor('gold.jobs');

export async function syncGoldRates(): Promise<number> {
  const quotes = await goldRateDriver.fetchRates();
  for (const quote of quotes) {
    await upsertGoldRate({
      countryId: quote.countryId,
      cityId: quote.cityId,
      currency: quote.currency,
      metal: quote.metal,
      karat: quote.karat,
      ratePerGram: quote.ratePerGram,
      source: quote.source,
    });
  }
  log.info({ quotes: quotes.length, provider: goldRateDriver.name }, 'gold rates synced');
  return quotes.length;
}

export async function generateGoldForecasts(): Promise<number> {
  const targets = await queryRows<Row>(
    `SELECT DISTINCT country_id, currency, karat FROM gold_rates WHERE metal = 'gold' AND status = 'active'`,
  );
  let written = 0;
  for (const row of targets) {
    written += await generateForecasts({
      countryId: row.country_id === null ? null : Number(row.country_id),
      currency: String(row.currency),
      karat: Number(row.karat),
    });
  }
  log.info({ written }, 'gold forecasts generated');
  return written;
}

export async function tickGoldAuctions(): Promise<{ started: number; ended: number }> {
  const result = await tickAuctions();
  if (result.started || result.ended) {
    log.info(result, 'auction tick');
  }
  return result;
}

export async function protectGoldCertificateDocuments(): Promise<number> {
  const result = await execute(
    `UPDATE listing_documents d
       JOIN listings l ON l.id = d.listing_id
      SET d.is_public = 0
      WHERE l.marketplace_id = 1
        AND d.doc_type IN ('certificate','assay')
        AND d.is_public = 1`,
  );
  return result.affectedRows;
}
