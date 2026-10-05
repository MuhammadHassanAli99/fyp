import { Router } from 'express';
import { marketplaceRegistry } from './marketplaces/module';
import { loggerFor } from './config/logger';

import { bootstrapRouter } from './modules/bootstrap/bootstrap.routes';
import { healthRouter } from './modules/health/health.routes';
import { localeRouter } from './modules/locale/locale.routes';
import { configurationRouter } from './modules/locale/configuration.routes';
import { locationsAliasRouter } from './modules/geo/geo.routes';
import { authRouter } from './modules/auth/auth.routes';
import { usersRouter } from './modules/users/users.routes';
import { catalogRouter } from './modules/catalog/catalog.routes';
import { listingsRouter } from './modules/listings/listings.routes';
import { searchRouter } from './modules/search/search.routes';
import { comparisonRouter } from './modules/comparison/comparison.routes';
import { favoritesRouter } from './modules/favorites/favorites.routes';
import { shareRouter } from './modules/share/share.routes';
import { chatRouter } from './modules/chat/chat.routes';
import { callsRouter } from './modules/calls/calls.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { subscriptionsRouter } from './modules/subscriptions/subscriptions.routes';
import { paymentsRouter } from './modules/payments/payments.routes';
import { reviewsRouter } from './modules/reviews/reviews.routes';
import { adsRouter } from './modules/ads/ads.routes';
import { aiRouter } from './modules/ai/ai.routes';
import { sellerRouter } from './modules/seller/seller.routes';
import { supportRouter } from './modules/support/support.routes';
import { moderationRouter } from './modules/moderation/moderation.routes';
import { analyticsRouter } from './modules/analytics/analytics.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { securityRouter } from './modules/security/security.routes';
import { riskRouter } from './modules/risk/risk.routes';
import { geoRouter } from './modules/geo/geo.routes';
import { filtersRouter } from './modules/filters/filters.routes';
import { mapsRouter } from './modules/maps/maps.routes';
import { uploadsRouter } from './modules/uploads/uploads.routes';
import { systemRouter } from './modules/system/system.routes';
import { businessRouter } from './modules/business/business.routes';
import { verificationRouter } from './modules/verification/verification.routes';
import { auctionsRouter } from './modules/auctions/auctions.routes';

const log = loggerFor('routes');

/**
 * Router assembly.
 *
 * Platform modules mount at fixed paths. Marketplace modules mount themselves at
 * `/<code>` from the registry, which is why adding a marketplace never touches
 * this file's platform section (§30).
 */
export function buildApiRouter(): Router {
  const router = Router();

  /* Platform ------------------------------------------------------------- */
  router.use('/health', healthRouter);
  router.use('/system', systemRouter);
  router.use('/bootstrap', bootstrapRouter);
  router.use('/configuration', configurationRouter);
  router.use('/locale', localeRouter);
  router.use('/geo', geoRouter);
  router.use('/locations', locationsAliasRouter);
  router.use('/filters', filtersRouter);
  router.use('/maps', mapsRouter);
  router.use('/auth', authRouter);
  router.use('/users', usersRouter);
  router.use('/businesses', businessRouter);
  router.use('/verification', verificationRouter);
  router.use('/catalog', catalogRouter);
  router.use('/uploads', uploadsRouter);

  /* Commerce ------------------------------------------------------------- */
  router.use('/listings', listingsRouter);
  router.use('/auctions', auctionsRouter);
  router.use('/search', searchRouter);
  router.use('/comparisons', comparisonRouter);
  router.use('/favorites', favoritesRouter);
  router.use('/share', shareRouter);
  router.use('/reviews', reviewsRouter);

  /* Communication -------------------------------------------------------- */
  router.use('/chat', chatRouter);
  router.use('/calls', callsRouter);
  router.use('/notifications', notificationsRouter);

  /* Money ---------------------------------------------------------------- */
  router.use('/subscriptions', subscriptionsRouter);
  router.use('/payments', paymentsRouter);
  router.use('/ads', adsRouter);

  /* Intelligence & trust ------------------------------------------------- */
  router.use('/ai', aiRouter);
  router.use('/moderation', moderationRouter);
  router.use('/risk', riskRouter);
  router.use('/analytics', analyticsRouter);
  router.use('/security', securityRouter);

  /* Dashboards ----------------------------------------------------------- */
  router.use('/seller', sellerRouter);
  router.use('/support', supportRouter);
  router.use('/admin', adminRouter);

  /* Marketplace modules -------------------------------------------------- */
  for (const module of marketplaceRegistry.all()) {
    const moduleRouter = module.router?.();
    if (moduleRouter) {
      router.use(`/${module.code}`, moduleRouter);
      log.debug({ marketplace: module.code, path: `/${module.code}` }, 'mounted marketplace router');
    }
  }

  return router;
}
