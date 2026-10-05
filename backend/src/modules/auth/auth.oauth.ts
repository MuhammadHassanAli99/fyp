import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { AppError, ErrorCode, badRequest, conflict, forbidden } from '../../core/errors';
import { env } from '../../config/env';
import { randomToken, sha256, uuid } from '../../core/security/crypto';
import { clip } from '../../core/strings';
import { verifyOidcIdToken } from '../../core/security/jwks';
import { contextOrDefaults } from '../../core/context';
import { loggerFor } from '../../config/logger';
import type { DeviceInput } from './auth.schema';
import {
  afterSuccessfulLogin,
  assertLoginable,
  createSession,
  loadAuthenticatedUser,
  loadGrants,
  loadMfaFactorHints,
  upsertDevice,
  type AuthResult,
} from './auth.service';
import { AuthEvent, recordAuthEvent } from './auth.security';

const log = loggerFor('auth.oauth');

export type OauthProvider = 'google' | 'apple' | 'facebook' | 'microsoft';

interface ProviderRow extends Row {
  id: number;
  code: string;
  kind: string;
  issuer: string | null;
  authorize_url: string | null;
  token_url: string | null;
  userinfo_url: string | null;
  jwks_url: string | null;
  scopes: string | null;
  is_active: number;
}

interface NormalizedIdentity {
  provider: OauthProvider;
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  givenName: string | null;
  familyName: string | null;
  pictureUrl: string | null;
}

const clientIdsFor = (provider: OauthProvider): string[] => {
  switch (provider) {
    case 'google':
      return env.GOOGLE_CLIENT_IDS;
    case 'apple':
      return env.APPLE_CLIENT_IDS;
    case 'facebook':
      return env.FACEBOOK_APP_ID ? [env.FACEBOOK_APP_ID] : [];
    case 'microsoft':
      return env.MICROSOFT_CLIENT_ID ? [env.MICROSOFT_CLIENT_ID] : [];
    default:
      return [];
  }
};

export async function loadProvider(code: string): Promise<ProviderRow> {
  const row = await queryOne<ProviderRow>(
    'SELECT * FROM identity_providers WHERE code = ? AND is_active = 1',
    [code],
  );
  if (!row) {
    throw new AppError('This sign-in provider is not available', {
      status: 501,
      code: ErrorCode.NOT_IMPLEMENTED,
    });
  }
  return row;
}

export async function startOauth(params: {
  provider: OauthProvider;
  platform?: string;
  redirectUri?: string;
  linkUserId?: number;
}): Promise<{ authorizationUrl: string; state: string }> {
  const provider = await loadProvider(params.provider);
  const clientIds = clientIdsFor(params.provider);
  if (clientIds.length === 0 || !provider.authorize_url) {
    throw new AppError(`${params.provider} sign-in is not configured on this server`, {
      status: 501,
      code: ErrorCode.NOT_IMPLEMENTED,
    });
  }

  const state = randomToken(32);
  const nonce = randomToken(32);
  const verifier = randomToken(32);
  const challenge = Buffer.from(sha256(verifier), 'hex').toString('base64url');
  const redirectUri = params.redirectUri ?? `${env.APP_URL}${env.API_PREFIX}/auth/oauth/${params.provider}/callback`;
  const expiresAt = new Date(Date.now() + 10 * 60_000);

  await execute(
    `INSERT INTO oauth_states
       (state, nonce, provider_code, platform_code, code_verifier, redirect_uri, user_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [state, nonce, params.provider, params.platform ?? null, verifier, redirectUri, params.linkUserId ?? null, expiresAt],
  );

  const url = new URL(provider.authorize_url);
  url.searchParams.set('client_id', clientIds[0]!);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider.scopes ?? 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  if (params.provider !== 'facebook') {
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  if (params.provider === 'apple') url.searchParams.set('response_mode', 'form_post');

  return { authorizationUrl: url.toString(), state };
}

export async function handleOauthCallback(params: {
  provider: OauthProvider;
  code: string;
  state: string;
}): Promise<{ ticket: string; redirectTo: string }> {
  const row = await queryOne<Row>(
    `SELECT * FROM oauth_states WHERE state = ? AND provider_code = ? AND consumed_at IS NULL`,
    [params.state, params.provider],
  );
  if (!row || (row.expires_at as Date).getTime() < Date.now()) {
    throw new AppError('This sign-in attempt has expired. Please try again.', {
      status: 401,
      code: ErrorCode.OAUTH_INVALID,
    });
  }

  const identity = await exchangeAuthorizationCode(params.provider, params.code, row);
  const userId = await resolveOauthUser(identity, row.user_id === null ? null : Number(row.user_id));
  const ticket = randomToken(32);

  await execute(
    `UPDATE oauth_states
        SET resolved_user_id = ?, ticket_hash = ?, consumed_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [userId, sha256(ticket), row.id],
  );

  const redirectTo = `${env.WEB_URL}/auth/callback?ticket=${encodeURIComponent(ticket)}&provider=${params.provider}`;
  return { ticket, redirectTo };
}

