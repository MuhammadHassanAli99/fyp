import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

/**
 * Every setting the process needs, validated once at boot.
 * A missing or malformed value must crash the process now rather than
 * surface as a confusing 500 during a request.
 */
const csv = (fallback: string[] = []) =>
  z
    .string()
    .optional()
    .transform((raw) =>
      raw && raw.trim().length > 0
        ? raw
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        : fallback,
    );

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((raw) => (raw === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())));

/** A boolean that stays `undefined` when unset, so a driver can infer a default. */
const optBool = () =>
  z
    .string()
    .optional()
    .transform((raw) => (raw === undefined || raw === '' ? undefined : ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())));

const int = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((raw) => (raw === undefined || raw === '' ? fallback : Number(raw)))
    .pipe(z.number().int());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(3000),
  HOST: z.string().default('0.0.0.0'),
  API_PREFIX: z.string().default('/api/v1'),
  APP_NAME: z.string().default('Marketplace'),
  APP_URL: z.string().default('http://localhost:3000'),
  WEB_URL: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: bool(true),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: int(3306),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().default('marketplace'),
  DB_POOL_SIZE: int(15),
  DB_CONNECT_TIMEOUT_MS: int(10_000),
  DB_TIMEZONE: z.string().default('Z'),
  /**
   * TLS to MySQL. `required` verifies the server certificate against DB_SSL_CA
   * (or the system store); `required-no-verify` encrypts without verifying,
   * which is only appropriate for a managed provider on a private network.
   */
  DB_SSL_MODE: z.enum(['disabled', 'required', 'required-no-verify']).default('disabled'),
  /** PEM certificate authority, or an absolute path to one. */
  DB_SSL_CA: z.string().optional(),

  REDIS_URL: z.string().optional(),
  CACHE_TTL_SECONDS: int(300),

  /** Tokens. In production these MUST be overridden with 32+ byte random values. */
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me-please'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me-please'),
  JWT_ISSUER: z.string().default('marketplace-api'),
  JWT_AUDIENCE: z.string().default('marketplace-app'),
  ACCESS_TOKEN_TTL_MINUTES: int(15),
  REFRESH_TOKEN_TTL_DAYS: int(30),
  /** Encrypts provider secrets and MFA seeds at rest. 32 bytes, hex or base64. */
  ENCRYPTION_KEY: z.string().default('0123456789abcdef0123456789abcdef'),

  BASE_CURRENCY: z.string().length(3).default('USD'),
  DEFAULT_COUNTRY: z.string().length(2).default('US'),
  DEFAULT_LANGUAGE: z.string().default('en'),
  DEFAULT_TIMEZONE: z.string().default('UTC'),

  CORS_ORIGINS: csv(['*']),
  TRUST_PROXY: bool(false),
  BODY_LIMIT: z.string().default('2mb'),

  RATE_LIMIT_WINDOW_MS: int(60_000),
  RATE_LIMIT_MAX: int(300),
  RATE_LIMIT_AUTH_MAX: int(20),
  RATE_LIMIT_WRITE_MAX: int(60),
  RATE_LIMIT_PAYMENT_MAX: int(20),
  RATE_LIMIT_PRIVACY_MAX: int(8),
  RATE_LIMIT_PASSWORD_MAX: int(8),
  RATE_LIMIT_OAUTH_MAX: int(15),

  /** Application-layer WAF. Infrastructure WAF/CDN still sits in front in production. */
  WAF_ENABLED: bool(true),
  /** Configurable disaster-recovery targets (minutes). Not a guarantee of readiness. */
  RPO_MINUTES: int(15),
  RTO_MINUTES: int(60),
  BACKUP_DIR: z.string().default('storage/backups'),
  BACKUP_RETENTION_DAYS: int(14),

  OTP_LENGTH: int(6),
  OTP_TTL_MINUTES: int(10),
  OTP_MAX_ATTEMPTS: int(5),
  OTP_RESEND_SECONDS: int(60),
  OTP_MAX_PER_HOUR: int(8),
  PASSWORD_MIN_LENGTH: int(8),
  MAX_FAILED_LOGINS: int(8),
  ACCOUNT_LOCK_MINUTES: int(30),
  SESSION_IDLE_HOURS: int(336),
  MFA_CHALLENGE_TTL_SECONDS: int(300),
  WEBAUTHN_RP_ID: z.string().default('localhost'),
  WEBAUTHN_RP_NAME: z.string().default('Marketplace'),
  WEBAUTHN_ORIGIN: z.string().default('http://localhost:3000'),

  GOOGLE_CLIENT_IDS: csv([]),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_IDS: csv([]),
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT: z.string().default('common'),
  TURNSTILE_SECRET: z.string().optional(),
  CAPTCHA_TTL_SECONDS: int(300),

  LISTING_TTL_DAYS: int(30),
  LISTING_MAX_MEDIA: int(20),
  GUEST_SESSION_TTL_DAYS: int(30),

  /** Provider selection. Each maps to a driver in src/providers. */
  AI_PROVIDER: z.string().default('heuristic'),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
  AI_MODEL: z.string().default('gpt-4o-mini'),
  AI_TIMEOUT_MS: int(30_000),

  STORAGE_DRIVER: z.enum(['local', 's3', 'gcs', 'azure']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('storage/uploads'),
  STORAGE_PUBLIC_URL: z.string().default('http://localhost:3000/uploads'),
  /** Optional CDN origin in front of local disk or the S3 bucket. */
  CDN_PUBLIC_URL: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** S3-compatible endpoint (MinIO, R2). Leave unset for AWS. */
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(false),
  /** Optional absolute path to ffmpeg. PATH is used when unset. */
  FFMPEG_PATH: z.string().optional(),

  /**
   * Email transport. `smtp` is the no-cost production path (any domain mailbox
   * or self-hosted relay). `ses`/`sendgrid`/`http` post our own JSON shape to
   * EMAIL_API_URL and therefore need a relay that accepts it — they are not
   * drop-in provider SDKs. `log` writes to stdout and delivers nothing.
   */
  EMAIL_DRIVER: z.enum(['log', 'smtp', 'ses', 'sendgrid', 'http']).default('log'),
  EMAIL_API_URL: z.string().optional(),
  EMAIL_API_KEY: z.string().optional(),
  /** Envelope sender. Must be on a domain with SPF/DKIM/DMARC configured. */
  EMAIL_FROM: z.string().default('Marketplace <no-reply@localhost>'),
  EMAIL_REPLY_TO: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: int(587),
  /** Implicit TLS. Defaults to true on port 465, STARTTLS otherwise. */
  SMTP_SECURE: optBool(),
  SMTP_REQUIRE_TLS: bool(true),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_TIMEOUT_MS: int(15_000),
  SMTP_MAX_CONNECTIONS: int(5),

  SMS_DRIVER: z.enum(['log', 'twilio', 'vonage', 'http']).default('log'),
  SMS_API_URL: z.string().optional(),
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),

  /**
   * Push transport. `fcm` uses the FCM HTTP v1 API with a service account —
   * the legacy server-key endpoint is decommissioned, so a bare API key is not
   * sufficient. `apns`/`webpush`/`http` post to PUSH_API_URL.
   */
  PUSH_DRIVER: z.enum(['log', 'fcm', 'apns', 'webpush', 'http']).default('log'),
  PUSH_API_URL: z.string().optional(),
  PUSH_API_KEY: z.string().optional(),
  PUSH_TIMEOUT_MS: int(10_000),
  /** Parallel FCM sends. v1 has no multicast, so fan-out is one request each. */
  PUSH_CONCURRENCY: int(8),
  PUSH_ANDROID_CHANNEL_ID: z.string().optional(),
  PUSH_WEB_ICON_URL: z.string().optional(),
  /** Firebase service account. Prefer the JSON blob from a secret manager. */
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FCM_PROJECT_ID: z.string().optional(),
  FCM_CLIENT_EMAIL: z.string().optional(),
  FCM_PRIVATE_KEY: z.string().optional(),

  /**
   * WhatsApp Business Cloud API. Conversation-based pricing applies; this is
   * NOT a free channel at any volume. Email OTP stays the default.
   */
  WHATSAPP_DRIVER: z.enum(['log', 'cloud']).default('log'),
  WHATSAPP_API_BASE_URL: z.string().default('https://graph.facebook.com'),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  /** Verifies X-Hub-Signature-256 on inbound webhooks. */
  WHATSAPP_APP_SECRET: z.string().optional(),
  /** Echoed back during Meta's webhook subscription handshake. */
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_TIMEOUT_MS: int(15_000),
  /** Approved template in Meta's "authentication" category. */
  WHATSAPP_OTP_TEMPLATE_NAME: z.string().optional(),
  /** Approved "utility" template for business-initiated alerts. */
  WHATSAPP_ALERT_TEMPLATE_NAME: z.string().optional(),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('en_US'),
  WHATSAPP_TEMPLATE_LANGUAGES: csv(['en_US']),

  /** Send an SMS when WhatsApp OTP is requested but not configured. */
  OTP_WHATSAPP_FALLBACK_TO_SMS: bool(true),

  NOTIFICATION_MAX_ATTEMPTS: int(5),
  NOTIFICATION_JOB_BATCH: int(40),
  GEO_DRIVER: z.enum(['local', 'google', 'osm']).default('local'),
  FX_DRIVER: z.enum(['static', 'ecb', 'openexchange']).default('static'),
  GOLD_RATE_DRIVER: z.enum(['static', 'metalprice', 'goldapi']).default('static'),
  IP_REPUTATION_DRIVER: z.enum(['heuristic', 'none']).default('heuristic'),

  MAP_PROVIDER: z.enum(['openstreetmap', 'google', 'apple']).default('openstreetmap'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  MAP_TILE_URL: z.string().optional(),
  MAP_SATELLITE_TILE_URL: z.string().optional(),

  /**
   * Graceful shutdown. DRAIN is the pause after failing readiness so the load
   * balancer can deregister this instance; it should exceed its health-check
   * interval. TIMEOUT bounds waiting for in-flight requests.
   */
  SHUTDOWN_DRAIN_MS: int(5_000),
  SHUTDOWN_TIMEOUT_MS: int(25_000),

  ENABLE_JOBS: bool(true),
  ENABLE_REALTIME: bool(true),
  ENABLE_SWAGGER: bool(true),

  /** WebRTC connectivity. Media never transits the API process. */
  STUN_URLS: csv(['stun:stun.l.google.com:19302']),
  TURN_URLS: csv([]),
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),
  TURN_SECRET: z.string().optional(),
  TELECOM_DRIVER: z.enum(['log', 'twilio', 'vonage']).default('log'),
  CALL_RING_TIMEOUT_SECONDS: int(45),
  MESSAGE_EDIT_WINDOW_MINUTES: int(15),
  CHAT_MEDIA_URL_TTL_SECONDS: int(3600),
  MASKED_CALL_TTL_HOURS: int(24),
  MASKED_CALLS_PER_DAY: int(20),

  /** Payment providers. Secrets never leave the server; publishable keys may be sent to Flutter. */
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  SUPPORT_WEBHOOK_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
  // Deliberately console, not the logger: the logger depends on this module.
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = Object.freeze({
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  isDevelopment: parsed.data.NODE_ENV === 'development',
  isTest: parsed.data.NODE_ENV === 'test',
});

