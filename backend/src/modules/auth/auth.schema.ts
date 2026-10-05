import { z } from 'zod';

/**
 * Shared primitives. Phone numbers are normalised to E.164 here so the rest of
 * the system only ever deals with one representation.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(191);

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{6,17}$/, 'Enter a valid phone number with country code')
  .transform((value) => (value.startsWith('+') ? value : `+${value}`));

const optionalEmail = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  emailSchema.optional(),
);

const optionalPhone = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  phoneSchema.optional(),
);

export const passwordSchema = z.string().min(8, 'Password must be at least 8 characters').max(128);

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Username may only contain letters, numbers, dots, dashes and underscores');

/** Device metadata sent with every auth call, used for session binding + risk. */
export const deviceSchema = z
  .object({
    deviceId: z.string().max(191).optional(),
    deviceName: z.string().max(128).optional(),
    deviceModel: z.string().max(128).optional(),
    manufacturer: z.string().max(96).optional(),
    browser: z.string().max(96).optional(),
    osVersion: z.string().max(48).optional(),
    appVersion: z.string().max(24).optional(),
    pushToken: z.string().max(512).optional(),
    pushProvider: z.enum(['fcm', 'apns', 'webpush', 'none']).default('none'),
    isRooted: z.coerce.boolean().default(false),
    isJailbroken: z.coerce.boolean().default(false),
    isEmulator: z.coerce.boolean().default(false),
  })
  .optional();

export const registerSchema = z
  .object({
    email: optionalEmail,
    phone: optionalPhone,
    password: passwordSchema.optional(),
    username: usernameSchema.optional(),
    displayName: z.string().trim().min(2).max(128).optional(),
    accountType: z.enum(['individual', 'business']).default('individual'),
    countryCode: z.string().length(2).toUpperCase().optional(),
    language: z.string().max(10).optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    referralCode: z.string().max(32).optional(),
    acceptedTerms: z.literal(true, { message: 'You must accept the terms to create an account' }),
    marketingConsent: z.coerce.boolean().default(false),
    device: deviceSchema,
    captchaToken: z.string().max(2048).optional(),
  })
  .refine((data) => Boolean(data.email ?? data.phone), {
    message: 'Provide an email address or a phone number',
    path: ['email'],
  })
  .refine((data) => Boolean(data.password) || Boolean(data.email ?? data.phone), {
    message: 'Provide a password or register with a one-time code',
    path: ['password'],
  });

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(191),
  password: z.string().min(1).max(128),
  channel: z.enum(['email', 'sms', 'whatsapp']).optional(),
  device: deviceSchema,
  captchaToken: z.string().max(2048).optional(),
});

export const completeLoginSchema = z.object({
  ticket: z.string().uuid(),
  code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the code from your message'),
  device: deviceSchema,
});

export const resendLoginOtpSchema = z.object({
  ticket: z.string().uuid(),
  channel: z.enum(['email', 'sms', 'whatsapp']).optional(),
});

export const requestOtpSchema = z.object({
  destination: z.string().trim().min(3).max(191),
  channel: z.enum(['email', 'sms', 'whatsapp']).default('sms'),
  purpose: z
    .enum(['login', 'register', 'verify_email', 'verify_phone', 'reset_password', 'mfa', 'device_verify'])
    .default('login'),
  captchaToken: z.string().max(2048).optional(),
});

export const verifyOtpSchema = z.object({
  destination: z.string().trim().min(3).max(191),
  code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the code from your message'),
  purpose: z
    .enum(['login', 'register', 'verify_email', 'verify_phone', 'reset_password', 'mfa', 'device_verify'])
    .default('login'),
  device: deviceSchema,
});

export const oauthSchema = z.object({
  provider: z.enum(['google', 'apple', 'facebook', 'microsoft']),
  /** ID token (Google/Apple/Microsoft) or access token (Facebook). */
  token: z.string().min(16).max(8192),
  nonce: z.string().max(191).optional(),
  device: deviceSchema,
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(16).max(512),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(16).max(512).optional(),
  allDevices: z.coerce.boolean().default(false),
  otherDevices: z.coerce.boolean().default(false),
});

export const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(3).max(191),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(512).optional(),
  /** OTP path: destination + code instead of an emailed token. */
  destination: z.string().trim().max(191).optional(),
  code: z.string().trim().max(8).optional(),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const enableMfaSchema = z.object({
  kind: z.enum(['totp', 'sms', 'email']),
  destination: z.string().trim().max(191).optional(),
});

export const verifyMfaSchema = z.object({
  factorId: z.coerce.number().int().positive().optional(),
  challengeId: z.string().uuid().optional(),
  code: z.string().trim().min(4).max(16),
});

export const passkeyRegisterBeginSchema = z.object({
  deviceLabel: z.string().trim().max(96).optional(),
});

export const passkeyRegisterFinishSchema = z.object({
  credentialId: z.string().min(16).max(512),
  publicKey: z.string().min(16).max(4096),
  challenge: z.string().min(16).max(512),
  clientDataJSON: z.string().min(16).max(4096).optional(),
  transports: z.string().max(96).optional(),
  aaguid: z.string().max(36).optional(),
  deviceLabel: z.string().trim().max(96).optional(),
  backedUp: z.coerce.boolean().default(false),
});

export const passkeyAuthenticateSchema = z.object({
  credentialId: z.string().min(16).max(512),
  signature: z.string().min(16).max(4096).optional(),
  authenticatorData: z.string().min(16).max(4096).optional(),
  clientDataJSON: z.string().min(16).max(4096).optional(),
  challenge: z.string().min(16).max(512),
  device: deviceSchema,
});

export const guestSessionSchema = z.object({
  countryCode: z.string().length(2).toUpperCase().optional(),
  language: z.string().max(10).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  measurementSystem: z.enum(['metric', 'imperial']).optional(),
  device: deviceSchema,
});

export const oauthStartSchema = z.object({
  provider: z.enum(['google', 'apple', 'facebook', 'microsoft']),
  platform: z.string().max(32).optional(),
  redirectUri: z.string().url().max(512).optional(),
});

export const oauthCompleteSchema = z.object({
  ticket: z.string().min(16).max(512),
  device: deviceSchema,
});

export const unlinkOauthSchema = z.object({
  provider: z.enum(['google', 'apple', 'facebook', 'microsoft']),
});

export const changeContactSchema = z.object({
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
});

export const confirmContactSchema = z.object({
  kind: z.enum(['email', 'phone']),
  code: z.string().trim().regex(/^\d{4,8}$/),
});

export const captchaSolveSchema = z.object({
  token: z.string().uuid(),
});

export const disableMfaSchema = z.object({
  code: z.string().trim().min(4).max(16),
});

export const renamePasskeySchema = z.object({
  label: z.string().trim().min(1).max(96),
});

export const revokeDeviceSchema = z.object({
  uuid: z.string().uuid(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type OauthInput = z.infer<typeof oauthSchema>;
export type DeviceInput = z.infer<typeof deviceSchema>;
