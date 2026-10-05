import http from 'node:http';
import { env } from './config/env';
import { logger } from './config/logger';
import { closePool, verifyConnection } from './db/pool';
import { createApp } from './app';
import { installProcessHandlers } from './middleware/error-handler';
import { registerMarketplaceModules, bindMarketplaceIds } from './marketplaces';
import { registerEventHandlers } from './modules/events';
import { startScheduler, stopScheduler } from './jobs/runner';
import { attachRealtime, closeRealtime } from './realtime/socket';
import { assertDatabaseCompatible } from './core/schema-compatibility';
import { assertSecretsHygiene } from './modules/security/security.secrets';
import { closeCache, initCache } from './config/cache';
import { beginShutdown, sleep, withTimeout } from './core/lifecycle';
import { messaging, messagingStatus } from './providers/messaging';

/**
 * Boot sequence. The order matters:
 *   1. Verify the database — nothing else can work without it, so fail loudly now.
 *   2. Register marketplace modules and bind their database ids, so the router
 *      assembly and every module lookup can resolve them.
 *   3. Wire cross-module event handlers before the first request can emit one.
 *   4. Build and start the HTTP server.
 *   5. Attach realtime and the job scheduler last: they are enhancements, and a
 *      failure there must not stop the API from serving.
 */
async function main(): Promise<void> {
  logger.info({ env: env.NODE_ENV, node: process.version }, `starting ${env.APP_NAME} API`);
  assertSecretsHygiene();

  await verifyConnection();
  await assertDatabaseCompatible();
  await initCache();

  registerMarketplaceModules();
  await bindMarketplaceIds();

  registerEventHandlers();

  const app = createApp();
  const server = http.createServer(app);

  // Slowloris protection: without these, idle sockets accumulate indefinitely.
  server.headersTimeout = 30_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 15_000;

  /**
   * Ordered drain. Each phase is bounded so a stuck dependency cannot turn a
   * deploy into a SIGKILL mid-write:
   *
   *   1. Fail readiness, then wait — the load balancer needs a moment to notice
   *      and stop sending new requests before we close the listener.
   *   2. Stop background work so no new queries start.
   *   3. Close the listener and let in-flight requests finish.
   *   4. Release outbound connections (SMTP pool, cache, database) last.
   */
  const shutdown = async (): Promise<void> => {
    logger.info({ drainMs: env.SHUTDOWN_DRAIN_MS }, 'shutting down');
    beginShutdown();

    if (env.SHUTDOWN_DRAIN_MS > 0) await sleep(env.SHUTDOWN_DRAIN_MS);

    stopScheduler();
    await withTimeout('realtime', 5_000, () => closeRealtime());
    await withTimeout(
      'http',
      env.SHUTDOWN_TIMEOUT_MS,
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          // Express 5 on Node 20+ can end idle keep-alive sockets itself; older
          // runtimes would otherwise hold the listener open for keepAliveTimeout.
          server.closeIdleConnections?.();
        }),
    );
    await withTimeout('messaging', 5_000, () => messaging.close());
    await withTimeout('cache', 5_000, () => closeCache());
    await withTimeout('database', 10_000, () => closePool());

    logger.info('shutdown complete');
  };

  installProcessHandlers(shutdown);

  await listenHttp(server, env.PORT, env.HOST);

  logger.info(
    { url: `${env.APP_URL}${env.API_PREFIX}`, host: env.HOST, port: env.PORT },
    'API listening',
  );

  // Which transports are actually live. `log` here means "delivers nothing",
  // so this line is the first thing to check when a user reports a missing OTP.
  logger.info(messagingStatus(), 'messaging drivers');

  if (env.ENABLE_REALTIME) {
    try {
      attachRealtime(server);
      logger.info('realtime gateway attached');
    } catch (error) {
      logger.error({ err: error }, 'realtime gateway failed to attach; continuing without it');
    }
  }

  if (env.ENABLE_JOBS) {
    try {
      startScheduler();
      logger.info('job scheduler started');
    } catch (error) {
      logger.error({ err: error }, 'job scheduler failed to start; continuing without it');
    }
  }
}

function listenHttp(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

main().catch((error) => {
  const err = error as NodeJS.ErrnoException;
  if (err.code === 'EADDRINUSE') {
    logger.fatal(
      { host: env.HOST, port: env.PORT },
      `Port ${env.PORT} is already in use. Stop the other API process, then start again.`,
    );
  } else {
    logger.fatal({ err: error }, 'failed to start');
  }
  process.exit(1);
});
