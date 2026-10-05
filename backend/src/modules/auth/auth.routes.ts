import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok } from '../../core/http/response';
import { validate, body, params } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authRateLimit, otpRateLimit, oauthRateLimit, passwordResetRateLimit, writeRateLimit } from '../../middleware/rate-limit';
import { riskGuard } from '../../middleware/risk-guard';
import { recordAudit } from '../../middleware/audit';
import { unauthenticated } from '../../core/errors';
import {
  captchaSolveSchema,
  changeContactSchema,
  changePasswordSchema,
  completeLoginSchema,
  confirmContactSchema,
  disableMfaSchema,
  enableMfaSchema,
  forgotPasswordSchema,
  guestSessionSchema,
  loginSchema,
  logoutSchema,
  oauthCompleteSchema,
  oauthSchema,
  oauthStartSchema,
  passkeyAuthenticateSchema,
  passkeyRegisterBeginSchema,
  passkeyRegisterFinishSchema,
  refreshSchema,
  registerSchema,
  renamePasskeySchema,
  requestOtpSchema,
  resendLoginOtpSchema,
  resetPasswordSchema,
  unlinkOauthSchema,
  verifyMfaSchema,
  verifyOtpSchema,
} from './auth.schema';
import {
  changePassword,
  completeEmailVerification,
  completePhoneVerification,
  completePasswordLogin,
  confirmContactChange,
  createGuestSession,
  forgotPassword,
  listSessions,
  loadAuthenticatedUser,
  login,
  loginWithOtp,
  logout,
  refresh,
  register,
  requestContactChange,
  resendLoginOtp,
  resetPassword,
  revokeSession,
  sendOtp,
  verifyOtp,
} from './auth.service';
import { issueCaptchaChallenge, solveInternalCaptcha, verifyCaptchaToken } from './auth.captcha';
import {
  completeOauthTicket,
  handleOauthCallback,
  listIdentities,
  loginWithOauthToken,
  startOauth,
  unlinkIdentity,
  assertCanUseTestOauthToken,
} from './auth.oauth';
import {
  beginEnableMfa,
  beginMfaChallenge,
  confirmEnableMfa,
  disableMfa,
  listMfaFactors,
  regenerateRecoveryCodes,
  verifyMfaChallenge,
} from './auth.mfa';
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  listPasskeys,
  removePasskey,
  renamePasskey,
} from './auth.passkey';
import { deviceAccountRelationships, listDevices, revokeDevice } from './auth.devices';
import { listSecurityEvents } from './auth.security';
import { AppError, ErrorCode } from '../../core/errors';
import { GUEST_RESTRICTIONS } from '../locale/guest-restrictions';

export const authRouter = Router();

/** §1 Guest Mode — browse before login. */
authRouter.post(
  '/guest',
  writeRateLimit,
  validate({ body: guestSessionSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof guestSessionSchema>>(req);
    const session = await createGuestSession(input);
    return created(res, {
      ...session,
      restrictions: GUEST_RESTRICTIONS,
    });
  }),
);

authRouter.post(
  '/register',
  authRateLimit,
  riskGuard('enforce'),
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof registerSchema>>(req);
    if (req.context.riskDecision === 'challenge') {
      const captchaOk = await verifyCaptchaToken(input.captchaToken, 'register');
      if (!captchaOk) {
        throw new AppError('Additional verification is required', { status: 403, code: ErrorCode.CAPTCHA_REQUIRED });
      }
    }
    const result = await register(input);
    void recordAudit({ action: 'auth.register', entityType: 'user', entityId: result.user.id, actorId: result.user.id });
    return created(res, result);
  }),
);

authRouter.post(
  '/login',
  authRateLimit,
  riskGuard('enforce'),
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof loginSchema>>(req);
    if (req.context.riskDecision === 'challenge') {
      const captchaOk = await verifyCaptchaToken(input.captchaToken, 'login');
      if (!captchaOk) {
        throw new AppError('Additional verification is required', { status: 403, code: ErrorCode.CAPTCHA_REQUIRED });
      }
    }
    const result = await login(input.identifier, input.password, input.device, input.channel);
    return ok(res, result);
  }),
);