export async function completeOauthTicket(ticket: string, device?: DeviceInput): Promise<AuthResult> {
  const row = await queryOne<Row>(
    `SELECT * FROM oauth_states WHERE ticket_hash = ? AND resolved_user_id IS NOT NULL`,
    [sha256(ticket)],
  );
  if (!row) {
    throw new AppError('This sign-in ticket is invalid or has already been used', {
      status: 401,
      code: ErrorCode.OAUTH_INVALID,
    });
  }
  if ((row.expires_at as Date).getTime() < Date.now()) {
    throw new AppError('This sign-in ticket has expired', { status: 401, code: ErrorCode.TOKEN_EXPIRED });
  }

  await execute('UPDATE oauth_states SET ticket_hash = NULL WHERE id = ?', [row.id]);
  return issueOauthSession(Number(row.resolved_user_id), device);
}

/**
 * Native SDK path: Flutter sends an ID token / access token. The backend verifies
 * it with the provider — the client is never trusted.
 */
export async function loginWithOauthToken(params: {
  provider: OauthProvider;
  token: string;
  nonce?: string;
  device?: DeviceInput;
  linkUserId?: number;
}): Promise<AuthResult> {
  const identity = await verifyProviderToken(params.provider, params.token, params.nonce);
  const userId = await resolveOauthUser(identity, params.linkUserId ?? null);
  return issueOauthSession(userId, params.device);
}

