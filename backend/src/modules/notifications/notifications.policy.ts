import type { ChannelDecision, NotificationChannel, PolicyGroup, StoredPriority, UserNotificationContext } from './notifications.types';
import { isWithinQuietHours, nextQuietHoursEnd } from './notifications.timezone';

export interface CategoryPolicy {
  code: string;
  groupCode: string | null;
  policyGroup: PolicyGroup;
  marketplaceScope: string;
  defaultPush: boolean;
  defaultEmail: boolean;
  defaultSms: boolean;
  defaultInApp: boolean;
  isTransactional: boolean;
  isActive: boolean;
}

export interface PreferenceOverride {
  push: boolean;
  email: boolean;
  sms: boolean;
  inApp: boolean;
  whatsapp: boolean;
}

export interface QuietHoursConfig {
  isEnabled: boolean;
  startTime: string | null;
  endTime: string | null;
  timezone: string | null;
  allowUrgent: boolean;
  daysOfWeek: number[] | null;
}

export interface PolicyInput {
  category: CategoryPolicy;
  preference: PreferenceOverride | null;
  quietHours: QuietHoursConfig | null;
  user: UserNotificationContext;
  priority: StoredPriority;
  now: Date;
  isSilent: boolean;
  hasInstantAlerts: boolean;
  skipChannels?: NotificationChannel[];
}

const CHANNELS: NotificationChannel[] = ['in_app', 'push', 'email', 'sms', 'silent'];

function defaultFor(channel: NotificationChannel, category: CategoryPolicy): boolean {
  if (channel === 'in_app') return category.defaultInApp;
  if (channel === 'push') return category.defaultPush;
  if (channel === 'email') return category.defaultEmail;
  if (channel === 'sms') return category.defaultSms;
  if (channel === 'silent') return false;
  return false;
}

function prefFor(channel: NotificationChannel, pref: PreferenceOverride | null, category: CategoryPolicy): boolean {
  if (!pref) return defaultFor(channel, category);
  if (channel === 'in_app') return pref.inApp;
  if (channel === 'push') return pref.push;
  if (channel === 'email') return pref.email;
  if (channel === 'sms') return pref.sms;
  if (channel === 'whatsapp') return pref.whatsapp;
  if (channel === 'silent') return true;
  return false;
}

export function isCriticalOverride(policyGroup: PolicyGroup, priority: StoredPriority): boolean {
  if (policyGroup === 'SECURITY') return true;
  if (policyGroup === 'TRANSACTIONAL' && (priority === 'urgent' || priority === 'high')) return true;
  return priority === 'urgent';
}

/**
 * Marketing and optional marketplace instant alerts may require a paid plan.
 * Security and transactional notifications are never withheld for plan status.
 */
export function channelAllowedBySubscription(
  channel: NotificationChannel,
  policyGroup: PolicyGroup,
  hasInstantAlerts: boolean,
): { allowed: boolean; digestInstead: boolean } {
  if (policyGroup === 'SECURITY' || policyGroup === 'TRANSACTIONAL') {
    return { allowed: true, digestInstead: false };
  }
  if ((policyGroup === 'MARKETPLACE' || policyGroup === 'MARKETING') && channel === 'push' && !hasInstantAlerts) {
    return { allowed: false, digestInstead: true };
  }
  if (policyGroup === 'MARKETING' && channel === 'sms') {
    return { allowed: false, digestInstead: false };
  }
  return { allowed: true, digestInstead: false };
}

export function evaluatePolicy(input: PolicyInput): ChannelDecision[] {
  const skip = new Set(input.skipChannels ?? []);
  const critical = isCriticalOverride(input.category.policyGroup, input.priority);
  const quiet =
    !critical &&
    Boolean(input.quietHours?.isEnabled) &&
    isWithinQuietHours(
      input.now,
      input.quietHours?.startTime ?? null,
      input.quietHours?.endTime ?? null,
      input.quietHours?.timezone || input.user.timezone,
      input.quietHours?.daysOfWeek ?? null,
    );
  const delayUntil =
    quiet && input.quietHours
      ? nextQuietHoursEnd(
          input.now,
          input.quietHours.startTime,
          input.quietHours.endTime,
          input.quietHours.timezone || input.user.timezone,
        )
      : null;

  return CHANNELS.filter((channel) => !skip.has(channel)).map((channel) => {
    if (!input.category.isActive) {
      return { channel, allowed: false, delayUntil: null, reason: 'category_inactive' };
    }
    if (channel === 'silent') {
      return { channel, allowed: input.isSilent, delayUntil: null, reason: input.isSilent ? 'silent' : 'not_silent' };
    }
    if (critical && (channel === 'push' || channel === 'in_app' || channel === 'email' || (channel === 'sms' && input.category.policyGroup === 'SECURITY'))) {
      const smsOk = channel !== 'sms' || Boolean(input.user.phoneE164);
      return {
        channel,
        allowed: smsOk && (channel !== 'email' || Boolean(input.user.email)),
        delayUntil: null,
        reason: 'critical_override',
      };
    }
    if (!prefFor(channel, input.preference, input.category)) {
      return { channel, allowed: false, delayUntil: null, reason: 'preference_off' };
    }
    if (channel === 'email' && !input.user.email) {
      return { channel, allowed: false, delayUntil: null, reason: 'no_email' };
    }
    if (channel === 'sms' && !input.user.phoneE164) {
      return { channel, allowed: false, delayUntil: null, reason: 'no_phone' };
    }
    if (channel === 'sms' && input.category.policyGroup === 'MARKETING') {
      return { channel, allowed: false, delayUntil: null, reason: 'no_marketing_sms' };
    }
    const sub = channelAllowedBySubscription(channel, input.category.policyGroup, input.hasInstantAlerts);
    if (!sub.allowed) {
      return { channel, allowed: false, delayUntil: null, reason: sub.digestInstead ? 'digest_instead' : 'plan_gated' };
    }
    if (quiet && channel !== 'in_app') {
      return { channel, allowed: true, delayUntil, reason: 'quiet_hours_delay' };
    }
    return { channel, allowed: true, delayUntil: null, reason: 'allowed' };
  });
}