authRouter.post(
  '/login/complete',
  authRateLimit,
  validate({ body: completeLoginSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof completeLoginSchema>>(req);
    const result = await completePasswordLogin(input.ticket, input.code, input.device);
    return ok(res, result);
  }),
);

authRouter.post(
  '/login/otp',
  otpRateLimit,
  validate({ body: resendLoginOtpSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof resendLoginOtpSchema>>(req);
    const result = await resendLoginOtp(input.ticket, input.channel);
    return ok(res, result);
  }),
);

/** §2 OTP — request a code for login, registration or verification. */
authRouter.post(
  '/otp/request',
  otpRateLimit,
  riskGuard('enforce'),
  validate({ body: requestOtpSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof requestOtpSchema>>(req);
    const result = await sendOtp(input);
    return ok(res, result);
  }),
);

/**
 * Verifying a login/register OTP returns a session; verifying an
 * email/phone/device code just confirms the destination.
 */
authRouter.post(
  '/otp/verify',
  authRateLimit,
  validate({ body: verifyOtpSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof verifyOtpSchema>>(req);

    if (input.purpose === 'login' || input.purpose === 'register') {
      const result = await loginWithOtp(input);
      return ok(res, result);
    }

    const verified = await verifyOtp(input);
    return ok(res, { verified: true, destination: verified.destination, purpose: input.purpose });
  }),
);

authRouter.post(
  '/refresh',
  authRateLimit,
  validate({ body: refreshSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof refreshSchema>>(req);
    const tokens = await refresh(input.refreshToken);
    return ok(res, { tokens });
  }),
);

authRouter.post(
  '/logout',
  authenticate,
  requireAuth,
  validate({ body: logoutSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof logoutSchema>>(req);
    const result = await logout({
      userId: req.auth!.userId,
      sessionId: req.auth!.sessionId,
      refreshToken: input.refreshToken,
      allDevices: input.allDevices,
      otherDevices: input.otherDevices,
    });
    void recordAudit({
      action: input.allDevices ? 'auth.logout_all' : input.otherDevices ? 'auth.logout_others' : 'auth.logout',
      entityType: 'user',
      entityId: req.auth!.userId,
    });
    return ok(res, result);
  }),
);

/** The client calls this on start-up to restore state after a cold launch. */
authRouter.get(
  '/me',
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await loadAuthenticatedUser(req.auth!.userId);
    return ok(res, {
      user,
      permissions: req.auth!.permissions,
      roles: req.auth!.roles,
      scopes: req.auth!.scopes,
      isStaff: req.auth!.isStaff,
      mfaSatisfied: req.auth!.mfaSatisfied,
    });
  }),
);

/** §25 Session Management — the "where am I signed in" screen. */
authRouter.get(
  '/sessions',
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessions = await listSessions(req.auth!.userId, req.auth!.sessionId);
    return ok(res, sessions);
  }),
);

authRouter.delete(
  '/sessions/:uuid',
  authenticate,
  requireAuth,
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    await revokeSession(req.auth!.userId, uuid);
    void recordAudit({ action: 'auth.session_revoked', entityType: 'user_session', entityId: uuid });
    return ok(res, { revoked: true });
  }),
);

authRouter.post(
  '/password/forgot',
  passwordResetRateLimit,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof forgotPasswordSchema>>(req);
    const result = await forgotPassword(input.identifier);
    return ok(res, result);
  }),
);

authRouter.post(
  '/password/reset',
  passwordResetRateLimit,
  validate({ body: resetPasswordSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof resetPasswordSchema>>(req);
    const result = await resetPassword(input);
    void recordAudit({ action: 'auth.password_reset', entityType: 'user', entityId: result.userId, actorId: result.userId });
    return ok(res, { reset: true, revokedSessions: result.revokedSessions });
  }),
);

authRouter.post(
  '/password/change',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof changePasswordSchema>>(req);
    if (!req.auth) throw unauthenticated();
    const result = await changePassword(req.auth.userId, input.currentPassword, input.newPassword);
    void recordAudit({ action: 'auth.password_changed', entityType: 'user', entityId: req.auth.userId });
    return ok(res, { changed: true, revokedSessions: result.revokedSessions });
  }),
);

