/**
 * One Customer Support platform across Gold, Property, Vehicles, Payments,
 * Subscriptions, Fraud, KYC, Listings, and Accounts.
 *
 * Database ENUMs stay as 018 defined them. Public API names follow the
 * architecture spec; this module is the only place that maps between them.
 * Do not add a second mapping in admin or AI.
 */

export const DB_TICKET_STATUSES = [
  'new',
  'open',
  'pending_customer',
  'pending_internal',
  'on_hold',
  'resolved',
  'closed',
  'reopened',
] as const;
export type DbTicketStatus = (typeof DB_TICKET_STATUSES)[number];

/** Spec-facing states. ASSIGNED / IN_PROGRESS are derived from open + assignment. */
export const PUBLIC_TICKET_STATUSES = [
  'NEW',
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_FOR_CUSTOMER',
  'WAITING_INTERNAL',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
] as const;
export type PublicTicketStatus = (typeof PUBLIC_TICKET_STATUSES)[number];

export const DB_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type DbPriority = (typeof DB_PRIORITIES)[number];

export const PUBLIC_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT', 'CRITICAL'] as const;
export type PublicPriority = (typeof PUBLIC_PRIORITIES)[number];

export const CHANNELS = [
  'in_app',
  'email',
  'phone',
  'whatsapp',
  'live_chat',
  'chatbot',
  'social',
  'web_form',
] as const;
export type SupportChannel = (typeof CHANNELS)[number];

export const AUTHOR_KINDS = ['customer', 'agent', 'system', 'ai'] as const;
export type AuthorKind = (typeof AUTHOR_KINDS)[number];

export const RELATED_ENTITY_TYPES = [
  'listing',
  'payment',
  'transaction',
  'subscription',
  'order',
  'vehicle',
  'property',
  'gold_listing',
  'conversation',
  'user',
  'kyc',
  'fraud_case',
  'review',
  'advertisement',
  'account',
] as const;
export type RelatedEntityType = (typeof RELATED_ENTITY_TYPES)[number];

/** Configurable department codes. Stored on categories.auto_assign_team / tickets.assigned_team. */
export const DEFAULT_DEPARTMENTS = [
  'general',
  'billing',
  'payments',
  'subscriptions',
  'gold',
  'property',
  'vehicles',
  'vehicle_parts',
  'kyc',
  'fraud',
  'trust_safety',
  'technical',
  'accounts',
  'seller',
  'dealer',
  'agency',
  'advertising',
  'legal',
] as const;
export type DepartmentCode = (typeof DEFAULT_DEPARTMENTS)[number];

export const SENSITIVE_INTENTS = [
  'payment_dispute',
  'account_takeover',
  'fraud',
  'kyc',
  'aml',
  'legal',
  'transaction_dispute',
  'security_incident',
  'refund_dispute',
  'sensitive_account_change',
] as const;
export type SensitiveIntent = (typeof SENSITIVE_INTENTS)[number];

export const SENSITIVE_DEPARTMENTS = new Set<string>([
  'billing',
  'payments',
  'kyc',
  'fraud',
  'trust_safety',
  'legal',
  'accounts',
]);

const SENSITIVE_PATTERNS: Array<{ intent: SensitiveIntent; pattern: RegExp }> = [
  { intent: 'refund_dispute', pattern: /\b(refund|chargeback|money back|return my (money|payment))\b/i },
  { intent: 'account_takeover', pattern: /\b((my )?account.{0,16}(hacked|stolen|takeover)|someone (else )?logged in|not me who (signed|logged))\b/i },
  { intent: 'fraud', pattern: /\b(fraud|scam|phishing|fake (gold|listing|seller)|stolen)\b/i },
  { intent: 'kyc', pattern: /\b(kyc|identity (verif|document)|passport|national id)\b/i },
  { intent: 'aml', pattern: /\b(aml|money laundering|sanctions?|source of funds)\b/i },
  { intent: 'legal', pattern: /\b(lawyer|legal (action|notice)|lawsuit|gdpr|ccpa|court)\b/i },
  { intent: 'payment_dispute', pattern: /\b(payment (issue|failed|dispute)|charged twice|double charge|unauthorized charge)\b/i },
  { intent: 'transaction_dispute', pattern: /\b(transaction (dispute|error)|order (wrong|missing)|never (arrived|received))\b/i },
  { intent: 'security_incident', pattern: /\b(security (incident|breach)|data leak|compromised)\b/i },
  { intent: 'sensitive_account_change', pattern: /\b(change (email|phone|password)|delete (my )?account|close account)\b/i },
];

export function detectSensitiveIntent(text: string): SensitiveIntent | null {
  const sample = text.slice(0, 4000);
  for (const rule of SENSITIVE_PATTERNS) {
    if (rule.pattern.test(sample)) return rule.intent;
  }
  return null;
}

export function isSensitiveCategoryCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const normalized = code.toLowerCase();
  return SENSITIVE_DEPARTMENTS.has(normalized) || /fraud|kyc|aml|legal|payment|billing|account/.test(normalized);
}

