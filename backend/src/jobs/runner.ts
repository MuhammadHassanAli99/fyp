import { loggerFor } from '../config/logger';
import { execute, queryRows, type Row } from '../db/query';
import { env } from '../config/env';
import { fxDriver } from '../providers/fx';
import { upsertRates } from '../modules/locale/fx.service';
import { generateGoldForecasts, protectGoldCertificateDocuments, syncGoldRates, tickGoldAuctions } from '../marketplaces/gold/gold.jobs';
import { advanceLeaseSchedules, rollupPropertyAnalytics, runPropertyMaintenance } from '../marketplaces/property/property.jobs';
import { rollupVehicleAnalytics, runVehicleMaintenance, trackVehicleShipments } from '../marketplaces/vehicles/vehicles.jobs';
import {
  matchSavedSearches,
  processOutbox as processListingOutbox,
  runAnalyticsRollup,
  runListingExpiry,
  runPromotionExpiry,
  runSearchReindex,
} from '../modules/listings/listings.jobs';
import {
  runSearchCachePurge,
  runSearchEmbed,
  runSavedSearchDigestsJob,
  runSuggestionRefresh,
  runTrendingRollup,
} from '../modules/search/search.jobs';
import { runCallTimeouts, runMaskedExpiry } from '../modules/communication/communication.jobs';
import {
  dispatchDueScheduled,
  dispatchSubscriptionReminders,
  expireStaleNotifications,
  flushNotificationDigests,
  processNotificationJobs,
} from '../modules/notifications/notifications.jobs';
import { runSubscriptionLifecycle } from '../modules/subscriptions/subscriptions.jobs';
import { runPaymentJobs, snapshotReconciliation } from '../modules/payments/payments.jobs';
import { processQueuedAiJobs } from '../modules/ai/ai.orchestrator';
import { processRiskJobs } from '../modules/risk/risk.jobs';
import { runReviewJobs } from '../modules/reviews/reviews.jobs';
import { runAdJobs } from '../modules/ads/ads.jobs';
import { dispatchAdminBroadcasts, runAdminReportJobs } from '../modules/admin/admin.jobs';
import { rollupSellerMetrics } from '../modules/seller/seller.jobs';
import { runPlatformAnalyticsRollup } from '../modules/analytics/analytics.rollup';
import { runSecurityJobs, runScheduledBackup } from '../modules/security/security.jobs';
import { processMediaTranscodes } from '../modules/media/media.transcode';
import { runSupportMaintenance, runSupportSlaSweep } from '../modules/support/support.jobs';

const log = loggerFor('jobs');

const timers: NodeJS.Timeout[] = [];
let running = false;

/**
 * Lightweight in-process scheduler. Real deployments should run these as
 * separate workers; here they are safe no-ops or light SQL sweeps.
 */