authRouter.post(
  '/email/verify',
  authRateLimit,
  validate({ body: verifyOtpSchema.pick({ destination: true, code: true }) }),
  asyncHandler(async (req, res) => {
    const input = body<{ destination: string; code: string }>(req);
    return ok(res, await completeEmailVerification(input.destination, input.code));
  }),
);

authRouter.post(
  '/phone/verify',
  authRateLimit,
  validate({ body: verifyOtpSchema.pick({ destination: true, code: true }) }),
  asyncHandler(async (req, res) => {
    const input = body<{ destination: string; code: string }>(req);
    return ok(res, await completePhoneVerification(input.destination, input.code));
  }),
);

authRouter.post(
  '/contact/change',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ body: changeContactSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof changeContactSchema>>(req);
    if (input.email) return ok(res, await requestContactChange(req.auth!.userId, 'email', input.email));
    if (input.phone) return ok(res, await requestContactChange(req.auth!.userId, 'phone', input.phone));
    throw unauthenticated();
  }),
);

authRouter.post(
  '/contact/confirm',
  authenticate,
  requireAuth,
  authRateLimit,
  validate({ body: confirmContactSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof confirmContactSchema>>(req);
    return ok(res, await confirmContactChange(req.auth!.userId, input.kind, input.code));
  }),
);

authRouter.post(
  '/captcha/challenge',
  authRateLimit,
  asyncHandler(async (_req, res) => ok(res, await issueCaptchaChallenge('auth'))),
);

authRouter.post(
  '/captcha/solve',
  authRateLimit,
  validate({ body: captchaSolveSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof captchaSolveSchema>>(req);
    return ok(res, await solveInternalCaptcha(input.token));
  }),
);

authRouter.post(
  '/oauth/start',
  oauthRateLimit,
  validate({ body: oauthStartSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof oauthStartSchema>>(req);
    const result = await startOauth({
      provider: input.provider,
      platform: input.platform ?? req.context.platform,
      redirectUri: input.redirectUri,
      linkUserId: req.auth?.userId,
    });
    return ok(res, result);
  }),
);

authRouter.get(
  '/oauth/:provider/callback',
  authRateLimit,
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider) as 'google' | 'apple' | 'facebook' | 'microsoft';
    const code = String(req.query.code ?? req.body?.code ?? '');
    const state = String(req.query.state ?? req.body?.state ?? '');
    const result = await handleOauthCallback({ provider, code, state });
    res.redirect(result.redirectTo);
  }),
);

authRouter.post(
  '/oauth/:provider/callback',
  authRateLimit,
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider) as 'google' | 'apple' | 'facebook' | 'microsoft';
    const code = String((req.body as { code?: string })?.code ?? '');
    const state = String((req.body as { state?: string })?.state ?? '');
    const result = await handleOauthCallback({ provider, code, state });
    res.redirect(result.redirectTo);
  }),
);

authRouter.post(
  '/oauth/complete',
  authRateLimit,
  validate({ body: oauthCompleteSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof oauthCompleteSchema>>(req);
    return ok(res, await completeOauthTicket(input.ticket, input.device));
  }),
);

authRouter.post(
  '/oauth',
  oauthRateLimit,
  riskGuard('enforce'),
  validate({ body: oauthSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof oauthSchema>>(req);
    assertCanUseTestOauthToken(input.token);
    const result = await loginWithOauthToken({
      provider: input.provider,
      token: input.token,
      nonce: input.nonce,
      device: input.device,
      linkUserId: req.auth?.userId,
    });
    return ok(res, result);
  }),
);

authRouter.get(
  '/identities',
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => ok(res, await listIdentities(req.auth!.userId))),
);

authRouter.delete(
  '/identities/:provider',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: unlinkOauthSchema }),
  asyncHandler(async (req, res) => {
    const { provider } = params<z.infer<typeof unlinkOauthSchema>>(req);
    await unlinkIdentity(req.auth!.userId, provider);
    return ok(res, { unlinked: true });
  }),
);

authRouter.post(
  '/mfa/enable',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ body: enableMfaSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof enableMfaSchema>>(req);
    return ok(res, await beginEnableMfa(req.auth!.userId, input.kind, input.destination));
  }),
);

