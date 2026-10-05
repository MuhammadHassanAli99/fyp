import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { loggerFor } from './config/logger';
import { requestContext } from './middleware/request-context';
import { authenticate } from './middleware/authenticate';
import { identifyDevice } from './middleware/device';
import { globalRateLimit } from './middleware/rate-limit';
import { applicationWaf } from './middleware/waf';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { buildApiRouter } from './routes';

const log = loggerFor('app');

/**
 * Express application assembly. Middleware order is the pipeline described in
 * docs/ARCHITECTURE.md §3.1 and is load-bearing:
 *
 *   security → parsing → context → device → rate limit → auth → routes → errors
 *
 * `authenticate` must run before the rate limiter's key generator needs a user,
 * but after `requestContext` has established the ambient scope — hence the exact
 * ordering below rather than a more "natural" grouping.
 */
export function createApp(): Express {
  const app = express();

  // Behind a load balancer, `req.ip` is only trustworthy when this is set.
  if (env.TRUST_PROXY) app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.set('etag', 'strong');

  /* 1. Security headers ---------------------------------------------------- */
  if (env.isProduction) {
    app.use((req, res, next) => {
      const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol ?? '');
      if (env.TRUST_PROXY && proto.toLowerCase() === 'http') {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'HTTPS is required' },
        });
        return;
      }
      next();
    });
  }

  app.use(
    helmet({
      contentSecurityPolicy: env.isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              imgSrc: ["'self'", 'data:', 'https:'],
              mediaSrc: ["'self'", 'https:'],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              connectSrc: ["'self'", 'https:', 'wss:'],
              frameAncestors: ["'none'"],
            },
          }
        : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );

  app.use(
    cors({
      origin: env.CORS_ORIGINS.includes('*') ? true : env.CORS_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Request-Id',
        'X-Country',
        'X-Language',
        'X-Currency',
        'X-Timezone',
        'X-Platform',
        'X-App-Version',
        'X-Device-Id',
        'X-Device-Name',
        'X-Device-Model',
        'X-Device-Manufacturer',
        'X-OS-Version',
        'X-Device-Rooted',
        'X-Device-Jailbroken',
        'X-Device-Emulator',
        'X-Device-Debugging',
        'X-Device-Automation',
        'X-Guest-Id',
        'X-Marketplace',
        'If-None-Match',
      ],
      exposedHeaders: [
        'X-Request-Id',
        'X-Resolved-Country',
        'X-Resolved-Language',
        'X-Resolved-Currency',
        'X-Requires-Challenge',
        'RateLimit',
        'RateLimit-Policy',
        'Retry-After',
        'ETag',
      ],
      maxAge: 86_400,
    }),
  );

  /* 2. Parsing ------------------------------------------------------------- */
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        if (req.path.startsWith('/uploads')) return false;
        return compression.filter(req, res);
      },
    }),
  );
  app.use(cookieParser());

  /**
   * Signed webhooks must be verified against the exact bytes the sender
   * signed, so their raw body is captured before JSON parsing rewrites it.
   * Re-serialising `req.body` does not reproduce those bytes, so HMAC checks
   * downstream of the parser cannot succeed.
   *
   * Scoped to webhook paths deliberately: buffering every request body would
   * double memory use on media uploads for no benefit.
   */
  app.use(
    express.json({
      limit: env.BODY_LIMIT,
      verify: (req, _res, buffer) => {
        if (req.url?.includes('/payments/webhooks/') || req.url?.includes('/support/webhooks/')) {
          (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
        }
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: env.BODY_LIMIT }));

  /* 3. Request context, device, throttling, authentication ----------------- */
  app.use(requestContext);
  app.use(authenticate);
  app.use(identifyDevice);
  app.use(globalRateLimit);
  app.use(applicationWaf);

  /* 4. Locally-served uploads (STORAGE_DRIVER=local) ----------------------- */
  if (env.STORAGE_DRIVER === 'local') {
    app.use('/uploads', (req, res, next) => {
      const relative = req.path.replace(/^\/+/, '').toLowerCase();
      if (
        relative.startsWith('verification/') ||
        relative.startsWith('document/') ||
        relative.startsWith('chat_attachment/')
      ) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
        return;
      }
      next();
    });
    app.use(
      '/uploads',
      express.static(env.STORAGE_LOCAL_DIR, {
        maxAge: '30d',
        immutable: true,
        fallthrough: true,
        index: false,
      }),
    );
  }

  /* 5. API ----------------------------------------------------------------- */
  app.get('/', (_req, res) => {
    res.json({
      name: env.APP_NAME,
      version: process.env.npm_package_version ?? '1.0.0',
      api: env.API_PREFIX,
      docs: `${env.API_PREFIX}/bootstrap`,
      status: 'ok',
    });
  });

  app.use(env.API_PREFIX, buildApiRouter());

  /* 6. Fallbacks ----------------------------------------------------------- */
  app.use(notFoundHandler);
  app.use(errorHandler);

  log.debug({ prefix: env.API_PREFIX, cors: env.CORS_ORIGINS }, 'express app built');
  return app;
}
