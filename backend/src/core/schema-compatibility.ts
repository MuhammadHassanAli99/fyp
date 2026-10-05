import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { queryOne, queryRows, type Row } from '../db/query';
import { env } from '../config/env';
import { AppError, ErrorCode } from './errors';
import { loggerFor } from '../config/logger';

const log = loggerFor('schema');

/** Minimum schema_migrations.version this backend binary requires. */
export const REQUIRED_SCHEMA_VERSION = '038';

export const API_VERSION = process.env.npm_package_version ?? '1.0.0';

const AUTH_TABLES = [
  'users',
  'user_identities',
  'user_passkeys',
  'webauthn_challenges',
  'otp_codes',
  'mfa_factors',
  'mfa_recovery_codes',
  'mfa_challenges',
  'user_devices',
  'user_sessions',
  'guest_sessions',
  'login_attempts',
  'password_reset_tokens',
  'captcha_challenges',
  'oauth_states',
  'contact_change_requests',
  'auth_security_events',
  'device_fingerprints',
  'fingerprint_users',
  'audit_logs',
  'user_profiles',
  'business_profiles',
  'business_members',
  'reserved_usernames',
  'username_history',
  'profile_images',
  'verification_requests',
  'trust_scores',
  'trust_score_events',
  'notification_categories',
  'notification_templates',
  'notifications',
  'notification_deliveries',
  'notification_preferences',
  'notification_quiet_hours',
  'scheduled_notifications',
  'notification_jobs',
  'risk_policy_thresholds',
  'risk_decisions',
  'risk_models',
  'risk_model_versions',
  'risk_relationships',
  'risk_jobs',
  'fraud_case_events',
  'user_role_assignments',
  'business_departments',
  'business_teams',
  'privileged_action_requests',
  'admin_report_jobs',
  'user_consents',
  'data_subject_requests',
  'access_policies',
] as const;

export interface MigrationFile {
  version: string;
  name: string;
  checksum: string;
}

export interface SchemaStatus {
  compatible: boolean;
  requiredVersion: string;
  appliedVersion: string | null;
  applied: Array<{ version: string; name: string; checksum: string | null; checksumOk: boolean }>;
  pending: string[];
  checksumMismatches: string[];
  missingTables: string[];
  apiVersion: string;
}

export function migrationsDir(): string {
  return path.resolve(process.cwd(), '..', 'database', 'migrations');
}

export function listMigrationFiles(dir = migrationsDir()): MigrationFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) => {
      const sql = fs.readFileSync(path.join(dir, name), 'utf8');
      return {
        version: name.split('_')[0] ?? name,
        name,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    });
}

export function assertMigrationOrder(files: MigrationFile[]): void {
  let previous = '';
  for (const file of files) {
    if (previous && file.version.localeCompare(previous, 'en', { numeric: true }) <= 0) {
      throw new AppError(`Migration versions are not strictly increasing: ${previous} then ${file.version}`, {
        status: 500,
        code: ErrorCode.SCHEMA_INCOMPATIBLE,
        expected: false,
      });
    }
    previous = file.version;
  }
}

export async function inspectSchema(): Promise<SchemaStatus> {
  const files = listMigrationFiles();
  assertMigrationOrder(files);

  const appliedRows = await queryRows<Row>(
    'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
  ).catch(() => [] as Row[]);

  const appliedMap = new Map(
    appliedRows.map((row) => [String(row.version), { name: String(row.name), checksum: (row.checksum as string | null) ?? null }]),
  );

  const applied = files.map((file) => {
    const row = appliedMap.get(file.version);
    const checksumOk = !row?.checksum || row.checksum === file.checksum;
    return {
      version: file.version,
      name: file.name,
      checksum: row?.checksum ?? null,
      checksumOk: row ? checksumOk : true,
    };
  });

  const pending = files.filter((file) => !appliedMap.has(file.version)).map((file) => file.name);
  const checksumMismatches = applied.filter((row) => !row.checksumOk).map((row) => row.name);
  const appliedVersion = appliedRows.length > 0 ? String(appliedRows[appliedRows.length - 1]?.version) : null;

  const missingTables: string[] = [];
  for (const table of AUTH_TABLES) {
    const exists = await queryOne<Row>(
      `SELECT TABLE_NAME AS name
         FROM information_schema.tables
        WHERE table_schema = ? AND table_name = ?`,
      [env.DB_NAME, table],
    );
    if (!exists) missingTables.push(table);
  }

  const versionOk =
    appliedVersion !== null && appliedVersion.localeCompare(REQUIRED_SCHEMA_VERSION, 'en', { numeric: true }) >= 0;

  const checksumBlocking = checksumMismatches.length > 0 && env.isProduction;

  return {
    compatible: versionOk && pending.length === 0 && !checksumBlocking && missingTables.length === 0,
    requiredVersion: REQUIRED_SCHEMA_VERSION,
    appliedVersion,
    applied,
    pending,
    checksumMismatches,
    missingTables,
    apiVersion: API_VERSION,
  };
}

/**
 * Called at process boot. Refuses to serve traffic against a schema this binary
 * does not understand, so auth writes cannot corrupt an old or drifted database.
 */
export async function assertDatabaseCompatible(): Promise<SchemaStatus> {
  const status = await inspectSchema();

  if (status.checksumMismatches.length > 0) {
    log.error({ files: status.checksumMismatches }, 'applied migration contents no longer match the files on disk');
    if (env.isProduction) {
      throw new AppError('Database migration checksum mismatch. Refusing to start.', {
        status: 503,
        code: ErrorCode.SCHEMA_INCOMPATIBLE,
        expected: false,
        details: { checksumMismatches: status.checksumMismatches },
      });
    }
    log.warn('continuing in non-production despite checksum mismatch; re-apply or restore the original files');
  }

  if (status.pending.length > 0 || (status.appliedVersion ?? '000').localeCompare(REQUIRED_SCHEMA_VERSION, 'en', { numeric: true }) < 0) {
    log.error(
      { pending: status.pending, applied: status.appliedVersion, required: REQUIRED_SCHEMA_VERSION },
      'database schema is behind this backend',
    );
    throw new AppError(
      `Database schema is incompatible with this backend (applied ${status.appliedVersion ?? 'none'}, required ${REQUIRED_SCHEMA_VERSION}). Run npm run db:migrate.`,
      {
        status: 503,
        code: ErrorCode.SCHEMA_INCOMPATIBLE,
        expected: false,
        details: {
          appliedVersion: status.appliedVersion,
          requiredVersion: REQUIRED_SCHEMA_VERSION,
          pending: status.pending,
          missingTables: status.missingTables,
        },
      },
    );
  }

  if (status.missingTables.length > 0) {
    log.error({ missingTables: status.missingTables }, 'required authentication tables are missing');
    throw new AppError('Database is missing required authentication tables.', {
      status: 503,
      code: ErrorCode.SCHEMA_INCOMPATIBLE,
      expected: false,
      details: { missingTables: status.missingTables },
    });
  }

  log.info(
    { appliedVersion: status.appliedVersion, apiVersion: status.apiVersion, tables: AUTH_TABLES.length },
    'database schema is compatible',
  );
  return status;
}
