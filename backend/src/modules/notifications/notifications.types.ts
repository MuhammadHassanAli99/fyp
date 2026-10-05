export const NOTIFICATION_CHANNELS = ['push', 'sms', 'email', 'in_app', 'silent', 'whatsapp'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const MARKETPLACES = ['GOLD', 'PROPERTY', 'VEHICLE', 'GENERAL'] as const;
export type NotificationMarketplace = (typeof MARKETPLACES)[number];

export const POLICY_GROUPS = ['SECURITY', 'TRANSACTIONAL', 'MARKETPLACE', 'SOCIAL', 'MARKETING', 'SYSTEM'] as const;
export type PolicyGroup = (typeof POLICY_GROUPS)[number];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type StoredPriority = (typeof PRIORITIES)[number];

/** Spec priorities map onto the stored ENUM (urgent = CRITICAL). */
export type SpecPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

export const ACTION_TYPES = [
  'none',
  'listing',
  'chat',
  'offer',
  'subscription',
  'payment',
  'verification',
  'review',
  'ad',
  'support',
  'external',
  'auction',
  'call',
  'search',
  'security',
  'favorite',
  'system',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const INBOX_FILTERS = [
  'all',
  'unread',
  'gold',
  'property',
  'vehicles',
  'messages',
  'security',
  'payments',
  'system',
] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export function toStoredPriority(input?: SpecPriority | StoredPriority | string | null): StoredPriority {
  const value = (input ?? 'normal').toString().toLowerCase();
  if (value === 'critical' || value === 'urgent') return 'urgent';
  if (value === 'high') return 'high';
  if (value === 'low') return 'low';
  return 'normal';
}

export function marketplaceFromGroup(groupCode: string | null | undefined, explicit?: string | null): NotificationMarketplace {
  if (explicit) {
    const upper = explicit.toUpperCase();
    if (upper === 'GOLD' || upper === 'PROPERTY' || upper === 'VEHICLE' || upper === 'GENERAL') {
      return upper;
    }
    if (upper === 'VEHICLES') return 'VEHICLE';
  }
  const group = (groupCode ?? '').toLowerCase();
  if (group === 'gold') return 'GOLD';
  if (group === 'property') return 'PROPERTY';
  if (group === 'vehicles' || group === 'vehicle') return 'VEHICLE';
  return 'GENERAL';
}

export interface NotifyCommand {
  userId: number;
  categoryCode: string;
  eventType?: string;
  marketplace?: NotificationMarketplace | string;
  entityType?: string | null;
  entityId?: string | number | null;
  title?: string;
  body?: string;
  actionType?: ActionType;
  actionTarget?: string | null;
  deepLink?: string | null;
  data?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  priority?: SpecPriority | StoredPriority | string;
  groupKey?: string | null;
  imageUrl?: string | null;
  icon?: string | null;
  isSilent?: boolean;
  scheduledAt?: Date | string | null;
  expiresAt?: Date | string | null;
  eventId?: string | null;
  language?: string | null;
  skipChannels?: NotificationChannel[];
}

export interface RenderedCopy {
  subject: string | null;
  title: string;
  body: string;
  actionUrl: string | null;
  templateId: number | null;
  templateVersion: number | null;
  language: string;
}

export interface ChannelDecision {
  channel: NotificationChannel;
  allowed: boolean;
  delayUntil: Date | null;
  reason: string;
}

export interface UserNotificationContext {
  userId: number;
  language: string;
  timezone: string;
  email: string | null;
  phoneE164: string | null;
  planCode: string;
  planTier: number;
}

export const SUPPORTED_TEMPLATE_LANGUAGES = [
  'en',
  'ar',
  'ur',
  'hi',
  'fr',
  'de',
  'es',
  'zh',
  'ja',
  'tr',
  'ru',
] as const;
