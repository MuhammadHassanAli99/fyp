/**
 * Trust & Risk Platform types.
 *
 * One engine for Gold, Property, Vehicles, auth, payments, chat and reviews.
 * VPN / proxy / root / jailbreak / emulator / shared IP / multiple devices
 * are signals. They are never, by themselves, a fraud conclusion.
 */

export const RISK_DECISIONS = [
  'allow',
  'allow_with_monitoring',
  'step_up_verification',
  'review',
  'temporary_restriction',
  'block',
] as const;

export type RiskDecision = (typeof RISK_DECISIONS)[number];

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export type RiskEventType =
  | 'REGISTER'
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'PASSWORD_CHANGED'
  | 'EMAIL_CHANGED'
  | 'PHONE_CHANGED'
  | 'MFA_CHANGED'
  | 'NEW_DEVICE'
  | 'NEW_IP'
  | 'NEW_LOCATION'
  | 'LISTING_CREATED'
  | 'LISTING_UPDATED'
  | 'LISTING_DELETED'
  | 'LISTING_SUBMITTED'
  | 'REVIEW_CREATED'
  | 'REVIEW_REPORTED'
  | 'AD_CLICK'
  | 'MESSAGE_SENT'
  | 'FAVORITE_CREATED'
  | 'PAYMENT_CREATED'
  | 'PAYMENT_FAILED'
  | 'SUBSCRIPTION_CHANGED'
  | 'KYC_SUBMITTED'
  | 'KYC_VERIFIED'
  | 'DOCUMENT_UPLOADED'
  | 'REQUEST';

export type RiskSubjectKind = 'user' | 'device' | 'listing' | 'payment' | 'session' | 'message' | 'review' | 'ip';

export interface RiskSignalHit {
  code: string;
  weight: number;
  detail?: string;
  category?: string;
}

export interface RiskPolicyThresholds {
  code: string;
  allowMax: number;
  monitorMax: number;
  stepUpMax: number;
  reviewMax: number;
  restrictionMax: number;
  whitelistScoreReduction: number;
}

export interface RiskEvaluationInput {
  eventType: RiskEventType;
  subjectKind: RiskSubjectKind;
  subjectId: number;
  userId?: number | null;
  deviceId?: number | null;
  listingId?: number | null;
  reviewId?: number | null;
  requestId?: string | null;
  ip?: string | null;
  countryId?: number | null;
  marketplaceId?: number | null;
  policyCode?: string;
  extraSignals?: RiskSignalHit[];
  /** When true, persist + enqueue jobs. Request-path scoring can skip expensive I/O. */
  persist?: boolean;
}

export interface RiskDecisionRecord {
  uuid: string;
  eventType: RiskEventType;
  subjectKind: RiskSubjectKind;
  subjectId: number;
  userId: number | null;
  deviceId: number | null;
  listingId: number | null;
  reviewId: number | null;
  requestId: string | null;
  riskScore: number;
  riskLevel: RiskLevel;
  decision: RiskDecision;
  confidence: number;
  signals: RiskSignalHit[];
  rulesTriggered: string[];
  modelId: string;
  modelVersion: string;
  policyCode: string;
  requiresReview: boolean;
  timestamp: string;
}

export const DEVICE_STATES = [
  'first_seen',
  'active',
  'trusted',
  'suspicious',
  'blocked',
  'retired',
  'revoked',
] as const;
export type DeviceState = (typeof DEVICE_STATES)[number];

export const KYC_STATUSES = [
  'not_started',
  'pending',
  'in_review',
  'verified',
  'rejected',
  'expired',
  'requires_update',
] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const FRAUD_CASE_STATUSES = [
  'open',
  'investigating',
  'confirmed',
  'false_positive',
  'resolved',
  'appealed',
] as const;
export type FraudCaseStatus = (typeof FRAUD_CASE_STATUSES)[number];

export const REVIEW_RISK_STATES = ['NORMAL', 'SUSPICIOUS', 'REVIEW', 'REJECTED'] as const;
export type ReviewRiskState = (typeof REVIEW_RISK_STATES)[number];

/** Signals that must never be treated as automatic fraud on their own. */
export const NON_CONCLUSIVE_SIGNALS = new Set([
  'ip_vpn',
  'ip_proxy',
  'ip_tor',
  'ip_datacenter',
  'device_rooted',
  'device_jailbroken',
  'device_emulator',
  'device_debugging',
  'device_automation',
  'shared_ip_accounts',
  'shared_device_accounts',
  'device_several_accounts',
  'device_many_accounts',
  'new_device',
  'impossible_travel',
  'gps_spoof_suspected',
]);