export interface TicketStatusContext {
  status: string;
  assignedTo?: number | null;
  firstResponseAt?: Date | string | null;
}

export function toPublicStatus(ctx: TicketStatusContext): PublicTicketStatus {
  switch (ctx.status) {
    case 'new':
      return 'NEW';
    case 'open':
      if (ctx.assignedTo && ctx.firstResponseAt) return 'IN_PROGRESS';
      if (ctx.assignedTo) return 'ASSIGNED';
      return 'OPEN';
    case 'pending_customer':
      return 'WAITING_FOR_CUSTOMER';
    case 'pending_internal':
    case 'on_hold':
      return 'WAITING_INTERNAL';
    case 'resolved':
      return 'RESOLVED';
    case 'closed':
      return 'CLOSED';
    case 'reopened':
      return 'REOPENED';
    default:
      return 'OPEN';
  }
}

export function toDbStatus(publicStatus: string): DbTicketStatus {
  switch (publicStatus.toUpperCase()) {
    case 'NEW':
      return 'new';
    case 'OPEN':
    case 'ASSIGNED':
    case 'IN_PROGRESS':
      return 'open';
    case 'WAITING_FOR_CUSTOMER':
    case 'WAITING_USER':
      return 'pending_customer';
    case 'WAITING_INTERNAL':
      return 'pending_internal';
    case 'ON_HOLD':
      return 'on_hold';
    case 'RESOLVED':
      return 'resolved';
    case 'CLOSED':
      return 'closed';
    case 'REOPENED':
      return 'reopened';
    default: {
      const lower = publicStatus.toLowerCase();
      if ((DB_TICKET_STATUSES as readonly string[]).includes(lower)) return lower as DbTicketStatus;
      return 'open';
    }
  }
}

export function toPublicPriority(db: string, tags?: Record<string, unknown> | null): PublicPriority {
  if (tags?.severity === 'critical' || tags?.critical === true) return 'CRITICAL';
  switch (db) {
    case 'low':
      return 'LOW';
    case 'high':
      return 'HIGH';
    case 'urgent':
      return 'URGENT';
    default:
      return 'NORMAL';
  }
}

export function toDbPriority(publicPriority: string): { priority: DbPriority; critical: boolean } {
  switch (publicPriority.toUpperCase()) {
    case 'LOW':
      return { priority: 'low', critical: false };
    case 'HIGH':
      return { priority: 'high', critical: false };
    case 'URGENT':
      return { priority: 'urgent', critical: false };
    case 'CRITICAL':
      return { priority: 'urgent', critical: true };
    default:
      return { priority: 'normal', critical: false };
  }
}

/** Controlled transitions. Keys are DB statuses. */
export const STATUS_TRANSITIONS: Record<DbTicketStatus, DbTicketStatus[]> = {
  new: ['open', 'pending_customer', 'pending_internal', 'on_hold', 'resolved', 'closed'],
  open: ['pending_customer', 'pending_internal', 'on_hold', 'resolved', 'closed'],
  pending_customer: ['open', 'resolved', 'closed', 'reopened'],
  pending_internal: ['open', 'on_hold', 'resolved'],
  on_hold: ['open', 'pending_internal', 'resolved', 'closed'],
  resolved: ['closed', 'reopened'],
  closed: ['reopened'],
  reopened: ['open', 'pending_customer', 'pending_internal', 'resolved', 'closed'],
};

export function canTransition(from: string, to: string): boolean {
  const source = (DB_TICKET_STATUSES as readonly string[]).includes(from) ? (from as DbTicketStatus) : toDbStatus(from);
  const target = (DB_TICKET_STATUSES as readonly string[]).includes(to) ? (to as DbTicketStatus) : toDbStatus(to);
  if (source === target) return true;
  return STATUS_TRANSITIONS[source]?.includes(target) ?? false;
}

const PRIORITY_SLA_FACTOR: Record<DbPriority, number> = {
  low: 1.5,
  normal: 1,
  high: 0.75,
  urgent: 0.5,
};

export function slaMinutesFor(params: {
  baseMinutes: number | null | undefined;
  priority: DbPriority;
  critical?: boolean;
  hasPrioritySupport?: boolean;
  hasDedicatedSupport?: boolean;
}): number | null {
  if (!params.baseMinutes || params.baseMinutes <= 0) return null;
  let factor = PRIORITY_SLA_FACTOR[params.priority] ?? 1;
  if (params.critical) factor *= 0.5;
  if (params.hasDedicatedSupport) factor *= 0.5;
  else if (params.hasPrioritySupport) factor *= 0.7;
  return Math.max(15, Math.round(params.baseMinutes * factor));
}

export function parseTags(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function parseStringArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((item) => String(item));
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

export function ticketNumberFromSubject(subject: string): string | null {
  const match = subject.match(/\bSUP-\d{4}-[A-Z0-9]{4,12}\b/i);
  return match ? match[0]!.toUpperCase() : null;
}

export const AI_CONFIDENCE_THRESHOLD = 0.55;
export const KB_STAFF_VISIBILITY = 'staff';
