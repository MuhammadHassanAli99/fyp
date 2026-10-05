import type { PoolConnection } from '../../db/pool';
import { execute, queryOne, queryRows, queryCount, transaction, type Row } from '../../db/query';
import { AppError, ErrorCode, badRequest, conflict, notFound, unauthenticated } from '../../core/errors';
import { assertPasswordAcceptable, hashPassword, needsRehash, verifyPassword } from '../../core/security/password';
import {
  hashRefreshToken,
  issueRefreshToken,
  signAccessToken,
  type IssuedAccessToken,
} from '../../core/security/tokens';
import { packIp, randomNumericCode, sha256, uuid, safeEqual } from '../../core/security/crypto';
import { clip } from '../../core/strings';
import { env } from '../../config/env';
import { getContext, contextOrDefaults } from '../../core/context';
import { eventBus } from '../../core/events/event-bus';
import { loggerFor } from '../../config/logger';
import { cache, cacheKeys } from '../../config/cache';
import { messaging } from '../../providers/messaging';
import type { DeviceInput, RegisterInput } from './auth.schema';
import { AuthEvent, recordAuthEvent } from './auth.security';
import { convertGuestSession } from './guest.service';
import { assessLoginRisk, maybeRevokeSessions, recordTakeoverAlert } from '../risk/risk.login';
import { openFraudCase } from '../risk/risk.cases';

const log = loggerFor('auth');

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  expiresAt: string;
  refreshExpiresAt: string;
}

export interface AuthenticatedUser {
  id: number;
  uuid: string;
  email: string | null;
  phone: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  accountType: string;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  mfaEnabled: boolean;
  roles: string[];
  countryId: number | null;
  language: string | null;
  currency: string | null;
  timezone: string | null;
  theme: string;
  lastMarketplaceId: number | null;
  trustScore: number | null;
  trustBand: string | null;
}

export interface AuthResult {
  user: AuthenticatedUser;
  tokens: AuthTokens;
  /** Set when the account has MFA and the caller must complete a second step. */
  mfaRequired?: boolean;
  mfaFactors?: Array<{ id: number; kind: string; hint: string | null }>;
}

export interface RegisterResult {
  registered: true;
  identifier: string;
  user: { id: number; uuid: string; email: string | null; phone: string | null };
}

export interface LoginOtpChallenge {
  otpRequired: true;
  loginTicket: string;
  destinationHint: string;
  channel: 'email' | 'sms' | 'whatsapp';
  channels: Array<'email' | 'sms' | 'whatsapp'>;
  expiresInSeconds: number;
  /** Present only in development (log email/SMS driver). Never sent in production. */
  devOtp?: string;
}

export type LoginResponse = AuthResult | LoginOtpChallenge;

export const isLoginOtpChallenge = (value: LoginResponse): value is LoginOtpChallenge =>
  (value as LoginOtpChallenge).otpRequired === true;

/* -------------------------------------------------------------------------- */
/* Lookup helpers                                                             */
/* -------------------------------------------------------------------------- */

export const isEmail = (value: string): boolean => value.includes('@');

export const normalizePhone = (value: string): string => (value.startsWith('+') ? value : `+${value.replace(/\D/g, '')}`);

export async function findUserByIdentifier(identifier: string): Promise<Row | null> {
  if (isEmail(identifier)) {
    return queryOne(
      'SELECT * FROM users WHERE email_normalized = ? AND deleted_at IS NULL',
      [identifier.trim().toLowerCase()],
    );
  }
  const phone = normalizePhone(identifier);
  const byPhone = await queryOne('SELECT * FROM users WHERE phone_e164 = ? AND deleted_at IS NULL', [phone]);
  if (byPhone) return byPhone;
  // Fall through to username so one field can serve all three.
  return queryOne('SELECT * FROM users WHERE username_normalized = ? AND deleted_at IS NULL', [
    identifier.trim().toLowerCase(),
  ]);
}