export function startScheduler(): void {
  if (running) return;
  running = true;

  if (env.FX_DRIVER !== 'static') {
    timers.push(setInterval(() => void syncFxRates(), 6 * 60 * 60 * 1000));
    void syncFxRates();
  }

  timers.push(setInterval(() => void expireListings(), 60 * 60 * 1000));
  timers.push(setInterval(() => void processOutbox(), 30_000));
  timers.push(setInterval(() => void expirePromotionsJob(), 5 * 60 * 1000));
  timers.push(setInterval(() => void rollupListingAnalyticsJob(), 60 * 60 * 1000));
  timers.push(setInterval(() => void rollupPlatformAnalyticsJob(), 60 * 60 * 1000));
  timers.push(setInterval(() => void runSecurityJobsJob(), 60 * 1000));
  timers.push(setInterval(() => void runBackupJob(), 24 * 60 * 60 * 1000));
  timers.push(setInterval(() => void reindexListingsJob(), 5 * 60 * 1000));
  timers.push(setInterval(() => void matchSavedSearchesJob(), 15 * 60 * 1000));
  timers.push(setInterval(() => void trendingRollupJob(), 60 * 60 * 1000));
  timers.push(setInterval(() => void searchCachePurgeJob(), 15 * 60 * 1000));
  timers.push(setInterval(() => void searchEmbedJob(), 10 * 60 * 1000));
  timers.push(setInterval(() => void savedSearchDigestJob(), 60 * 60 * 1000));
  timers.push(setInterval(() => void suggestionRefreshJob(), 60 * 60 * 1000));
  timers.push(setInterval(() => void runGoldRates(), 15 * 60 * 1000));
  timers.push(setInterval(() => void runGoldForecasts(), 6 * 60 * 60 * 1000));
  timers.push(setInterval(() => void runGoldAuctions(), 30_000));
  timers.push(setInterval(() => void runGoldDocumentProtect(), 60 * 60 * 1000));
  timers.push(setInterval(() => void runPropertyJobs(), 15 * 60 * 1000));
  timers.push(setInterval(() => void runPropertyAnalytics(), 6 * 60 * 60 * 1000));
  timers.push(setInterval(() => void runPropertyLeases(), 60 * 60 * 1000));
  timers.push(setInterval(() => void runVehicleJobs(), 15 * 60 * 1000));
  timers.push(setInterval(() => void runVehicleAnalytics(), 6 * 60 * 60 * 1000));
  timers.push(setInterval(() => void runVehicleShipments(), 15 * 60 * 1000));
  timers.push(setInterval(() => void runCallTimeouts(), 15_000));
  timers.push(setInterval(() => void runMaskedExpiry(), 5 * 60 * 1000));
  timers.push(setInterval(() => void runNotificationJobs(), 5_000));
  timers.push(setInterval(() => void runScheduledNotifications(), 30_000));
  timers.push(setInterval(() => void runNotificationDigests(), 15 * 60 * 1000));
  timers.push(setInterval(() => void runNotificationMaintenance(), 60 * 60 * 1000));
  timers.push(setInterval(() => void runSubscriptionJobs(), 15 * 60 * 1000));
  timers.push(setInterval(() => void runPaymentMaintenance(), 60 * 1000));
  timers.push(setInterval(() => void runPaymentReconciliation(), 60 * 60 * 1000));
  timers.push(setInterval(() => void runQueuedAiJobs(), 10_000));
  timers.push(setInterval(() => void runRiskJobs(), 10_000));
  timers.push(setInterval(() => void runReviewMaintenance(), 60 * 1000));
  timers.push(setInterval(() => void runAdMaintenance(), 5 * 60 * 1000));
  timers.push(setInterval(() => void runMediaTranscodeJob(), 30_000));
  timers.push(setInterval(() => void runAdminReports(), 15_000));
  timers.push(setInterval(() => void runAdminBroadcasts(), 30_000));
  timers.push(setInterval(() => void runSupportSlaJob(), 5 * 60 * 1000));
  timers.push(setInterval(() => void runSupportMaintenanceJob(), 60 * 60 * 1000));
  void runGoldRates();
  void runGoldAuctions();
  void runPropertyJobs();
  void runVehicleJobs();
  void runQueuedAiJobs();
  void runRiskJobs();
  void runReviewMaintenance();
  void runAdMaintenance();
  void rollupPlatformAnalyticsJob();

  log.info({ jobs: timers.length }, 'scheduler started');
}

export function stopScheduler(): void {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
  running = false;
  log.info('scheduler stopped');
}