authRouter.post(
  '/mfa/enable/confirm',
  authenticate,
  requireAuth,
  authRateLimit,
  validate({ body: verifyMfaSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof verifyMfaSchema>>(req);
    return ok(res, await confirmEnableMfa(req.auth!.userId, input.code, input.factorId));
  }),
);

authRouter.post(
  '/mfa/disable',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ body: disableMfaSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof disableMfaSchema>>(req);
    return ok(res, await disableMfa(req.auth!.userId, input.code));
  }),
);

authRouter.get(
  '/mfa',
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => ok(res, await listMfaFactors(req.auth!.userId))),
);

authRouter.post(
  '/mfa/recovery/regenerate',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ body: disableMfaSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof disableMfaSchema>>(req);
    return ok(res, await regenerateRecoveryCodes(req.auth!.userId, input.code));
  }),
);

authRouter.post(
  '/mfa/challenge',
  authenticate,
  requireAuth,
  authRateLimit,
  asyncHandler(async (req, res) => ok(res, await beginMfaChallenge(req.auth!.userId, req.auth!.sessionId))),
);

authRouter.post(
  '/mfa/verify',
  authenticate,
  requireAuth,
  authRateLimit,
  validate({ body: verifyMfaSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof verifyMfaSchema>>(req);
    return ok(res, await verifyMfaChallenge({
      userId: req.auth!.userId,
      sessionId: req.auth!.sessionId,
      code: input.code,
      challengeId: input.challengeId,
    }));
  }),
);

authRouter.post(
  '/passkeys/register/begin',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ body: passkeyRegisterBeginSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof passkeyRegisterBeginSchema>>(req);
    return ok(res, await beginPasskeyRegistration(req.auth!.userId, input.deviceLabel));
  }),
);

authRouter.post(
  '/passkeys/register/finish',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ body: passkeyRegisterFinishSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof passkeyRegisterFinishSchema>>(req);
    return ok(res, await finishPasskeyRegistration({ userId: req.auth!.userId, ...input }));
  }),
);

authRouter.post(
  '/passkeys/authenticate/begin',
  authRateLimit,
  asyncHandler(async (req, res) => ok(res, await beginPasskeyAuthentication(req.auth?.userId))),
);

authRouter.post(
  '/passkeys/authenticate/finish',
  authRateLimit,
  validate({ body: passkeyAuthenticateSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof passkeyAuthenticateSchema>>(req);
    return ok(res, await finishPasskeyAuthentication(input));
  }),
);

authRouter.get(
  '/passkeys',
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => ok(res, await listPasskeys(req.auth!.userId))),
);

authRouter.patch(
  '/passkeys/:id',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: renamePasskeySchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<z.infer<typeof renamePasskeySchema>>(req);
    await renamePasskey(req.auth!.userId, id, input.label);
    return ok(res, { renamed: true });
  }),
);

authRouter.delete(
  '/passkeys/:id',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    await removePasskey(req.auth!.userId, id);
    return ok(res, { removed: true });
  }),
);

authRouter.get(
  '/devices',
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => ok(res, await listDevices(req.auth!.userId, req.device.id))),
);

authRouter.delete(
  '/devices/:uuid',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ uuid: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const result = await revokeDevice(req.auth!.userId, uuid);
    void recordAudit({ action: 'auth.device_revoked', entityType: 'user_device', entityId: uuid });
    return ok(res, { revoked: true, ...result });
  }),
);

authRouter.get(
  '/devices/relationships',
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => ok(res, await deviceAccountRelationships(req.auth!.userId))),
);

authRouter.get(
  '/security/events',
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => ok(res, await listSecurityEvents(req.auth!.userId))),
);

authRouter.get(
  '/security/settings',
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user, mfa, identities, passkeys, sessions, devices] = await Promise.all([
      loadAuthenticatedUser(req.auth!.userId),
      listMfaFactors(req.auth!.userId),
      listIdentities(req.auth!.userId),
      listPasskeys(req.auth!.userId),
      listSessions(req.auth!.userId, req.auth!.sessionId),
      listDevices(req.auth!.userId, req.device.id),
    ]);
    return ok(res, {
      mfaEnabled: user.mfaEnabled,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      mfa,
      identities,
      passkeys,
      sessions,
      devices,
    });
  }),
);

