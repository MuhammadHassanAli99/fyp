import { z } from 'zod';
import { paginationSchema } from '../../core/http/pagination';
import { CHANNELS, PUBLIC_PRIORITIES, PUBLIC_TICKET_STATUSES, RELATED_ENTITY_TYPES } from './support.types';

const uuid = z.string().uuid();
const optionalPositive = z.coerce.number().int().positive().optional();

export const relatedContextSchema = z.object({
  marketplaceCode: z.enum(['gold', 'property', 'vehicles']).optional(),
  marketplaceId: optionalPositive,
  categoryCode: z.string().trim().max(64).optional(),
  categoryId: optionalPositive,
  relatedEntityType: z.enum(RELATED_ENTITY_TYPES).optional(),
  relatedEntityId: optionalPositive,
  relatedEntityUuid: uuid.optional(),
  listingId: optionalPositive,
  listingUuid: uuid.optional(),
  paymentId: optionalPositive,
  paymentUuid: uuid.optional(),
  orderId: optionalPositive,
  orderUuid: uuid.optional(),
  subscriptionId: optionalPositive,
  conversationUuid: uuid.optional(),
  vehicleVin: z.string().trim().max(32).optional(),
  propertyId: optionalPositive,
  goldListingId: optionalPositive,
  language: z.string().trim().max(10).optional(),
  countryId: optionalPositive,
});

export type RelatedContextInput = z.infer<typeof relatedContextSchema>;

export const createTicketSchema = z
  .object({
    subject: z.string().trim().min(3).max(255),
    description: z.string().trim().max(8000).optional(),
    categoryId: optionalPositive,
    categoryCode: z.string().trim().max(64).optional(),
    marketplaceId: optionalPositive,
    marketplaceCode: z.enum(['gold', 'property', 'vehicles']).optional(),
    priority: z.enum(PUBLIC_PRIORITIES).or(z.enum(['low', 'normal', 'high', 'urgent'])).optional(),
    channel: z.enum(CHANNELS).optional(),
    guestEmail: z.string().email().max(191).optional(),
    guestName: z.string().trim().max(128).optional(),
  })
  .merge(relatedContextSchema);

export const replyTicketSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  channel: z.enum(CHANNELS).optional(),
});

export const ticketFeedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

export const attachmentSchema = z.object({
  fileUrl: z.string().url().max(512),
  fileName: z.string().trim().max(191).optional(),
  mimeType: z.string().trim().max(96).optional(),
  sizeBytes: z.coerce.number().int().positive().max(25 * 1024 * 1024).optional(),
});

export const ticketListQuerySchema = paginationSchema.extend({
  status: z.string().trim().max(32).optional(),
  priority: z.string().trim().max(16).optional(),
  marketplaceId: optionalPositive,
  categoryId: optionalPositive,
});

export const agentTicketQuerySchema = paginationSchema.extend({
  status: z.string().trim().max(32).optional(),
  priority: z.string().trim().max(16).optional(),
  department: z.string().trim().max(64).optional(),
  assignedTo: z.union([z.literal('me'), z.literal('unassigned'), z.coerce.number().int().positive()]).optional(),
  marketplaceId: optionalPositive,
  countryId: optionalPositive,
  q: z.string().trim().max(200).optional(),
});

export const changeStatusSchema = z.object({
  status: z.enum(PUBLIC_TICKET_STATUSES).or(
    z.enum(['new', 'open', 'pending_customer', 'pending_internal', 'on_hold', 'resolved', 'closed', 'reopened']),
  ),
  reason: z.string().trim().max(500).optional(),
});

export const assignSchema = z.object({
  assignedTo: z.coerce.number().int().positive().optional(),
  assignedTeam: z.string().trim().max(64).optional(),
  status: z.string().trim().max(32).optional(),
  priority: z.string().trim().max(16).optional(),
  note: z.string().trim().max(5000).optional(),
});

export const internalNoteSchema = z.object({
  body: z.string().trim().min(1).max(8000),
});

export const agentSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  kind: z
    .enum([
      'auto',
      'ticket',
      'user',
      'email',
      'phone',
      'listing',
      'payment',
      'order',
      'subscription',
      'vin',
      'property',
      'gold',
      'conversation',
    ])
    .optional(),
});

