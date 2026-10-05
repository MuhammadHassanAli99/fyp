import pino from 'pino';
import { env } from './env';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  '*.password',
  '*.passwordConfirm',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.code',
  '*.otp',
  '*.nonce',
  '*.secret',
  '*.clientSecret',
  '*.cardNumber',
  '*.cvv',
  '*.password_hash',
  '*.code_hash',
  '*.refresh_token_hash',
  '*.phone',
  '*.phoneNumber',
  '*.phone_e164',
  '*.real_number',
  '*.proxy_number',
  '*.turnCredential',
  '*.credential',
  '*.encryptionKey',
  '*.apiKey',
  '*.webhookSecret',
  '*.client_secret',
  '*.STRIPE_SECRET_KEY',
  '*.JWT_ACCESS_SECRET',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'marketplace-api', env: env.NODE_ENV },
  redact: { paths: redactPaths, censor: '[redacted]' },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    env.LOG_PRETTY && !env.isProduction
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service,env' },
        }
      : undefined,
});

export type Logger = typeof logger;

/** Child logger bound to a subsystem, so filtering by module is trivial in production. */
export const loggerFor = (module: string) => logger.child({ module });