export async function loadAuthenticatedUser(userId: number): Promise<AuthenticatedUser> {
  const row = await queryOne<Row>(
    `SELECT u.id, u.uuid, u.email, u.phone_e164, u.username, u.account_type, u.status,
            u.email_verified_at, u.phone_verified_at, u.mfa_enabled, u.country_id, u.language,
            u.currency, u.timezone, u.theme, u.last_marketplace_id,
            p.display_name, p.avatar_url,
            ts.score AS trust_score, ts.band AS trust_band,
            (SELECT GROUP_CONCAT(r.code) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN trust_scores ts ON ts.user_id = u.id
      WHERE u.id = ? AND u.deleted_at IS NULL`,
    [userId],
  );
  if (!row) throw notFound('User');

  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    email: (row.email as string | null) ?? null,
    phone: (row.phone_e164 as string | null) ?? null,
    username: (row.username as string | null) ?? null,
    displayName: (row.display_name as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    accountType: String(row.account_type),
    status: String(row.status),
    emailVerified: row.email_verified_at !== null,
    phoneVerified: row.phone_verified_at !== null,
    mfaEnabled: row.mfa_enabled === 1,
    roles: row.roles ? String(row.roles).split(',') : [],
    countryId: row.country_id === null ? null : Number(row.country_id),
    language: (row.language as string | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    timezone: (row.timezone as string | null) ?? null,
    theme: String(row.theme ?? 'system'),
    lastMarketplaceId: row.last_marketplace_id === null ? null : Number(row.last_marketplace_id),
    trustScore: row.trust_score === null ? null : Number(row.trust_score),
    trustBand: (row.trust_band as string | null) ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Device + session                                                           */
/* -------------------------------------------------------------------------- */

export async function upsertDevice(userId: number, device: DeviceInput, connection?: PoolConnection): Promise<number | null> {
  const context = contextOrDefaults();
  const installationId = clip(device?.deviceId ?? context.installationId, 36);
  const clientId = installationId ?? context.deviceHash;
  if (!clientId || !context.platformId) return context.deviceId;

  const fingerprint = sha256(`${clientId}|${context.userAgent ?? ''}`);
  const deviceUuid = uuid();

  const result = await execute(
    `INSERT INTO user_devices
       (uuid, user_id, platform_id, fingerprint_hash, device_name, device_model, manufacturer,
        os_version, app_version, locale, timezone, push_token, push_provider,
        is_rooted, is_jailbroken, is_emulator,
        installation_id, browser, last_ip, country_id, login_count, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active')
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       last_seen_at = CURRENT_TIMESTAMP,
       push_token = COALESCE(VALUES(push_token), push_token),
       push_provider = VALUES(push_provider),
       app_version = COALESCE(VALUES(app_version), app_version),
       is_rooted = VALUES(is_rooted), is_jailbroken = VALUES(is_jailbroken), is_emulator = VALUES(is_emulator),
       installation_id = COALESCE(VALUES(installation_id), installation_id),
       browser = COALESCE(VALUES(browser), browser),
       last_ip = VALUES(last_ip),
       country_id = COALESCE(VALUES(country_id), country_id),
       login_count = login_count + 1,
       status = IF(status = 'revoked', 'active', status)`,
    [
      deviceUuid,
      userId,
      context.platformId,
      fingerprint,
      clip(device?.deviceName, 128),
      clip(device?.deviceModel, 128),
      clip(device?.manufacturer, 96),
      clip(device?.osVersion, 48),
      clip(device?.appVersion ?? context.appVersion, 24),
      clip(context.language, 24),
      clip(context.timezone, 64),
      clip(device?.pushToken, 512),
      device?.pushProvider ?? 'none',
      device?.isRooted ? 1 : 0,
      device?.isJailbroken ? 1 : 0,
      device?.isEmulator ? 1 : 0,
      installationId,
      clip(device?.browser, 96),
      packIp(context.ip),
      context.countryId,
    ],
    connection,
  );

  return result.insertId || null;
}

/**
 * Issues an access + refresh pair and records the session.
 * `familyId` groups every rotation of one login, so detecting reuse of an old
 * refresh token lets us revoke the whole chain rather than a single token.
 */
export async function createSession(params: {
  userId: number;
  deviceId: number | null;
  method: 'password' | 'otp' | 'oauth' | 'passkey' | 'refresh';
  mfaSatisfied: boolean;
  familyId?: string;
  parentId?: number | null;
  roles: string[];
  permissions: string[];
  connection?: PoolConnection;
}): Promise<{ tokens: AuthTokens; sessionId: number }> {
  const context = contextOrDefaults();
  const familyId = params.familyId ?? uuid();
  const refresh = issueRefreshToken(familyId);
  const sessionUuid = uuid();

  const idleExpiresAt = new Date(Date.now() + env.SESSION_IDLE_HOURS * 3_600_000);
  const result = await execute(
    `INSERT INTO user_sessions
       (uuid, user_id, device_id, family_id, refresh_token_hash, parent_id, ip_address, last_ip,
        user_agent, app_version, country_id, login_method, mfa_satisfied, expires_at, idle_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionUuid,
      params.userId,
      params.deviceId,
      familyId,
      refresh.tokenHash,
      params.parentId ?? null,
      packIp(context.ip),
      packIp(context.ip),
      clip(context.userAgent, 512),
      clip(context.appVersion, 24),
      context.countryId,
      params.method,
      params.mfaSatisfied ? 1 : 0,
      refresh.expiresAt,
      idleExpiresAt,
    ],
    params.connection,
  );

  const sessionId = result.insertId;
  const access: IssuedAccessToken = signAccessToken({
    sub: String(params.userId),
    sid: String(sessionId),
    mfa: params.mfaSatisfied,
    tv: 1,
  });

  await convertGuestSession(context.guestUuid, params.userId, params.connection).catch((error) =>
    log.warn({ err: error }, 'guest session conversion skipped'),
  );

  return {
    sessionId,
    tokens: {
      accessToken: access.token,
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: access.expiresIn,
      expiresAt: access.expiresAt.toISOString(),
      refreshExpiresAt: refresh.expiresAt.toISOString(),
    },
  };
}

export async function loadGrants(userId: number): Promise<{ roles: string[]; permissions: string[] }> {
  const row = await queryOne<Row>(
    `SELECT GROUP_CONCAT(DISTINCT r.code) AS roles, GROUP_CONCAT(DISTINCT p.code) AS permissions
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ? AND (ur.expires_at IS NULL OR ur.expires_at > CURRENT_TIMESTAMP)`,
    [userId],
  );
  return {
    roles: row?.roles ? String(row.roles).split(',') : [],
    permissions: row?.permissions ? String(row.permissions).split(',') : [],
  };
}

async function recordLoginAttempt(params: {
  identifier: string;
  userId: number | null;
  method: string;
  succeeded: boolean;
  reason?: string;
}): Promise<void> {
  const context = contextOrDefaults();
  await execute(
    `INSERT INTO login_attempts
       (identifier, user_id, method, succeeded, failure_reason, risk_score, ip_address, user_agent, device_hash, country_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.identifier.slice(0, 191),
      params.userId,
      params.method,
      params.succeeded ? 1 : 0,
      params.reason ?? null,
      context.riskScore,
      packIp(context.ip),
      clip(context.userAgent, 512),
      clip(context.deviceHash, 64),
      context.countryId,
    ],
  ).catch((error) => log.warn({ err: error }, 'could not record login attempt'));
}

/**
 * Progressive lockout. Counting failures on the user row (rather than only by IP)
 * is what actually stops a distributed credential-stuffing run against one account.
 */
async function registerFailedLogin(user: Row): Promise<void> {
  const failures = Number(user.failed_login_count ?? 0) + 1;
  const shouldLock = failures >= env.MAX_FAILED_LOGINS;
  await execute(
    `UPDATE users
        SET failed_login_count = ?,
            locked_until = ${shouldLock ? `DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${env.ACCOUNT_LOCK_MINUTES} MINUTE)` : 'locked_until'}
      WHERE id = ?`,
    [failures, user.id],
  );
  if (shouldLock) {
    void recordAuthEvent({ type: AuthEvent.ACCOUNT_LOCKED, userId: Number(user.id), metadata: { failures } });
  }
}

const clearFailedLogins = (userId: number) =>
  execute('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP, last_login_ip = ? WHERE id = ?', [
    packIp(contextOrDefaults().ip),
    userId,
  ]);

export function assertLoginable(user: Row): void {
  if (user.status === 'banned') {
    throw new AppError('This account has been banned', { status: 403, code: ErrorCode.ACCOUNT_BANNED });
  }
  if (user.status === 'suspended') {
    throw new AppError('This account is suspended', { status: 403, code: ErrorCode.ACCOUNT_SUSPENDED });
  }
  if (user.status === 'deleted' || user.deleted_at) {
    throw unauthenticated('Invalid credentials');
  }
  const lockedUntil = user.locked_until as Date | null;
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError(`Too many failed attempts. Try again in ${minutes} minute(s).`, {
      status: 403,
      code: ErrorCode.ACCOUNT_LOCKED,
      retryAfter: minutes * 60,
      details: { until: lockedUntil.toISOString() },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

export async function createAccount(input: RegisterInput): Promise<{ userId: number; uuid: string; email: string | null; phone: string | null }> {
  const context = contextOrDefaults();
  const email = input.email ?? null;
  const phone = input.phone ? normalizePhone(input.phone) : null;

  if (email) {
    const taken = await queryCount('SELECT COUNT(*) FROM users WHERE email_normalized = ?', [email.toLowerCase()]);
    if (taken > 0) throw new AppError('An account with this email already exists', { status: 409, code: ErrorCode.EMAIL_TAKEN });
  }
  if (phone) {
    const taken = await queryCount('SELECT COUNT(*) FROM users WHERE phone_e164 = ?', [phone]);
    if (taken > 0) throw new AppError('An account with this phone number already exists', { status: 409, code: ErrorCode.PHONE_TAKEN });
  }
  if (input.username) {
    const { assertUsernameAvailable } = await import('../users/username.service');
    await assertUsernameAvailable(input.username);
  }
  if (input.password) {
    assertPasswordAcceptable(input.password, { email, username: input.username });
  }

  const countryId = input.countryCode
    ? ((await queryOne<Row>('SELECT id FROM countries WHERE iso2 = ?', [input.countryCode]))?.id as number | undefined) ?? context.countryId
    : context.countryId;

  const result = await transaction(async (connection) => {
    const userUuid = uuid();
    const passwordHash = input.password ? await hashPassword(input.password) : null;

    const insert = await execute(
      `INSERT INTO users
         (uuid, email, phone_e164, phone_country_code, username, password_hash, password_changed_at,
          account_type, status, country_id, language, currency, timezone)
       VALUES (?, ?, ?, ?, ?, ?, ${passwordHash ? 'CURRENT_TIMESTAMP' : 'NULL'}, ?, 'pending', ?, ?, ?, ?)`,
      [
        userUuid,
        email,
        phone,
        phone ? clip(phone, 8) : null,
        input.username ?? null,
        passwordHash,
        input.accountType,
        countryId,
        clip(input.language ?? context.language, 10),
        clip(input.currency ?? context.currency, 3),
        clip(context.timezone, 64),
      ],
      connection,
    );

    const userId = insert.insertId;

    await execute(
      'INSERT INTO user_profiles (user_id, display_name, profile_completeness) VALUES (?, ?, ?)',
      [userId, clip(input.displayName ?? input.username ?? null, 191), computeCompleteness(input)],
      connection,
    );

    await execute(
      `INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = 'user'`,
      [userId],
      connection,
    );

    await execute(
      `INSERT INTO trust_scores (user_id, score, band) VALUES (?, 0, 'new')`,
      [userId],
      connection,
    );

    const consents: Array<[string, boolean]> = [
      ['terms', true],
      ['privacy', true],
      ['marketing_email', input.marketingConsent],
      ['marketing_push', input.marketingConsent],
    ];
    for (const [consentType, granted] of consents) {
      await execute(
        `INSERT INTO user_consents (user_id, consent_type, granted, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, consentType, granted ? 1 : 0, packIp(context.ip), clip(context.userAgent, 512)],
        connection,
      );
    }

    const { ensureDefaultSubscription } = await import('../../middleware/entitlements');
    await ensureDefaultSubscription(userId, connection);

    const event = await eventBus.enqueue(connection, 'user.registered', 'user', userId, {
      userId,
      method: input.password ? 'password' : 'otp',
      countryId: countryId ?? null,
      email,
      phone,
    });

    return { userId, uuid: userUuid, event };
  });

  void eventBus.publishAfterCommit(result.event);
  void recordAuthEvent({ type: AuthEvent.LOGIN_SUCCESS, userId: result.userId, metadata: { action: 'registered' } }).catch(
    () => undefined,
  );

  return { userId: result.userId, uuid: result.uuid, email, phone };
}

/** Creates the account only. Sign-in + OTP happen on the next screens. */
export async function register(input: RegisterInput): Promise<RegisterResult> {
  const created = await createAccount(input);
  const identifier = created.email ?? created.phone ?? '';
  return {
    registered: true,
    identifier,
    user: { id: created.userId, uuid: created.uuid, email: created.email, phone: created.phone },
  };
}

const computeCompleteness = (input: RegisterInput): number => {
  let score = 20;
  if (input.email) score += 20;
  if (input.phone) score += 20;
  if (input.username) score += 10;
  if (input.displayName) score += 15;
  if (input.countryCode) score += 15;
  return Math.min(100, score);
};

/* -------------------------------------------------------------------------- */
/* Password login                                                             */
/* -------------------------------------------------------------------------- */

export async function login(
  identifier: string,
  password: string,
  device: DeviceInput,
  channel?: 'email' | 'sms' | 'whatsapp',
): Promise<LoginResponse> {
  const user = await findUserByIdentifier(identifier);

  if (!user) {
    await verifyPassword(password, null);
    await recordLoginAttempt({ identifier, userId: null, method: 'password', succeeded: false, reason: 'no_such_user' });
    void recordAuthEvent({ type: AuthEvent.LOGIN_FAILED, metadata: { reason: 'no_such_user' } });
    throw new AppError('Incorrect email/phone or password', { status: 401, code: ErrorCode.INVALID_CREDENTIALS });
  }

  assertLoginable(user);

  const passwordOk = await verifyPassword(password, user.password_hash as string | null);
  if (!passwordOk) {
    await registerFailedLogin(user);
    await recordLoginAttempt({
      identifier,
      userId: Number(user.id),
      method: 'password',
      succeeded: false,
      reason: 'bad_password',
    });
    void recordAuthEvent({ type: AuthEvent.LOGIN_FAILED, userId: Number(user.id), metadata: { reason: 'bad_password' } });
    throw new AppError('Incorrect email/phone or password', { status: 401, code: ErrorCode.INVALID_CREDENTIALS });
  }

  if (needsRehash(user.password_hash as string | null)) {
    void hashPassword(password)
      .then((hash) => execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]))
      .catch((error) => log.warn({ err: error }, 'password rehash failed'));
  }

  const userId = Number(user.id);
  await clearFailedLogins(userId);
  return issueLoginOtpChallenge(user, channel);
}

function loginChannelsFor(user: Row): Array<'email' | 'sms' | 'whatsapp'> {
  const channels: Array<'email' | 'sms' | 'whatsapp'> = [];
  if (user.email) channels.push('email');
  if (user.phone_e164) {
    channels.push('sms', 'whatsapp');
  }
  return channels;
}

function resolveLoginChannel(user: Row, requested?: 'email' | 'sms' | 'whatsapp'): 'email' | 'sms' | 'whatsapp' {
  const available = loginChannelsFor(user);
  if (requested && available.includes(requested)) return requested;
  if (user.phone_e164 && !user.email) return 'sms';
  if (user.email) return 'email';
  if (user.phone_e164) return 'sms';
  throw new AppError('This account has no email or phone to receive a code', {
    status: 400,
    code: ErrorCode.BAD_REQUEST,
  });
}

function destinationForChannel(user: Row, channel: 'email' | 'sms' | 'whatsapp'): string {
  if (channel === 'email') {
    const email = user.email as string | null;
    if (!email) throw new AppError('This account has no email address', { status: 400, code: ErrorCode.BAD_REQUEST });
    return email;
  }
  const phone = user.phone_e164 as string | null;
  if (!phone) throw new AppError('This account has no phone number', { status: 400, code: ErrorCode.BAD_REQUEST });
  return phone;
}

async function issueLoginOtpChallenge(
  user: Row,
  requestedChannel?: 'email' | 'sms' | 'whatsapp',
): Promise<LoginOtpChallenge> {
  const userId = Number(user.id);
  const channel = resolveLoginChannel(user, requestedChannel);
  const destination = destinationForChannel(user, channel);
  const kind = channel === 'email' ? 'email' : 'sms';
  const ticket = uuid();
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000);

  await execute(
    `UPDATE mfa_challenges SET consumed_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND consumed_at IS NULL AND kind IN ('email','sms')`,
    [userId],
  );

  await execute(
    `INSERT INTO mfa_challenges (uuid, user_id, kind, max_attempts, expires_at, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ticket, userId, kind, env.OTP_MAX_ATTEMPTS, expiresAt, packIp(contextOrDefaults().ip)],
  );

  const sent = await sendOtp({ destination, channel, purpose: 'login', userId });
  return {
    otpRequired: true,
    loginTicket: ticket,
    destinationHint: sent.hint ?? maskDestination(destination) ?? 'your account',
    channel,
    channels: loginChannelsFor(user),
    expiresInSeconds: sent.expiresInSeconds,
    ...(sent.devOtp ? { devOtp: sent.devOtp } : {}),
  };
}

export async function resendLoginOtp(
  ticket: string,
  channel?: 'email' | 'sms' | 'whatsapp',
): Promise<LoginOtpChallenge> {
  const challenge = await loadLoginTicket(ticket);
  const user = await queryOne<Row>('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [challenge.user_id]);
  if (!user) throw new AppError('This sign-in step has expired. Start again.', { status: 400, code: ErrorCode.OTP_EXPIRED });
  assertLoginable(user);
  return issueLoginOtpChallenge(user, channel);
}

export async function completePasswordLogin(
  ticket: string,
  code: string,
  device: DeviceInput,
): Promise<AuthResult> {
  const challenge = await loadLoginTicket(ticket);
  const user = await queryOne<Row>('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [challenge.user_id]);
  if (!user) throw new AppError('This sign-in step has expired. Start again.', { status: 400, code: ErrorCode.OTP_EXPIRED });
  assertLoginable(user);

  const userId = Number(user.id);
  const channel = challenge.kind === 'email' ? 'email' : 'sms';
  const destination = destinationForChannel(user, channel === 'email' ? 'email' : 'sms');
  await verifyOtp({ destination, code, purpose: 'login' });

  await execute('UPDATE mfa_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?', [challenge.id]);
  await markVerified(userId, user.email ? 'email' : 'phone');
  if (user.phone_e164 && channel !== 'email') await markVerified(userId, 'phone');
  if (user.email && channel === 'email') await markVerified(userId, 'email');

  const grants = await loadGrants(userId);
  const deviceId = await upsertDevice(userId, device);
  const mfaEnabled = user.mfa_enabled === 1;
  const session = await createSession({
    userId,
    deviceId,
    method: 'password',
    mfaSatisfied: !mfaEnabled,
    roles: grants.roles,
    permissions: grants.permissions,
  });

  await afterSuccessfulLogin(userId, session.sessionId, deviceId, 'password');

  if (mfaEnabled) {
    const factors = await loadMfaFactorHints(userId);
    return { user: await loadAuthenticatedUser(userId), tokens: session.tokens, mfaRequired: true, mfaFactors: factors };
  }

  return { user: await loadAuthenticatedUser(userId), tokens: session.tokens };
}

async function loadLoginTicket(ticket: string): Promise<Row> {
  const challenge = await queryOne<Row>(
    `SELECT * FROM mfa_challenges WHERE uuid = ? AND consumed_at IS NULL LIMIT 1`,
    [ticket],
  );
  if (!challenge) {
    throw new AppError('This sign-in step has expired. Enter your password again.', {
      status: 400,
      code: ErrorCode.OTP_EXPIRED,
    });
  }
  if ((challenge.expires_at as Date).getTime() < Date.now()) {
    await execute('UPDATE mfa_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?', [challenge.id]);
    throw new AppError('This code has expired. Request a new one.', { status: 400, code: ErrorCode.OTP_EXPIRED });
  }
  return challenge;
}

export async function afterSuccessfulLogin(
  userId: number,
  sessionId: number,
  deviceId: number | null,
  method: string,
): Promise<void> {
  const context = contextOrDefaults();
  await recordLoginAttempt({ identifier: String(userId), userId, method, succeeded: true });
  void recordAuthEvent({
    type: AuthEvent.LOGIN_SUCCESS,
    userId,
    deviceId,
    sessionId,
    metadata: { method, riskScore: context.riskScore },
  });
  void recordAuthEvent({
    type: AuthEvent.SESSION_CREATED,
    userId,
    deviceId,
    sessionId,
    metadata: { method },
  });

  if (deviceId) {
    await execute(
      `INSERT INTO fingerprint_users (fingerprint_hash, user_id, session_count)
       SELECT fingerprint_hash, ?, 1 FROM user_devices WHERE id = ?
       ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP, session_count = session_count + 1`,
      [userId, deviceId],
    ).catch((error) => log.debug({ err: error }, 'fingerprint_users upsert skipped'));

    await execute(
      `INSERT INTO device_fingerprints (fingerprint_hash, platform_id, user_agent)
       SELECT fingerprint_hash, platform_id, ? FROM user_devices WHERE id = ?
       ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP`,
      [context.userAgent?.slice(0, 512) ?? null, deviceId],
    ).catch(() => undefined);

    await execute(
      `UPDATE device_fingerprints df
          JOIN user_devices d ON d.fingerprint_hash = df.fingerprint_hash
          SET df.distinct_user_count = (
            SELECT COUNT(*) FROM fingerprint_users fu WHERE fu.fingerprint_hash = df.fingerprint_hash
          )
        WHERE d.id = ?`,
      [deviceId],
    ).catch(() => undefined);

    const packedIp = packIp(context.ip);
    if (packedIp) {
      await execute(
        `INSERT INTO device_ip_history (device_id, ip_address, country_id) VALUES (?, ?, ?)`,
        [deviceId, packedIp, context.countryId],
      ).catch(() => undefined);
    }
  }

  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'user.logged_in', 'user', userId, {
      userId,
      sessionId,
      method,
      deviceId,
      riskScore: context.riskScore,
    });
    void eventBus.publishAfterCommit(event);
  });

  // §19 Suspicious Login Detection: a login from an unseen device in a new
  // country is the strongest cheap signal of account takeover.
  let newDevice = false;
  if (deviceId) {
    const priorLogins = await queryCount(
      'SELECT COUNT(*) FROM user_sessions WHERE user_id = ? AND device_id = ? AND id <> ?',
      [userId, deviceId, sessionId],
    );
    newDevice = priorLogins === 0;
    if (newDevice) {
      await flagNewDevice(userId, deviceId).catch((error) => log.warn({ err: error }, 'new device flag failed'));
    }
  }

  const knownCountry = context.countryId
    ? await queryCount(
        'SELECT COUNT(*) FROM user_sessions WHERE user_id = ? AND country_id = ? AND id <> ? AND revoked_at IS NULL',
        [userId, context.countryId, sessionId],
      )
    : 1;
  const loginRisk = await assessLoginRisk({
    userId,
    sessionId,
    deviceId,
    succeeded: true,
    extra: { newDevice, newCountry: knownCountry === 0 },
  }).catch((error) => {
    log.warn({ err: error }, 'login risk assessment skipped');
    return null;
  });
  if (loginRisk) {
    await maybeRevokeSessions(userId, sessionId, loginRisk.decision).catch(() => 0);
    if (loginRisk.requiresReview) {
      await openFraudCase({
        subjectKind: 'user',
        subjectId: userId,
        userId,
        category: 'account_takeover',
        severity: loginRisk.riskLevel === 'critical' ? 'critical' : 'medium',
        riskScore: loginRisk.riskScore,
        summary: newDevice ? 'New device login flagged for review' : 'Login flagged for review',
      }).catch((error) => log.debug({ err: error }, 'fraud case open skipped'));
    }
  }
}

async function flagNewDevice(userId: number, deviceId: number): Promise<void> {
  const context = contextOrDefaults();
  const knownCountry = await queryCount(
    'SELECT COUNT(*) FROM user_sessions WHERE user_id = ? AND country_id = ? AND revoked_at IS NULL',
    [userId, context.countryId],
  );
  const trigger = knownCountry === 0 ? 'new_country' : 'new_device';
  const score = knownCountry === 0 ? 55 : 30;

  await recordTakeoverAlert({
    userId,
    trigger,
    score,
    evidence: { deviceId, countryId: context.countryId, ip: context.ip, requestId: context.requestId },
    action: 'notified',
  });

  void recordAuthEvent({
    type: AuthEvent.SUSPICIOUS_LOGIN,
    userId,
    deviceId,
    metadata: { reason: trigger },
  });
  void recordAuthEvent({ type: AuthEvent.DEVICE_ADDED, userId, deviceId });

  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'user.new_device', 'user', userId, {
      userId,
      deviceId,
      countryId: context.countryId,
    });
    const ato = await eventBus.enqueue(connection, 'account_takeover.suspected', 'user', userId, {
      userId,
      triggerKind: trigger,
      riskScore: score,
    });
    void eventBus.publishAfterCommit(event);
    void eventBus.publishAfterCommit(ato);
  });
}

export const loadMfaFactorHints = async (userId: number) => {
  const factors = await queryRows<Row>(
    'SELECT id, kind, destination FROM mfa_factors WHERE user_id = ? AND verified_at IS NOT NULL ORDER BY is_primary DESC',
    [userId],
  );
  return factors.map((factor) => ({
    id: Number(factor.id),
    kind: String(factor.kind),
    hint: maskDestination(factor.destination as string | null),
  }));
};

export const maskDestination = (destination: string | null): string | null => {
  if (!destination) return null;
  if (destination.includes('@')) {
    const [local = '', domain = ''] = destination.split('@');
    return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
  }
  return `${'*'.repeat(Math.max(0, destination.length - 4))}${destination.slice(-4)}`;
};

/* -------------------------------------------------------------------------- */
/* OTP                                                                        */
/* -------------------------------------------------------------------------- */

export async function sendOtp(params: {
  destination: string;
  channel: 'email' | 'sms' | 'whatsapp';
  purpose: string;
  userId?: number | null;
}): Promise<{
  sent: boolean;
  channel: 'email' | 'sms' | 'whatsapp';
  substitutedFrom?: 'email' | 'sms' | 'whatsapp';
  expiresInSeconds: number;
  hint: string | null;
  devOtp?: string;
}> {
  const context = contextOrDefaults();
  const destination = params.channel === 'email' ? params.destination.trim().toLowerCase() : normalizePhone(params.destination);

  // Throttle per destination independently of the route rate limit, since the
  // same destination can be targeted from many IPs.
  const recent = await queryCount(
    `SELECT COUNT(*) FROM otp_codes
      WHERE destination = ? AND purpose = ? AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND)`,
    [destination, params.purpose, env.OTP_RESEND_SECONDS],
  );
  if (recent > 0 && !env.isDevelopment) {
    throw new AppError('A code was just sent. Please wait a moment before requesting another.', {
      status: 429,
      code: ErrorCode.TOO_MANY_ATTEMPTS,
      retryAfter: env.OTP_RESEND_SECONDS,
    });
  }

  const hourly = await queryCount(
    `SELECT COUNT(*) FROM otp_codes
      WHERE destination = ? AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)`,
    [destination],
  );
  if (hourly >= env.OTP_MAX_PER_HOUR && !env.isDevelopment) {
    throw new AppError('Too many codes requested for this destination. Try again later.', {
      status: 429,
      code: ErrorCode.TOO_MANY_ATTEMPTS,
      retryAfter: 3600,
    });
  }

  const code = randomNumericCode(env.OTP_LENGTH);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000);

  // Invalidate any outstanding code for the same purpose so only one is live.
  await execute(
    `UPDATE otp_codes SET consumed_at = CURRENT_TIMESTAMP
      WHERE destination = ? AND purpose = ? AND consumed_at IS NULL`,
    [destination, params.purpose],
  );

  await execute(
    `INSERT INTO otp_codes (user_id, channel, destination, purpose, code_hash, max_attempts, expires_at, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.userId ?? null,
      params.channel,
      destination,
      params.purpose,
      sha256(`${destination}:${code}`),
      env.OTP_MAX_ATTEMPTS,
      expiresAt,
      packIp(context.ip),
    ],
  );

  const delivery = await messaging.sendOtp({
    channel: params.channel,
    destination,
    code,
    purpose: params.purpose,
    language: context.language,
    ttlMinutes: env.OTP_TTL_MINUTES,
  });

  /**
   * A rejected delivery used to be swallowed: the caller was told `sent: true`
   * while the code went nowhere, so the user waited for a message that would
   * never arrive and burned their resend allowance doing it. Consume the stored
   * code and surface the failure so the client can offer another channel.
   */
  if (delivery.accepted === 0 && delivery.rejected > 0) {
    await execute(
      `UPDATE otp_codes SET consumed_at = CURRENT_TIMESTAMP
        WHERE destination = ? AND purpose = ? AND consumed_at IS NULL`,
      [destination, params.purpose],
    );
    log.error(
      { channel: delivery.channel, provider: delivery.provider, errorCode: delivery.errorCode, purpose: params.purpose },
      'otp delivery failed',
    );
    throw new AppError('We could not send your code right now. Please try again or use a different method.', {
      status: 502,
      code: ErrorCode.SERVICE_UNAVAILABLE,
      expected: true,
      details: { channel: delivery.channel },
    });
  }

  return {
    sent: true,
    // The requested channel is not always the one used: WhatsApp falls back to
    // SMS on the same number when no approved template is configured.
    channel: delivery.channel,
    ...(delivery.substitutedFrom ? { substitutedFrom: delivery.substitutedFrom } : {}),
    expiresInSeconds: env.OTP_TTL_MINUTES * 60,
    hint: maskDestination(destination),
    ...(env.isDevelopment ? { devOtp: code } : {}),
  };
}

export async function verifyOtp(params: {
  destination: string;
  code: string;
  purpose: string;
}): Promise<{ userId: number | null; destination: string; channel: string }> {
  const destination = params.destination.includes('@')
    ? params.destination.trim().toLowerCase()
    : normalizePhone(params.destination);

  const record = await queryOne<Row>(
    `SELECT * FROM otp_codes
      WHERE destination = ? AND purpose = ? AND consumed_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [destination, params.purpose],
  );

  if (!record) {
    throw new AppError('No active code for this destination. Request a new one.', { status: 400, code: ErrorCode.OTP_INVALID });
  }
  if ((record.expires_at as Date).getTime() < Date.now()) {
    throw new AppError('This code has expired. Request a new one.', { status: 400, code: ErrorCode.OTP_EXPIRED });
  }
  if (Number(record.attempts) >= Number(record.max_attempts)) {
    await execute('UPDATE otp_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?', [record.id]);
    throw new AppError('Too many incorrect attempts. Request a new code.', {
      status: 429,
      code: ErrorCode.TOO_MANY_ATTEMPTS,
    });
  }

  const matches = safeEqual(sha256(`${destination}:${params.code}`), String(record.code_hash));
  if (!matches) {
    await execute('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [record.id]);
    const remaining = Number(record.max_attempts) - Number(record.attempts) - 1;
    throw new AppError(
      remaining > 0 ? `Incorrect code. ${remaining} attempt(s) left.` : 'Incorrect code. Request a new one.',
      { status: 400, code: ErrorCode.OTP_INVALID },
    );
  }

  await execute('UPDATE otp_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?', [record.id]);

  return {
    userId: record.user_id === null ? null : Number(record.user_id),
    destination,
    channel: String(record.channel),
  };
}

/** OTP login/registration in one call: creates the account if it does not exist. */
export async function loginWithOtp(params: {
  destination: string;
  code: string;
  purpose: string;
  device?: DeviceInput;
}): Promise<AuthResult & { created: boolean }> {
  const verified = await verifyOtp(params);
  const isEmailDestination = verified.destination.includes('@');

  let user = isEmailDestination
    ? await queryOne<Row>('SELECT * FROM users WHERE email_normalized = ? AND deleted_at IS NULL', [verified.destination])
    : await queryOne<Row>('SELECT * FROM users WHERE phone_e164 = ? AND deleted_at IS NULL', [verified.destination]);

  let created = false;

  if (!user) {
    const account = await createAccount({
      ...(isEmailDestination ? { email: verified.destination } : { phone: verified.destination }),
      accountType: 'individual',
      acceptedTerms: true,
      marketingConsent: false,
      device: params.device,
    } as RegisterInput);
    created = true;
    await markVerified(account.userId, isEmailDestination ? 'email' : 'phone');
    const grants = await loadGrants(account.userId);
    const deviceId = await upsertDevice(account.userId, params.device);
    const session = await createSession({
      userId: account.userId,
      deviceId,
      method: 'otp',
      mfaSatisfied: true,
      roles: grants.roles,
      permissions: grants.permissions,
    });
    await afterSuccessfulLogin(account.userId, session.sessionId, deviceId, 'otp');
    return { user: await loadAuthenticatedUser(account.userId), tokens: session.tokens, created };
  }

  assertLoginable(user);
  const userId = Number(user.id);
  await markVerified(userId, isEmailDestination ? 'email' : 'phone');
  await clearFailedLogins(userId);

  const grants = await loadGrants(userId);
  const deviceId = await upsertDevice(userId, params.device);
  const session = await createSession({
    userId,
    deviceId,
    method: 'otp',
    // A one-time code to a verified destination already is a second factor.
    mfaSatisfied: true,
    roles: grants.roles,
    permissions: grants.permissions,
  });

  await afterSuccessfulLogin(userId, session.sessionId, deviceId, 'otp');
  return { user: await loadAuthenticatedUser(userId), tokens: session.tokens, created };
}

export async function markVerified(userId: number, kind: 'email' | 'phone'): Promise<void> {
  const column = kind === 'email' ? 'email_verified_at' : 'phone_verified_at';
  await execute(
    `UPDATE users
        SET ${column} = COALESCE(${column}, CURRENT_TIMESTAMP),
            status = IF(status = 'pending', 'active', status)
      WHERE id = ?`,
    [userId],
  );
  await cache.del(cacheKeys.permissions(userId));

  await transaction(async (connection) => {
    const event = await eventBus.enqueue(
      connection,
      kind === 'email' ? 'user.email_verified' : 'user.phone_verified',
      'user',
      userId,
      { userId },
    );
    void eventBus.publishAfterCommit(event);
  });
}

/* -------------------------------------------------------------------------- */
/* Refresh with reuse detection                                               */
/* -------------------------------------------------------------------------- */

export async function refresh(refreshToken: string): Promise<AuthTokens> {
  const tokenHash = hashRefreshToken(refreshToken);
  const session = await queryOne<Row>(
    `SELECT s.*, u.status, u.deleted_at
       FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.refresh_token_hash = ?`,
    [tokenHash],
  );

  if (!session) {
    throw new AppError('Invalid refresh token', { status: 401, code: ErrorCode.TOKEN_INVALID });
  }

  /**
   * Reuse detection: a revoked-but-rotated token being presented means someone
   * replayed a token we already exchanged. The legitimate client's current token
   * is unknown to us, so the safe response is to kill the whole family and force
   * a fresh login on every device in that chain.
   */
  if (session.revoked_at) {
    await execute(
      `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'token_reuse_detected'
        WHERE family_id = ? AND revoked_at IS NULL`,
      [session.family_id],
    );
    log.warn({ userId: session.user_id, familyId: session.family_id }, 'refresh token reuse detected, family revoked');
    throw new AppError('Your session has expired. Please sign in again.', { status: 401, code: ErrorCode.SESSION_REVOKED });
  }

  if ((session.expires_at as Date).getTime() < Date.now()) {
    throw new AppError('Your session has expired. Please sign in again.', { status: 401, code: ErrorCode.TOKEN_EXPIRED });
  }
  if (session.deleted_at || session.status === 'banned' || session.status === 'suspended') {
    throw new AppError('This account is not available', { status: 403, code: ErrorCode.ACCOUNT_SUSPENDED });
  }

  const userId = Number(session.user_id);
  const grants = await loadGrants(userId);

  return transaction(async (connection) => {
    // Rotate: retire the presented token, issue a successor in the same family.
    await execute(
      `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'rotated', last_used_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [session.id],
      connection,
    );

    const next = await createSession({
      userId,
      deviceId: session.device_id === null ? null : Number(session.device_id),
      method: 'refresh',
      mfaSatisfied: session.mfa_satisfied === 1,
      familyId: String(session.family_id),
      parentId: Number(session.id),
      roles: grants.roles,
      permissions: grants.permissions,
      connection,
    });

    return next.tokens;
  });
}

/* -------------------------------------------------------------------------- */
/* Logout                                                                     */
/* -------------------------------------------------------------------------- */

export async function logout(params: {
  userId: number;
  sessionId: number;
  refreshToken?: string;
  allDevices: boolean;
  otherDevices?: boolean;
}): Promise<{ revoked: number }> {
  if (params.allDevices) {
    const result = await execute(
      `UPDATE user_sessions
          SET revoked_at = CURRENT_TIMESTAMP, logged_out_at = CURRENT_TIMESTAMP, revoked_reason = 'logout_all'
        WHERE user_id = ? AND revoked_at IS NULL`,
      [params.userId],
    );
    void recordAuthEvent({ type: AuthEvent.LOGOUT_ALL, userId: params.userId, sessionId: params.sessionId });
    return { revoked: result.affectedRows };
  }

  if (params.otherDevices) {
    const result = await execute(
      `UPDATE user_sessions
          SET revoked_at = CURRENT_TIMESTAMP, logged_out_at = CURRENT_TIMESTAMP, revoked_reason = 'logout_others'
        WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`,
      [params.userId, params.sessionId],
    );
    void recordAuthEvent({ type: AuthEvent.SESSION_REVOKED, userId: params.userId, sessionId: params.sessionId, metadata: { scope: 'others' } });
    return { revoked: result.affectedRows };
  }

  if (params.refreshToken) {
    const result = await execute(
      `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'logout'
        WHERE refresh_token_hash = ? AND user_id = ? AND revoked_at IS NULL`,
      [hashRefreshToken(params.refreshToken), params.userId],
    );
    if (result.affectedRows > 0) {
      void recordAuthEvent({ type: AuthEvent.LOGOUT, userId: params.userId, sessionId: params.sessionId });
      return { revoked: result.affectedRows };
    }
  }

  // Fall back to the session the access token belongs to.
  const result = await execute(
    `UPDATE user_sessions
        SET revoked_at = CURRENT_TIMESTAMP, logged_out_at = CURRENT_TIMESTAMP, revoked_reason = 'logout'
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    [params.sessionId, params.userId],
  );
  void recordAuthEvent({ type: AuthEvent.LOGOUT, userId: params.userId, sessionId: params.sessionId });
  return { revoked: result.affectedRows };
}

export async function listSessions(userId: number, currentSessionId: number) {
  const rows = await queryRows<Row>(
    `SELECT s.id, s.uuid, s.login_method, s.created_at, s.last_used_at, s.expires_at, s.country_id,
            s.user_agent, d.device_name, d.device_model, d.os_version, p.code AS platform, c.name AS country_name
       FROM user_sessions s
       LEFT JOIN user_devices d ON d.id = s.device_id
       LEFT JOIN platforms p ON p.id = d.platform_id
       LEFT JOIN countries c ON c.id = s.country_id
      WHERE s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP
      ORDER BY s.last_used_at DESC, s.created_at DESC`,
    [userId],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    uuid: String(row.uuid),
    isCurrent: Number(row.id) === currentSessionId,
    loginMethod: String(row.login_method),
    platform: (row.platform as string | null) ?? null,
    deviceName: (row.device_name as string | null) ?? (row.device_model as string | null) ?? null,
    osVersion: (row.os_version as string | null) ?? null,
    countryName: (row.country_name as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    lastUsedAt: row.last_used_at ? (row.last_used_at as Date).toISOString() : null,
    expiresAt: (row.expires_at as Date).toISOString(),
  }));
}

export async function revokeSession(userId: number, sessionUuid: string): Promise<void> {
  const result = await execute(
    `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'revoked_by_user'
      WHERE uuid = ? AND user_id = ? AND revoked_at IS NULL`,
    [sessionUuid, userId],
  );
  if (result.affectedRows === 0) throw notFound('Session');
}

/* -------------------------------------------------------------------------- */
/* Password reset + change                                                    */
/* -------------------------------------------------------------------------- */

export async function forgotPassword(identifier: string): Promise<{ sent: boolean; channel: string; hint: string | null }> {
  const user = await findUserByIdentifier(identifier);

  // Always report success: revealing whether an account exists is an
  // enumeration oracle.
  if (!user) {
    return { sent: true, channel: isEmail(identifier) ? 'email' : 'sms', hint: maskDestination(identifier) };
  }

  const destination = isEmail(identifier) ? (user.email as string) : (user.phone_e164 as string);
  if (!destination) {
    return { sent: true, channel: 'email', hint: null };
  }

  const result = await sendOtp({
    destination,
    channel: destination.includes('@') ? 'email' : 'sms',
    purpose: 'reset_password',
    userId: Number(user.id),
  });

  return { sent: true, channel: destination.includes('@') ? 'email' : 'sms', hint: result.hint };
}

export async function resetPassword(params: {
  destination?: string;
  code?: string;
  token?: string;
  password: string;
}): Promise<{ userId: number; revokedSessions: number }> {
  let userId: number | null = null;

  if (params.destination && params.code) {
    const verified = await verifyOtp({ destination: params.destination, code: params.code, purpose: 'reset_password' });
    userId = verified.userId;
    if (!userId) {
      const user = verified.destination.includes('@')
        ? await queryOne<Row>('SELECT id FROM users WHERE email_normalized = ?', [verified.destination])
        : await queryOne<Row>('SELECT id FROM users WHERE phone_e164 = ?', [verified.destination]);
      userId = user ? Number(user.id) : null;
    }
  } else if (params.token) {
    const record = await queryOne<Row>(
      `SELECT user_id FROM password_reset_tokens
        WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
      [sha256(params.token)],
    );
    if (!record) throw badRequest('This reset link is invalid or has expired');
    userId = Number(record.user_id);
    await execute('UPDATE password_reset_tokens SET consumed_at = CURRENT_TIMESTAMP WHERE token_hash = ?', [
      sha256(params.token),
    ]);
  } else {
    throw badRequest('Provide either a reset token or the code sent to you');
  }

  if (!userId) throw badRequest('This reset request is no longer valid');

  const user = await queryOne<Row>('SELECT email, username FROM users WHERE id = ?', [userId]);
  assertPasswordAcceptable(params.password, {
    email: user?.email as string | null,
    username: user?.username as string | null,
  });

  const passwordHash = await hashPassword(params.password);

  const revoked = await transaction(async (connection) => {
    await execute(
      `UPDATE users SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP,
                        failed_login_count = 0, locked_until = NULL,
                        status = IF(status = 'pending', 'active', status)
        WHERE id = ?`,
      [passwordHash, userId],
      connection,
    );

    // A password reset must invalidate every existing session: if the reset was
    // triggered by a compromise, the attacker's sessions have to die with it.
    const result = await execute(
      `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'password_reset'
        WHERE user_id = ? AND revoked_at IS NULL`,
      [userId],
      connection,
    );

    const event = await eventBus.enqueue(connection, 'user.password_changed', 'user', userId, {
      userId: userId!,
      revokedSessions: result.affectedRows,
    });
    void eventBus.publishAfterCommit(event);

    return result.affectedRows;
  });

  return { userId, revokedSessions: revoked };
}

export async function changePassword(userId: number, currentPassword: string, newPassword: string): Promise<{ revokedSessions: number }> {
  const user = await queryOne<Row>('SELECT password_hash, email, username FROM users WHERE id = ?', [userId]);
  if (!user) throw notFound('User');

  const ok = await verifyPassword(currentPassword, user.password_hash as string | null);
  if (!ok) {
    throw new AppError('Your current password is incorrect', { status: 401, code: ErrorCode.INVALID_CREDENTIALS });
  }

  assertPasswordAcceptable(newPassword, {
    email: user.email as string | null,
    username: user.username as string | null,
  });

  const passwordHash = await hashPassword(newPassword);
  const context = getContext();

  return transaction(async (connection) => {
    await execute(
      'UPDATE users SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP WHERE id = ?',
      [passwordHash, userId],
      connection,
    );

    // Keep the current session alive so the user is not logged out of the device
    // they just used, but drop everything else.
    const result = await execute(
      `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'password_changed'
        WHERE user_id = ? AND revoked_at IS NULL AND id <> ?`,
      [userId, context?.sessionId ?? 0],
      connection,
    );

    const event = await eventBus.enqueue(connection, 'user.password_changed', 'user', userId, {
      userId,
      revokedSessions: result.affectedRows,
    });
    void eventBus.publishAfterCommit(event);

    return { revokedSessions: result.affectedRows };
  });
}

/* -------------------------------------------------------------------------- */
/* Guest sessions (§1 Guest Mode)                                             */
/* -------------------------------------------------------------------------- */

export async function createGuestSession(params: {
  countryCode?: string;
  language?: string;
  currency?: string;
  theme?: 'light' | 'dark' | 'system';
  measurementSystem?: 'metric' | 'imperial';
  device?: DeviceInput;
}): Promise<{ guestId: string; expiresAt: string; country: string; language: string; currency: string }> {
  const context = contextOrDefaults();
  const guestUuid = uuid();
  const expiresAt = new Date(Date.now() + env.GUEST_SESSION_TTL_DAYS * 86_400_000);

  const countryRow = params.countryCode
    ? await queryOne<Row>('SELECT id, iso2 FROM countries WHERE iso2 = ? AND is_active = 1', [
        params.countryCode.toUpperCase(),
      ])
    : null;
  const countryId = (countryRow?.id as number | undefined) ?? context.countryId;
  const countryCode = countryRow ? String(countryRow.iso2) : context.countryCode;

  await execute(
    `INSERT INTO guest_sessions
       (uuid, device_id, country_id, language, currency, theme, measurement_system, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      guestUuid,
      context.deviceId,
      countryId,
      params.language ?? context.language,
      params.currency ?? context.currency,
      params.theme ?? null,
      params.measurementSystem ?? null,
      packIp(context.ip),
      expiresAt,
    ],
  );

  return {
    guestId: guestUuid,
    expiresAt: expiresAt.toISOString(),
    country: countryCode,
    language: params.language ?? context.language,
    currency: params.currency ?? context.currency,
  };
}

/* -------------------------------------------------------------------------- */
/* Change email / phone — requires proof of the new destination               */
/* -------------------------------------------------------------------------- */

export async function requestContactChange(
  userId: number,
  kind: 'email' | 'phone',
  newValue: string,
): Promise<{ sent: boolean; hint: string | null; expiresInSeconds: number }> {
  const destination = kind === 'email' ? newValue.trim().toLowerCase() : normalizePhone(newValue);
  if (kind === 'email' && !destination.includes('@')) throw badRequest('Enter a valid email address');

  const taken =
    kind === 'email'
      ? await queryCount('SELECT COUNT(*) FROM users WHERE email_normalized = ? AND id <> ?', [destination, userId])
      : await queryCount('SELECT COUNT(*) FROM users WHERE phone_e164 = ? AND id <> ?', [destination, userId]);
  if (taken > 0) {
    throw new AppError(kind === 'email' ? 'That email is already in use' : 'That phone number is already in use', {
      status: 409,
      code: kind === 'email' ? ErrorCode.EMAIL_TAKEN : ErrorCode.PHONE_TAKEN,
    });
  }

  const otp = await sendOtp({
    destination,
    channel: kind === 'email' ? 'email' : 'sms',
    purpose: kind === 'email' ? 'verify_email' : 'verify_phone',
    userId,
  });

  const context = contextOrDefaults();
  await execute(
    `UPDATE contact_change_requests SET consumed_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND kind = ? AND consumed_at IS NULL`,
    [userId, kind],
  );
  await execute(
    `INSERT INTO contact_change_requests (user_id, kind, new_value, code_hash, expires_at, ip_address)
     VALUES (?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE), ?)`,
    [
      userId,
      kind,
      destination,
      sha256(`contact-change:${userId}:${destination}`),
      env.OTP_TTL_MINUTES,
      packIp(context.ip),
    ],
  );

  return { sent: true, hint: otp.hint, expiresInSeconds: otp.expiresInSeconds };
}

export async function confirmContactChange(
  userId: number,
  kind: 'email' | 'phone',
  code: string,
): Promise<{ changed: boolean }> {
  const pending = await queryOne<Row>(
    `SELECT * FROM contact_change_requests
      WHERE user_id = ? AND kind = ? AND consumed_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [userId, kind],
  );
  if (!pending) throw badRequest('No pending change request');
  if ((pending.expires_at as Date).getTime() < Date.now()) throw badRequest('This change request has expired');

  const destination = String(pending.new_value);
  await verifyOtp({
    destination,
    code,
    purpose: kind === 'email' ? 'verify_email' : 'verify_phone',
  });

  if (kind === 'email') {
    await execute(
      `UPDATE users SET email = ?, email_verified_at = CURRENT_TIMESTAMP, status = IF(status = 'pending', 'active', status) WHERE id = ?`,
      [destination, userId],
    );
    void recordAuthEvent({ type: AuthEvent.EMAIL_CHANGED, userId, metadata: { hint: maskDestination(destination) } });
  } else {
    await execute(
      `UPDATE users SET phone_e164 = ?, phone_number = ?, phone_verified_at = CURRENT_TIMESTAMP, status = IF(status = 'pending', 'active', status) WHERE id = ?`,
      [destination, destination, userId],
    );
    void recordAuthEvent({ type: AuthEvent.PHONE_CHANGED, userId, metadata: { hint: maskDestination(destination) } });
  }

  await execute('UPDATE contact_change_requests SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?', [pending.id]);
  await cache.del(cacheKeys.permissions(userId));
  return { changed: true };
}

export async function satisfyMfaOnSession(sessionId: number): Promise<void> {
  await execute('UPDATE user_sessions SET mfa_satisfied = 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [
    sessionId,
  ]);
}

export async function completeEmailVerification(destination: string, code: string): Promise<{ verified: boolean }> {
  const verified = await verifyOtp({ destination, code, purpose: 'verify_email' });
  const user =
    verified.userId !== null
      ? await queryOne<Row>('SELECT id FROM users WHERE id = ?', [verified.userId])
      : await queryOne<Row>('SELECT id FROM users WHERE email_normalized = ?', [verified.destination]);
  if (!user) throw notFound('User');
  await markVerified(Number(user.id), 'email');
  void recordAuthEvent({ type: AuthEvent.EMAIL_VERIFIED, userId: Number(user.id) });
  return { verified: true };
}

export async function completePhoneVerification(destination: string, code: string): Promise<{ verified: boolean }> {
  const verified = await verifyOtp({ destination, code, purpose: 'verify_phone' });
  const user =
    verified.userId !== null
      ? await queryOne<Row>('SELECT id FROM users WHERE id = ?', [verified.userId])
      : await queryOne<Row>('SELECT id FROM users WHERE phone_e164 = ?', [verified.destination]);
  if (!user) throw notFound('User');
  await markVerified(Number(user.id), 'phone');
  void recordAuthEvent({ type: AuthEvent.PHONE_VERIFIED, userId: Number(user.id) });
  return { verified: true };
}
