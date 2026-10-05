import { Router } from 'express';
import { asyncHandler } from '../../core/http/async-handler';
import { ok } from '../../core/http/response';
import { env } from '../../config/env';
import { inspectSchema, API_VERSION, REQUIRED_SCHEMA_VERSION } from '../../core/schema-compatibility';
import { getEnabledFeatures, getPublicSettings } from '../locale/settings.service';
import { AppError, ErrorCode } from '../../core/errors';

export const systemRouter = Router();

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part.replace(/\D/g, ''), 10) || 0);
  const pb = b.split('.').map((part) => Number.parseInt(part.replace(/\D/g, ''), 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

systemRouter.get(
  '/version',
  asyncHandler(async (req, res) => {
    const [schema, settings] = await Promise.all([inspectSchema(), getPublicSettings()]);
    const minApp = String(settings['app.min_supported_version'] ?? settings.minAppVersion ?? '1.0.0');
    const forceBelow = String(settings['app.force_update_below'] ?? '0.0.0');
    const clientVersion = req.context.appVersion ?? '0.0.0';
    const compatible = compareSemver(clientVersion, minApp) >= 0;

    return ok(res, {
      apiVersion: API_VERSION,
      apiPrefix: env.API_PREFIX,
      minSupportedAppVersion: minApp,
      forceUpdateBelow: forceBelow,
      currentAppVersion: clientVersion,
      databaseSchemaVersion: schema.appliedVersion,
      requiredSchemaVersion: REQUIRED_SCHEMA_VERSION,
      schemaCompatible: schema.compatible,
      appCompatible: compatible,
      environment: env.NODE_ENV,
    });
  }),
);

systemRouter.get(
  '/capabilities',
  asyncHandler(async (_req, res) => {
    const [features, settings] = await Promise.all([getEnabledFeatures(), getPublicSettings()]);
    return ok(res, {
      auth: settings['auth.capabilities'] ?? {
        emailPassword: true,
        phoneOtp: true,
        oauth: ['google', 'apple', 'facebook', 'microsoft'],
        passkey: true,
        mfa: ['totp', 'email', 'sms', 'passkey'],
        captcha: true,
      },
      features,
    });
  }),
);

systemRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const schema = await inspectSchema();
    if (!schema.compatible) {
      throw new AppError('Database schema is incompatible with this API', {
        status: 503,
        code: ErrorCode.SCHEMA_INCOMPATIBLE,
        details: {
          appliedVersion: schema.appliedVersion,
          requiredVersion: schema.requiredVersion,
          pending: schema.pending,
        },
      });
    }
    return ok(res, {
      status: 'ok',
      apiVersion: schema.apiVersion,
      schemaVersion: schema.appliedVersion,
      pendingMigrations: schema.pending.length,
    });
  }),
);