async function issueOauthSession(userId: number, device?: DeviceInput): Promise<AuthResult> {
  const user = await queryOne<Row>('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [userId]);
  if (!user) throw new AppError('Account not found', { status: 401, code: ErrorCode.INVALID_CREDENTIALS });
  assertLoginable(user);

  const grants = await loadGrants(userId);
  const deviceId = await upsertDevice(userId, device);
  const mfaEnabled = user.mfa_enabled === 1;
  const session = await createSession({
    userId,
    deviceId,
    method: 'oauth',
    mfaSatisfied: !mfaEnabled,
    roles: grants.roles,
    permissions: grants.permissions,
  });
  await afterSuccessfulLogin(userId, session.sessionId, deviceId, 'oauth');

  if (mfaEnabled) {
    return {
      user: await loadAuthenticatedUser(userId),
      tokens: session.tokens,
      mfaRequired: true,
      mfaFactors: await loadMfaFactorHints(userId),
    };
  }
  return { user: await loadAuthenticatedUser(userId), tokens: session.tokens };
}

async function resolveOauthUser(identity: NormalizedIdentity, linkUserId: number | null): Promise<number> {
  const provider = await loadProvider(identity.provider);

  const existing = await queryOne<Row>(
    `SELECT ui.user_id, u.status, u.deleted_at
       FROM user_identities ui
       JOIN users u ON u.id = ui.user_id
      WHERE ui.provider_id = ? AND ui.provider_user_id = ?`,
    [provider.id, identity.providerUserId],
  );

  if (existing) {
    if (linkUserId && Number(existing.user_id) !== linkUserId) {
      throw conflict('This identity is already linked to another account');
    }
    await execute(
      `UPDATE user_identities SET last_used_at = CURRENT_TIMESTAMP, email = COALESCE(?, email), display_name = COALESCE(?, display_name)
        WHERE provider_id = ? AND provider_user_id = ?`,
      [identity.email, identity.displayName, provider.id, identity.providerUserId],
    );
    return Number(existing.user_id);
  }

  if (linkUserId) {
    await linkIdentity(linkUserId, provider.id, identity);
    void recordAuthEvent({ type: AuthEvent.OAUTH_LINKED, userId: linkUserId, metadata: { provider: identity.provider } });
    return linkUserId;
  }

  // Never auto-merge on email alone. If an email account exists, the user must
  // sign in to that account and explicitly link the provider.
  if (identity.email) {
    const byEmail = await queryOne<Row>(
      'SELECT id FROM users WHERE email_normalized = ? AND deleted_at IS NULL',
      [identity.email.toLowerCase()],
    );
    if (byEmail) {
      throw new AppError('An account with this email already exists. Sign in and link this provider from Security settings.', {
        status: 409,
        code: ErrorCode.LINKING_REQUIRED,
        details: { provider: identity.provider },
      });
    }
  }

  const userUuid = uuid();
  const insert = await execute(
    `INSERT INTO users (uuid, email, email_verified_at, password_hash, account_type, status, language, currency, timezone)
     VALUES (?, ?, ?, NULL, 'individual', 'active', ?, ?, ?)`,
    [
      userUuid,
      identity.email,
      identity.email && identity.emailVerified ? new Date() : null,
      clip(contextOrDefaults().language, 10),
      clip(contextOrDefaults().currency, 3),
      clip(contextOrDefaults().timezone, 64),
    ],
  );
  const userId = insert.insertId;
  await execute('INSERT INTO user_profiles (user_id, display_name, avatar_url, profile_completeness) VALUES (?, ?, ?, 40)', [
    userId,
    identity.displayName,
    identity.pictureUrl,
  ]);
  await execute(`INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = 'user'`, [userId]);
  await execute(`INSERT INTO trust_scores (user_id, score, band) VALUES (?, 0, 'new')`, [userId]);
  const { ensureDefaultSubscription } = await import('../../middleware/entitlements');
  await ensureDefaultSubscription(userId);
  await linkIdentity(userId, provider.id, identity);
  void recordAuthEvent({ type: AuthEvent.OAUTH_LINKED, userId, metadata: { provider: identity.provider, created: true } });
  return userId;
}

async function linkIdentity(userId: number, providerId: number, identity: NormalizedIdentity): Promise<void> {
  await execute(
    `INSERT INTO user_identities
       (user_id, provider_id, provider_user_id, email, display_name, given_name, family_name, picture_url, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      userId,
      providerId,
      identity.providerUserId,
      identity.email,
      identity.displayName,
      identity.givenName,
      identity.familyName,
      identity.pictureUrl,
    ],
  );
}

export async function unlinkIdentity(userId: number, provider: OauthProvider): Promise<void> {
  const row = await loadProvider(provider);
  const remaining = await queryRows<Row>(
    `SELECT ui.id, p.code
       FROM user_identities ui JOIN identity_providers p ON p.id = ui.provider_id
      WHERE ui.user_id = ?`,
    [userId],
  );
  const user = await queryOne<Row>('SELECT email, phone_e164, password_hash FROM users WHERE id = ?', [userId]);
  const hasPassword = Boolean(user?.password_hash);
  const hasPhone = Boolean(user?.phone_e164);
  const otherIdentities = remaining.filter((item) => String(item.code) !== provider);
  if (!hasPassword && !hasPhone && otherIdentities.length === 0) {
    throw forbidden('Add another sign-in method before unlinking this one');
  }

  const result = await execute('DELETE FROM user_identities WHERE user_id = ? AND provider_id = ?', [userId, row.id]);
  if (result.affectedRows === 0) {
    throw new AppError('This provider is not linked', { status: 404, code: ErrorCode.NOT_FOUND });
  }
  void recordAuthEvent({ type: AuthEvent.OAUTH_UNLINKED, userId, metadata: { provider } });
}

export async function listIdentities(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT p.code, p.name, ui.email, ui.display_name, ui.linked_at, ui.last_used_at
       FROM user_identities ui
       JOIN identity_providers p ON p.id = ui.provider_id
      WHERE ui.user_id = ?
      ORDER BY ui.linked_at`,
    [userId],
  );
  return rows.map((row) => ({
    provider: String(row.code),
    name: String(row.name),
    email: (row.email as string | null) ?? null,
    displayName: (row.display_name as string | null) ?? null,
    linkedAt: (row.linked_at as Date).toISOString(),
    lastUsedAt: row.last_used_at ? (row.last_used_at as Date).toISOString() : null,
  }));
}

async function verifyProviderToken(provider: OauthProvider, token: string, nonce?: string): Promise<NormalizedIdentity> {
  const clientIds = clientIdsFor(provider);
  if (env.isTest && token.startsWith('test.')) {
    return parseTestIdentity(provider, token);
  }
  if (clientIds.length === 0 && !env.isDevelopment) {
    throw new AppError(`${provider} sign-in is not configured`, { status: 501, code: ErrorCode.NOT_IMPLEMENTED });
  }

  if (provider === 'facebook') return verifyFacebookToken(token);

  const meta = await loadProvider(provider);
  if (!meta.jwks_url || !meta.issuer) {
    throw new AppError('Provider discovery is incomplete', { status: 501, code: ErrorCode.NOT_IMPLEMENTED });
  }

  const payload = await verifyOidcIdToken({
    token,
    jwksUrl: meta.jwks_url,
    issuer: meta.issuer,
    audience: clientIds.length > 0 ? clientIds : env.JWT_AUDIENCE,
    nonce,
  });

  return {
    provider,
    providerUserId: payload.sub,
    email: payload.email ?? null,
    emailVerified: payload.email_verified === true || provider === 'apple',
    displayName: payload.name ?? null,
    givenName: payload.given_name ?? null,
    familyName: payload.family_name ?? null,
    pictureUrl: payload.picture ?? null,
  };
}

async function verifyFacebookToken(token: string): Promise<NormalizedIdentity> {
  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) {
    throw new AppError('Facebook sign-in is not configured', { status: 501, code: ErrorCode.NOT_IMPLEMENTED });
  }
  const appToken = `${env.FACEBOOK_APP_ID}|${env.FACEBOOK_APP_SECRET}`;
  const debugUrl = new URL('https://graph.facebook.com/debug_token');
  debugUrl.searchParams.set('input_token', token);
  debugUrl.searchParams.set('access_token', appToken);
  const debug = await fetch(debugUrl);
  const debugBody = (await debug.json()) as { data?: { is_valid?: boolean; app_id?: string; user_id?: string } };
  if (!debugBody.data?.is_valid || debugBody.data.app_id !== env.FACEBOOK_APP_ID) {
    throw new AppError('Facebook token is invalid', { status: 401, code: ErrorCode.OAUTH_INVALID });
  }

  const meUrl = new URL('https://graph.facebook.com/me');
  meUrl.searchParams.set('fields', 'id,email,name,first_name,last_name,picture');
  meUrl.searchParams.set('access_token', token);
  const me = await fetch(meUrl);
  const profile = (await me.json()) as {
    id?: string;
    email?: string;
    name?: string;
    first_name?: string;
    last_name?: string;
    picture?: { data?: { url?: string } };
  };
  if (!profile.id) throw new AppError('Facebook profile could not be loaded', { status: 401, code: ErrorCode.OAUTH_INVALID });

  return {
    provider: 'facebook',
    providerUserId: profile.id,
    email: profile.email ?? null,
    emailVerified: Boolean(profile.email),
    displayName: profile.name ?? null,
    givenName: profile.first_name ?? null,
    familyName: profile.last_name ?? null,
    pictureUrl: profile.picture?.data?.url ?? null,
  };
}