export const liveChatSchema = relatedContextSchema.extend({
  subject: z.string().trim().min(3).max(255).optional(),
  message: z.string().trim().max(4000).optional(),
  ticketUuid: uuid.optional(),
});

export const kbListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(200).optional(),
  categoryCode: z.string().trim().max(64).optional(),
  marketplaceCode: z.enum(['gold', 'property', 'vehicles']).optional(),
  language: z.string().trim().max(10).optional(),
});

export const kbFeedbackSchema = z.object({
  helpful: z.boolean(),
  comment: z.string().trim().max(500).optional(),
});

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(128),
  email: z.string().email().max(191),
  phone: z.string().trim().max(24).optional(),
  subject: z.string().trim().max(255).optional(),
  message: z.string().trim().min(10).max(8000),
  source: z.string().trim().max(48).optional(),
});

export const forumListQuerySchema = paginationSchema.extend({
  categoryCode: z.string().trim().max(64).optional(),
  marketplaceCode: z.enum(['gold', 'property', 'vehicles']).optional(),
  q: z.string().trim().max(200).optional(),
});

export const createTopicSchema = z.object({
  categoryCode: z.string().trim().min(2).max(64),
  title: z.string().trim().min(5).max(255),
  body: z.string().trim().min(10).max(20000),
  kind: z.enum(['discussion', 'question', 'poll', 'announcement']).optional(),
  language: z.string().trim().max(10).optional(),
});

export const createPostSchema = z.object({
  body: z.string().trim().min(1).max(20000),
  parentId: z.coerce.number().int().positive().optional(),
});

export const forumVoteSchema = z.object({
  vote: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
});

export const forumReportSchema = z.object({
  reasonCode: z.enum(['spam', 'fraud', 'scam', 'offensive', 'harassment', 'duplicate', 'other']).default('other'),
  description: z.string().trim().max(1000).optional(),
});

export const emailWebhookSchema = z.object({
  from: z.string().trim().min(3).max(191),
  to: z.string().trim().max(191).optional(),
  subject: z.string().trim().max(255).default('Email support'),
  text: z.string().trim().max(20000).optional(),
  html: z.string().trim().max(40000).optional(),
  messageId: z.string().trim().max(191).optional(),
  inReplyTo: z.string().trim().max(191).optional(),
  attachments: z.array(attachmentSchema).max(8).optional(),
});

export const whatsappWebhookSchema = z.object({
  from: z.string().trim().min(5).max(32),
  text: z.string().trim().max(4000).optional(),
  mediaUrl: z.string().url().max(512).optional(),
  messageId: z.string().trim().max(191).optional(),
  profileName: z.string().trim().max(128).optional(),
});

export const phoneWebhookSchema = z.object({
  callId: z.string().trim().min(4).max(128),
  from: z.string().trim().max(32).optional(),
  to: z.string().trim().max(32).optional(),
  agentId: optionalPositive,
  durationSeconds: z.coerce.number().int().min(0).max(86400).optional(),
  outcome: z.enum(['answered', 'missed', 'voicemail', 'busy', 'failed']).optional(),
  recordingUrl: z.string().url().max(512).optional(),
  consent: z.boolean().optional(),
  ticketUuid: uuid.optional(),
  notes: z.string().trim().max(4000).optional(),
});

export const categoryUpsertSchema = z.object({
  code: z.string().trim().min(2).max(64),
  name: z.string().trim().min(2).max(128),
  description: z.string().trim().max(500).optional(),
  parentId: optionalPositive.nullable(),
  marketplaceId: optionalPositive.nullable(),
  defaultPriority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  slaFirstResponseMinutes: z.coerce.number().int().positive().max(10080).optional().nullable(),
  slaResolutionMinutes: z.coerce.number().int().positive().max(43200).optional().nullable(),
  autoAssignTeam: z.string().trim().max(64).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const agentPresenceSchema = z.object({
  status: z.enum(['available', 'busy', 'away', 'offline']),
});

export const uuidParam = z.object({ uuid: uuid });
export const slugParam = z.object({ slug: z.string().trim().min(1).max(220) });
export const idParam = z.object({ id: z.coerce.number().int().positive() });