export type Env = typeof env;

/**
 * Refuse to boot in production with development placeholders still in place.
 * This is the single most common way a marketplace leaks every account at once.
 */
if (env.isProduction) {
  /** Silently-wrong configuration. The process must not serve traffic. */
  const fatal: string[] = [];
  /** Suboptimal but survivable. Logged loudly, then boot continues. */
  const warnings: string[] = [];

  const add = (condition: boolean, into: string[], message: string) => {
    if (condition) into.push(message);
  };

  /* Secrets ---------------------------------------------------------------- */
  add(env.JWT_ACCESS_SECRET.includes('change-me'), fatal, 'JWT_ACCESS_SECRET is still the development placeholder');
  add(env.JWT_REFRESH_SECRET.includes('change-me'), fatal, 'JWT_REFRESH_SECRET is still the development placeholder');
  add(env.JWT_ACCESS_SECRET.length < 32, fatal, 'JWT_ACCESS_SECRET must be at least 32 characters');
  add(env.JWT_REFRESH_SECRET.length < 32, fatal, 'JWT_REFRESH_SECRET must be at least 32 characters');
  add(
    env.ENCRYPTION_KEY === '0123456789abcdef0123456789abcdef',
    fatal,
    'ENCRYPTION_KEY is still the development placeholder',
  );
  add(env.CORS_ORIGINS.includes('*'), fatal, 'CORS_ORIGINS must name explicit origins, not *');
  add(env.DB_PASSWORD.length === 0, fatal, 'DB_PASSWORD is empty');

  /* Public URLs ------------------------------------------------------------ */
  add(env.APP_URL.startsWith('http://'), fatal, 'APP_URL must use https');
  add(env.WEB_URL.startsWith('http://'), fatal, 'WEB_URL must use https');
  add(/localhost|127\.0\.0\.1/.test(env.APP_URL), fatal, 'APP_URL still points at localhost');
  add(/localhost|127\.0\.0\.1/.test(env.WEB_URL), fatal, 'WEB_URL still points at localhost');

  /**
   * Passkeys bind to the relying-party ID. Left as `localhost`, every
   * registration and assertion fails against the real domain — and it fails at
   * the browser, so the API logs look clean.
   */
  add(env.WEBAUTHN_RP_ID === 'localhost', fatal, 'WEBAUTHN_RP_ID must be the production domain, not localhost');
  add(
    /localhost|127\.0\.0\.1/.test(env.WEBAUTHN_ORIGIN) || env.WEBAUTHN_ORIGIN.startsWith('http://'),
    fatal,
    'WEBAUTHN_ORIGIN must be the https production origin',
  );

  /**
   * The log driver writes OTPs to stdout and reports success. Authentication
   * appears to work while no user can ever sign in, which is the single most
   * expensive way to discover a misconfiguration.
   */
  add(
    env.EMAIL_DRIVER === 'log',
    fatal,
    'EMAIL_DRIVER=log delivers nothing — email OTP and verification would silently fail',
  );
  add(env.EMAIL_DRIVER === 'smtp' && !env.SMTP_HOST, fatal, 'EMAIL_DRIVER=smtp requires SMTP_HOST');
  add(
    env.EMAIL_DRIVER !== 'log' && env.EMAIL_DRIVER !== 'smtp' && !env.EMAIL_API_URL,
    fatal,
    `EMAIL_DRIVER=${env.EMAIL_DRIVER} requires EMAIL_API_URL`,
  );
  add(/localhost/.test(env.EMAIL_FROM), fatal, 'EMAIL_FROM must use a domain with SPF/DKIM/DMARC configured');

  /* Storage ---------------------------------------------------------------- */
  add(
    env.STORAGE_DRIVER === 's3' && (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY),
    fatal,
    'STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY',
  );
  add(
    /localhost|127\.0\.0\.1/.test(env.STORAGE_PUBLIC_URL),
    fatal,
    'STORAGE_PUBLIC_URL still points at localhost — uploaded media would be unreachable',
  );
  add(
    env.STORAGE_DRIVER === 'gcs' || env.STORAGE_DRIVER === 'azure',
    fatal,
    `STORAGE_DRIVER=${env.STORAGE_DRIVER} has no implemented driver; uploads would be rejected`,
  );

  /* Provider selection that the product may legitimately ship without ------ */
  add(
    env.PUSH_DRIVER === 'log',
    warnings,
    'PUSH_DRIVER=log — push notifications are not delivered on any platform',
  );
  add(env.SMS_DRIVER === 'log', warnings, 'SMS_DRIVER=log — SMS OTP and alerts are not delivered');
  add(
    env.WHATSAPP_DRIVER === 'cloud' && !env.WHATSAPP_APP_SECRET,
    fatal,
    'WHATSAPP_APP_SECRET is required to verify inbound WhatsApp webhooks',
  );
  add(
    env.WHATSAPP_DRIVER === 'cloud' && !env.WHATSAPP_OTP_TEMPLATE_NAME,
    warnings,
    'WHATSAPP_OTP_TEMPLATE_NAME is unset — WhatsApp OTP will fall back to SMS',
  );

  /**
   * Behind a load balancer without this, every request appears to come from the
   * proxy: rate limits become global instead of per-client, and abuse
   * attribution in the audit log is wrong.
   */
  add(!env.TRUST_PROXY, warnings, 'TRUST_PROXY=false — set it when running behind a reverse proxy or load balancer');
  add(
    env.DB_SSL_MODE === 'disabled',
    warnings,
    'DB_SSL_MODE=disabled — MySQL traffic is unencrypted; required unless the database is on a private link',
  );
  add(env.REDIS_URL === undefined, warnings, 'REDIS_URL is unset — cache and rate limits stay per-process');
  add(env.LOG_PRETTY, warnings, 'LOG_PRETTY=true — production logs should stay newline-delimited JSON');

  // Deliberately console, not the logger: the logger depends on this module.
  if (warnings.length > 0) {
    console.warn(`Production configuration warnings:\n${warnings.map((w) => `  - ${w}`).join('\n')}`);
  }
  if (fatal.length > 0) {
    console.error(
      `Refusing to start in production. Fix the following:\n${fatal.map((f) => `  - ${f}`).join('\n')}\n` +
        `See docs/ENVIRONMENT_VARIABLES.md and docs/PRODUCTION_CONFIGURATION.md.`,
    );
    process.exit(1);
  }
}