async function exchangeAuthorizationCode(provider: OauthProvider, code: string, stateRow: Row): Promise<NormalizedIdentity> {
  const meta = await loadProvider(provider);
  const clientIds = clientIdsFor(provider);
  if (!meta.token_url || clientIds.length === 0) {
    throw new AppError('OAuth token endpoint is not configured', { status: 501, code: ErrorCode.NOT_IMPLEMENTED });
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: String(stateRow.redirect_uri),
    client_id: clientIds[0]!,
  });
  if (stateRow.code_verifier) body.set('code_verifier', String(stateRow.code_verifier));
  const secret =
    provider === 'google'
      ? env.GOOGLE_CLIENT_SECRET
      : provider === 'facebook'
        ? env.FACEBOOK_APP_SECRET
        : provider === 'microsoft'
          ? env.MICROSOFT_CLIENT_SECRET
          : undefined;
  if (secret) body.set('client_secret', secret);

  const response = await fetch(meta.token_url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const payload = (await response.json()) as { id_token?: string; access_token?: string; error?: string };
  if (!response.ok) {
    log.warn({ provider, error: payload.error }, 'oauth code exchange failed');
    throw new AppError('Could not complete provider sign-in', { status: 401, code: ErrorCode.OAUTH_INVALID });
  }

  if (payload.id_token) {
    return verifyProviderToken(provider, payload.id_token, String(stateRow.nonce));
  }
  if (provider === 'facebook' && payload.access_token) {
    return verifyFacebookToken(payload.access_token);
  }
  throw new AppError('Provider did not return a verifiable identity token', { status: 401, code: ErrorCode.OAUTH_INVALID });
}

function parseTestIdentity(provider: OauthProvider, token: string): NormalizedIdentity {
  // Format: test.<providerUserId>.<email>
  const parts = token.split('.');
  const providerUserId = parts[1] || 'test-user';
  const email = parts[2] ? decodeURIComponent(parts[2]) : `${providerUserId}@example.test`;
  return {
    provider,
    providerUserId,
    email,
    emailVerified: true,
    displayName: 'Test User',
    givenName: 'Test',
    familyName: 'User',
    pictureUrl: null,
  };
}

export function assertCanUseTestOauthToken(token: string): void {
  if (token.startsWith('test.') && !env.isTest && !env.isDevelopment) {
    throw badRequest('Test identity tokens are not accepted in this environment');
  }
}