async function syncFxRates(): Promise<void> {
  const startedAt = Date.now();
  try {
    const quotes = await queryRows<Row>('SELECT code FROM currencies WHERE is_active = 1');
    const fetched = await fxDriver.fetchRates(
      env.BASE_CURRENCY,
      quotes.map((row) => String(row.code)),
    );
    if (fetched.length === 0) {
      log.info({ driver: fxDriver.name }, 'FX sync produced no quotes; keeping stored rates');
      await recordJobRun('fx_sync', 'success', Date.now() - startedAt, 0);
      return;
    }
    const written = await upsertRates(
      fetched.map((quote) => ({ base: quote.base, quote: quote.quote, rate: quote.rate })),
      fxDriver.name,
    );
    log.info({ driver: fxDriver.name, written }, 'FX rates upserted');
    await recordJobRun('fx_sync', 'success', Date.now() - startedAt, written);
  } catch (error) {
    log.warn({ err: error }, 'fx sync failed');
    await recordJobRun('fx_sync', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function expireListings(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await runListingExpiry();
    log.info({ processed }, 'listing expiry sweep');
    await recordJobRun('listing_expiry', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'listing expiry sweep failed');
    await recordJobRun('listing_expiry', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function processOutbox(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await processListingOutbox();
    if (processed > 0) {
      log.info({ processed }, 'outbox processed');
      await recordJobRun('outbox.process', 'success', Date.now() - startedAt, processed);
    }
  } catch (error) {
    log.warn({ err: error }, 'outbox process failed');
    await recordJobRun('outbox.process', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function expirePromotionsJob(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await runPromotionExpiry();
    await recordJobRun('listing.promotions.expire', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'promotion expiry failed');
    await recordJobRun('listing.promotions.expire', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function rollupListingAnalyticsJob(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await runAnalyticsRollup();
    const sellerRows = await rollupSellerMetrics();
    await recordJobRun('listing.analytics.rollup', 'success', Date.now() - startedAt, processed + sellerRows);
  } catch (error) {
    log.warn({ err: error }, 'listing analytics rollup failed');
    await recordJobRun('listing.analytics.rollup', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

let platformAnalyticsBackfilled = false;

async function rollupPlatformAnalyticsJob(): Promise<void> {
  const startedAt = Date.now();
  try {
    const days: Array<string | undefined> = platformAnalyticsBackfilled
      ? [undefined]
      : Array.from({ length: 14 }, (_, offset) => {
          const date = new Date();
          date.setUTCDate(date.getUTCDate() - offset);
          return date.toISOString().slice(0, 10);
        });
    platformAnalyticsBackfilled = true;
    let processed = 0;
    let lastDay = '';
    for (const day of days) {
      const result = await runPlatformAnalyticsRollup(day);
      processed += result.processed;
      lastDay = result.day;
    }
    await recordJobRun('analytics.rollup', 'success', Date.now() - startedAt, processed);
    log.info({ processed, day: lastDay, backfill: days.length > 1 }, 'platform analytics rollup');
  } catch (error) {
    log.warn({ err: error }, 'platform analytics rollup failed');
    await recordJobRun('analytics.rollup', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function reindexListingsJob(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await runSearchReindex();
    await recordJobRun('listing.search.reindex', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'listing search reindex failed');
    await recordJobRun('listing.search.reindex', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function matchSavedSearchesJob(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await matchSavedSearches();
    await recordJobRun('listing.saved_search.match', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'saved search match failed');
    await recordJobRun('listing.saved_search.match', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function trendingRollupJob(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await runTrendingRollup();
    await recordJobRun('search.trending.rollup', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'trending rollup failed');
    await recordJobRun('search.trending.rollup', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function searchCachePurgeJob(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await runSearchCachePurge();
    await recordJobRun('search.cache.purge', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'search cache purge failed');
    await recordJobRun('search.cache.purge', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function searchEmbedJob(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await runSearchEmbed();
    await recordJobRun('search.embed.pending', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'search embed failed');
    await recordJobRun('search.embed.pending', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function savedSearchDigestJob(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await runSavedSearchDigestsJob();
    await recordJobRun('search.alerts.digest', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'saved search digest failed');
    await recordJobRun('search.alerts.digest', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function suggestionRefreshJob(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await runSuggestionRefresh();
    await recordJobRun('search.suggestions.refresh', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'suggestion refresh failed');
    await recordJobRun('search.suggestions.refresh', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runGoldRates(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await syncGoldRates();
    await recordJobRun('gold.rates.sync', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'gold rate sync failed');
    await recordJobRun('gold.rates.sync', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runGoldForecasts(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await generateGoldForecasts();
    await recordJobRun('gold.forecast.generate', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'gold forecast generation failed');
    await recordJobRun('gold.forecast.generate', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runGoldAuctions(): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await tickGoldAuctions();
    await recordJobRun('gold.auctions.tick', 'success', Date.now() - startedAt, (result?.started ?? 0) + (result?.ended ?? 0));
  } catch (error) {
    log.warn({ err: error }, 'gold auction tick failed');
    await recordJobRun('gold.auctions.tick', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runGoldDocumentProtect(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await protectGoldCertificateDocuments();
    await recordJobRun('gold.documents.protect', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'gold certificate document protect failed');
    await recordJobRun('gold.documents.protect', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runPropertyJobs(): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await runPropertyMaintenance();
    await recordJobRun(
      'property.maintenance',
      'success',
      Date.now() - startedAt,
      result.documents + result.offers + result.leases + result.bookings + result.rentReminders,
    );
  } catch (error) {
    log.warn({ err: error }, 'property maintenance failed');
    await recordJobRun('property.maintenance', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runPropertyAnalytics(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await rollupPropertyAnalytics();
    await recordJobRun('property.analytics.rollup', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'property analytics rollup failed');
    await recordJobRun('property.analytics.rollup', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runPropertyLeases(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await advanceLeaseSchedules();
    await recordJobRun('property.leases.advance', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'property lease schedule failed');
    await recordJobRun('property.leases.advance', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runVehicleJobs(): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await runVehicleMaintenance();
    await recordJobRun(
      'vehicle.maintenance',
      'success',
      Date.now() - startedAt,
      result.documents + result.offers + result.bookings + result.reminders,
    );
  } catch (error) {
    log.warn({ err: error }, 'vehicle maintenance failed');
    await recordJobRun('vehicle.maintenance', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runVehicleAnalytics(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await rollupVehicleAnalytics();
    await recordJobRun('vehicle.analytics.rollup', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'vehicle analytics rollup failed');
    await recordJobRun('vehicle.analytics.rollup', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runVehicleShipments(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await trackVehicleShipments();
    await recordJobRun('vehicle.shipments.poll', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'vehicle shipment poll failed');
    await recordJobRun('vehicle.shipments.poll', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runNotificationJobs(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await processNotificationJobs();
    if (processed > 0) {
      await recordJobRun('notifications.deliver', 'success', Date.now() - startedAt, processed);
    }
  } catch (error) {
    log.warn({ err: error }, 'notification job sweep failed');
    await recordJobRun('notifications.deliver', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runScheduledNotifications(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await dispatchDueScheduled();
    if (processed > 0) {
      await recordJobRun('notifications.scheduled', 'success', Date.now() - startedAt, processed);
    }
  } catch (error) {
    log.warn({ err: error }, 'scheduled notification sweep failed');
    await recordJobRun('notifications.scheduled', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runNotificationDigests(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await flushNotificationDigests();
    await recordJobRun('notifications.digest', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'notification digest flush failed');
    await recordJobRun('notifications.digest', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runNotificationMaintenance(): Promise<void> {
  const startedAt = Date.now();
  try {
    const expired = await expireStaleNotifications();
    const reminders = await dispatchSubscriptionReminders();
    await recordJobRun('notifications.metrics', 'success', Date.now() - startedAt, expired + reminders);
  } catch (error) {
    log.warn({ err: error }, 'notification maintenance failed');
    await recordJobRun('notifications.metrics', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runSubscriptionJobs(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await runSubscriptionLifecycle();
    await recordJobRun('subscription.lifecycle', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'subscription lifecycle failed');
    await recordJobRun('subscription.lifecycle', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runPaymentMaintenance(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await runPaymentJobs();
    await recordJobRun('payment.expire', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'payment jobs failed');
    await recordJobRun('payment.expire', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runPaymentReconciliation(): Promise<void> {
  const startedAt = Date.now();
  try {
    const written = await snapshotReconciliation();
    await recordJobRun('payment.reconciliation', 'success', Date.now() - startedAt, written);
  } catch (error) {
    log.warn({ err: error }, 'payment reconciliation failed');
    await recordJobRun('payment.reconciliation', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runQueuedAiJobs(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await processQueuedAiJobs();
    if (processed > 0) {
      log.info({ processed }, 'queued AI jobs processed');
      await recordJobRun('ai.queued', 'success', Date.now() - startedAt, processed);
    }
  } catch (error) {
    log.warn({ err: error }, 'queued AI jobs failed');
    await recordJobRun('ai.queued', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runRiskJobs(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await processRiskJobs();
    if (processed > 0) {
      log.info({ processed }, 'queued risk jobs processed');
      await recordJobRun('risk.queued', 'success', Date.now() - startedAt, processed);
    }
  } catch (error) {
    log.warn({ err: error }, 'queued risk jobs failed');
    await recordJobRun('risk.queued', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runReviewMaintenance(): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await runReviewJobs();
    await recordJobRun('reviews.aggregate', 'success', Date.now() - startedAt, result.aggregates + result.media + result.invitations);
  } catch (error) {
    log.warn({ err: error }, 'review jobs failed');
    await recordJobRun('reviews.aggregate', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runAdMaintenance(): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await runAdJobs();
    await recordJobRun('ads.rollup', 'success', Date.now() - startedAt, result.rollup + result.scheduled);
  } catch (error) {
    log.warn({ err: error }, 'ad jobs failed');
    await recordJobRun('ads.rollup', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

let transcodeBusy = false;

async function runMediaTranscodeJob(): Promise<void> {
  if (transcodeBusy) return;
  transcodeBusy = true;
  const startedAt = Date.now();
  try {
    const processed = await processMediaTranscodes(2);
    await recordJobRun('media.transcode', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'media transcode failed');
    await recordJobRun('media.transcode', 'failed', Date.now() - startedAt, 0, String(error));
  } finally {
    transcodeBusy = false;
  }
}

async function runAdminReports(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await runAdminReportJobs();
    if (processed > 0) {
      await recordJobRun('admin.reports', 'success', Date.now() - startedAt, processed);
    }
  } catch (error) {
    log.warn({ err: error }, 'admin report jobs failed');
    await recordJobRun('admin.reports', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runAdminBroadcasts(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await dispatchAdminBroadcasts();
    if (processed > 0) {
      await recordJobRun('admin.broadcasts', 'success', Date.now() - startedAt, processed);
    }
  } catch (error) {
    log.warn({ err: error }, 'admin broadcasts failed');
    await recordJobRun('admin.broadcasts', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runSecurityJobsJob(): Promise<void> {
  const startedAt = Date.now();
  try {
    await runSecurityJobs();
    await recordJobRun('security.monitor', 'success', Date.now() - startedAt, 1);
  } catch (error) {
    log.warn({ err: error }, 'security jobs failed');
    await recordJobRun('security.monitor', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runBackupJob(): Promise<void> {
  const startedAt = Date.now();
  try {
    await runScheduledBackup();
    await recordJobRun('security.backup', 'success', Date.now() - startedAt, 1);
  } catch (error) {
    log.warn({ err: error }, 'backup job failed');
    await recordJobRun('security.backup', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runSupportSlaJob(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await runSupportSlaSweep();
    await recordJobRun('tickets.sla_check', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'support SLA sweep failed');
    await recordJobRun('tickets.sla_check', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function runSupportMaintenanceJob(): Promise<void> {
  const startedAt = Date.now();
  try {
    const processed = await runSupportMaintenance();
    await recordJobRun('tickets.autoclose', 'success', Date.now() - startedAt, processed);
  } catch (error) {
    log.warn({ err: error }, 'support maintenance failed');
    await recordJobRun('tickets.autoclose', 'failed', Date.now() - startedAt, 0, String(error));
  }
}

async function recordJobRun(jobCode: string, status: 'success' | 'failed', durationMs: number, processed: number, error?: string) {
  try {
    await execute(
      `INSERT INTO job_runs (job_code, status, duration_ms, processed, error, finished_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [jobCode, status, durationMs, processed, error ?? null],
    );
  } catch {
    // job_runs may not exist in empty databases — ignore
  }
}

/** Allow running the scheduler standalone via `npm run jobs`. */
if (require.main === module) {
  void (async () => {
    const { initCache } = await import('../config/cache');
    await initCache();
    startScheduler();
    log.info('job runner started in standalone mode');
  })();
}
