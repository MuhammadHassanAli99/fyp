import { Router, type Request, type RequestHandler } from 'express';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok, page } from '../../core/http/response';
import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { verifyWhatsAppSignature, verifyWhatsAppSubscription } from '../../providers/messaging';
import { normaliseWhatsAppWebhook } from './support.whatsapp-webhook';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { writeRateLimit } from '../../middleware/rate-limit';
import { paginationSchema } from '../../core/http/pagination';
import {
  addAttachment,
  agentReply,
  assignTicket,
  changeStatus,
  createTicket,
  getAgentTicket,
  getTicket,
  ingestCase,
  listAgentQueue,
  listCatalog,
  listMacros,
  listTickets,
  replyToTicket,
  setAgentPresence,
  submitFeedback,
} from './support.tickets';
import {
  getArticle,
  listFaqs,
  listKbCategories,
  recordArticleFeedback,
  searchKnowledge,
} from './support.kb';
import {
  ingestContactForm,
  ingestEmail,
  ingestPhone,
  ingestWhatsApp,
  openSupportConversation,
  verifySupportWebhook,
} from './support.channels';
import {
  createPost,
  createTopic,
  getTopic,
  listForumCategories,
  listTopics,
  reportPost,
  searchForum,
  vote,
} from './support.forum';
import { agentSearch, supportOverview, upsertCategory } from './support.analytics';
import { isSupportAgent, writeSupportAudit } from './support.authz';
import {
  agentPresenceSchema,
  agentSearchQuerySchema,
  agentTicketQuerySchema,
  assignSchema,
  attachmentSchema,
  categoryUpsertSchema,
  changeStatusSchema,
  contactSchema,
  createPostSchema,
  createTicketSchema,
  createTopicSchema,
  emailWebhookSchema,
  forumListQuerySchema,
  forumReportSchema,
  forumVoteSchema,
  idParam,
  internalNoteSchema,
  kbFeedbackSchema,
  kbListQuerySchema,
  liveChatSchema,
  phoneWebhookSchema,
  replyTicketSchema,
  slugParam,
  ticketFeedbackSchema,
  ticketListQuerySchema,
  uuidParam,
  whatsappWebhookSchema,
} from './support.schema';

const log = loggerFor('support.routes');

export const supportRouter = Router();

supportRouter.use(authenticate);

const requireAgent: RequestHandler = (req, res, next) => {
  if (!req.auth) return requireAuth(req, res, next);
  if (!isSupportAgent(req.auth)) {
    return requirePermission('ticket.view_any', 'ticket.manage')(req, res, next);
  }
  next();
};

const webhookGuard: RequestHandler = (req, _res, next) => {
  try {
    verifySupportWebhook(JSON.stringify(req.body ?? {}), String(req.header('x-support-signature') ?? req.header('x-hub-signature-256') ?? ''));
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Verifies Meta's `X-Hub-Signature-256` over the exact bytes received.
 *
 * `rawBody` is captured in app.ts before JSON parsing. If it is absent the
 * request did not go through that path, and in production we refuse rather than
 * fall back to a signature check that cannot succeed.
 */
const whatsappWebhookGuard: RequestHandler = (req, res, next) => {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;

  if (env.WHATSAPP_APP_SECRET) {
    if (!raw) {
      log.error('whatsapp webhook received without a raw body; cannot verify signature');
      res.status(500).json({ success: false, error: { code: 'CONFIGURATION_ERROR', message: 'Cannot verify webhook' } });
      return;
    }
    if (!verifyWhatsAppSignature(raw, req.header('x-hub-signature-256'))) {
      log.warn('whatsapp webhook signature rejected');
      res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Invalid signature' } });
      return;
    }
    next();
    return;
  }

  // No Meta app secret configured: fall back to the shared support secret so a
  // relay integration keeps working. verifySupportWebhook refuses unsigned
  // requests in production.
  webhookGuard(req, res, next);
};

/* Public catalogue / knowledge ------------------------------------------------ */

supportRouter.get(
  '/catalog',
  asyncHandler(async (req, res) => ok(res, await listCatalog(req.context.language))),
);

supportRouter.get(
  '/kb/categories',
  asyncHandler(async (req, res) => ok(res, await listKbCategories(query<{ marketplaceCode?: string }>(req).marketplaceCode))),
);

supportRouter.get(
  '/kb',
  validate({ query: kbListQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<{
      q?: string;
      categoryCode?: string;
      marketplaceCode?: string;
      language?: string;
      page: number;
      perPage: number;
    }>(req);
    return page(res, await searchKnowledge({ ...q, staff: Boolean(req.auth && isSupportAgent(req.auth)) }));
  }),
);

supportRouter.get(
  '/kb/:slug',
  validate({ params: slugParam }),
  asyncHandler(async (req, res) =>
    ok(res, await getArticle(params<{ slug: string }>(req).slug, req.auth?.userId ?? null, Boolean(req.auth && isSupportAgent(req.auth)))),
  ),
);

supportRouter.post(
  '/kb/:slug/feedback',
  writeRateLimit,
  validate({ params: slugParam, body: kbFeedbackSchema }),
  asyncHandler(async (req, res) => {
    const { slug } = params<{ slug: string }>(req);
    const input = body<{ helpful: boolean; comment?: string }>(req);
    return ok(
      res,
      await recordArticleFeedback(slug, {
        userId: req.auth?.userId ?? null,
        guestUuid: req.guestUuid,
        helpful: input.helpful,
        comment: input.comment,
      }),
    );
  }),
);

supportRouter.get(
  '/faqs',
  asyncHandler(async (req, res) =>
    ok(
      res,
      await listFaqs({
        marketplaceCode: typeof req.query.marketplaceCode === 'string' ? req.query.marketplaceCode : undefined,
        language: req.context.language,
        categoryCode: typeof req.query.categoryCode === 'string' ? req.query.categoryCode : undefined,
      }),
    ),
  ),
);

/* Guest contact -------------------------------------------------------------- */

supportRouter.post(
  '/contact',
  writeRateLimit,
  validate({ body: contactSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{ name: string; email: string; phone?: string; subject?: string; message: string; source?: string }>(req);
    return created(res, await ingestContactForm({ ...input, countryId: req.context.countryId }));
  }),
);

/* Customer tickets ----------------------------------------------------------- */

supportRouter.get(
  '/tickets',
  requireAuth,
  validate({ query: ticketListQuerySchema }),
  asyncHandler(async (req, res) => page(res, await listTickets(req.auth!.userId, query(req)))),
);

supportRouter.post(
  '/tickets',
  requireAuth,
  writeRateLimit,
  validate({ body: createTicketSchema }),
  asyncHandler(async (req, res) => {
    const input = body<Parameters<typeof createTicket>[1]>(req);
    return created(
      res,
      await ingestCase(req.auth!.userId, {
        ...input,
        language: input.language ?? req.context.language,
        countryId: input.countryId ?? req.context.countryId,
        channel: input.channel ?? 'in_app',
      }),
    );
  }),
);

supportRouter.get(
  '/tickets/:uuid',
  requireAuth,
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    if (req.auth && isSupportAgent(req.auth)) return ok(res, await getAgentTicket(req.auth, uuid));
    return ok(res, await getTicket(req.auth!.userId, uuid));
  }),
);

supportRouter.post(
  '/tickets/:uuid/reply',
  requireAuth,
  writeRateLimit,
  validate({ params: uuidParam, body: replyTicketSchema }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const input = body<{ body: string; channel?: 'in_app' }>(req);
    if (req.auth && isSupportAgent(req.auth)) {
      return ok(res, await agentReply(req.auth, uuid, input.body, false));
    }
    return ok(res, await replyToTicket(req.auth!.userId, uuid, input.body, input.channel));
  }),
);

supportRouter.post(
  '/tickets/:uuid/attachments',
  requireAuth,
  writeRateLimit,
  validate({ params: uuidParam, body: attachmentSchema }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    return created(res, await addAttachment(req.auth!.userId, uuid, body(req), isSupportAgent(req.auth)));
  }),
);

supportRouter.post(
  '/tickets/:uuid/feedback',
  requireAuth,
  writeRateLimit,
  validate({ params: uuidParam, body: ticketFeedbackSchema }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const input = body<{ rating: number; comment?: string }>(req);
    return ok(res, await submitFeedback(req.auth!.userId, uuid, input.rating, input.comment));
  }),
);

supportRouter.post(
  '/tickets/:uuid/status',
  requireAuth,
  writeRateLimit,
  validate({ params: uuidParam, body: changeStatusSchema }),
  asyncHandler(async (req, res) => {
    const { uuid } = params<{ uuid: string }>(req);
    const input = body<{ status: string; reason?: string }>(req);
    return ok(res, await changeStatus(req.auth!, uuid, input.status, input.reason));
  }),
);

supportRouter.post(
  '/chat',
  requireAuth,
  writeRateLimit,
  validate({ body: liveChatSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{ subject?: string; message?: string; ticketUuid?: string; listingId?: number }>(req);
    return created(
      res,
      await openSupportConversation({
        userId: req.auth!.userId,
        subject: input.subject,
        message: input.message,
        ticketUuid: input.ticketUuid,
        marketplaceId: req.marketplaceId,
        listingId: input.listingId,
      }),
    );
  }),
);

/* Agent workspace ------------------------------------------------------------ */

supportRouter.get(
  '/agent/queue',
  requireAuth,
  requireAgent,
  validate({ query: agentTicketQuerySchema }),
  asyncHandler(async (req, res) => page(res, await listAgentQueue(req.auth!, query(req)))),
);

supportRouter.get(
  '/agent/tickets/:uuid',
  requireAuth,
  requireAgent,
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => ok(res, await getAgentTicket(req.auth!, params<{ uuid: string }>(req).uuid))),
);

supportRouter.post(
  '/agent/tickets/:uuid/assign',
  requireAuth,
  requireAgent,
  writeRateLimit,
  validate({ params: uuidParam, body: assignSchema }),
  asyncHandler(async (req, res) => ok(res, await assignTicket(req.auth!, params<{ uuid: string }>(req).uuid, body(req)))),
);

supportRouter.post(
  '/agent/tickets/:uuid/note',
  requireAuth,
  requireAgent,
  writeRateLimit,
  validate({ params: uuidParam, body: internalNoteSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await agentReply(req.auth!, params<{ uuid: string }>(req).uuid, body<{ body: string }>(req).body, true)),
  ),
);

supportRouter.get(
  '/agent/search',
  requireAuth,
  requireAgent,
  validate({ query: agentSearchQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<{ q: string; kind?: string }>(req);
    return ok(res, await agentSearch(req.auth!, q.q, q.kind ?? 'auto'));
  }),
);

supportRouter.get(
  '/agent/macros',
  requireAuth,
  requireAgent,
  asyncHandler(async (req, res) => ok(res, await listMacros(req.context.language))),
);

supportRouter.post(
  '/agent/presence',
  requireAuth,
  requireAgent,
  validate({ body: agentPresenceSchema }),
  asyncHandler(async (req, res) => ok(res, await setAgentPresence(req.auth!.userId, body<{ status: 'available' | 'busy' | 'away' | 'offline' }>(req).status))),
);

supportRouter.get(
  '/analytics',
  requireAuth,
  requireAgent,
  asyncHandler(async (req, res) => ok(res, await supportOverview(req.auth!))),
);

supportRouter.post(
  '/categories',
  requireAuth,
  requirePermission('ticket.manage'),
  writeRateLimit,
  validate({ body: categoryUpsertSchema }),
  asyncHandler(async (req, res) => {
    const result = await upsertCategory(body(req));
    await writeSupportAudit({ req, action: 'support.category.upsert', entityId: result.id, permission: 'ticket.manage', after: body(req) });
    return ok(res, result);
  }),
);

/* Community forum (not tickets) --------------------------------------------- */

supportRouter.get(
  '/forum/categories',
  asyncHandler(async (req, res) =>
    ok(res, await listForumCategories(typeof req.query.marketplaceCode === 'string' ? req.query.marketplaceCode : undefined)),
  ),
);

supportRouter.get(
  '/forum/topics',
  validate({ query: forumListQuerySchema }),
  asyncHandler(async (req, res) => page(res, await listTopics(query(req)))),
);

supportRouter.get(
  '/forum/search',
  validate({ query: paginationSchema.extend({ q: kbListQuerySchema.shape.q }) }),
  asyncHandler(async (req, res) => ok(res, await searchForum(String(query<{ q?: string }>(req).q ?? ''), 20))),
);

supportRouter.get(
  '/forum/topics/:slug',
  validate({ params: slugParam }),
  asyncHandler(async (req, res) => ok(res, await getTopic(params<{ slug: string }>(req).slug))),
);

supportRouter.post(
  '/forum/topics',
  requireAuth,
  writeRateLimit,
  validate({ body: createTopicSchema }),
  asyncHandler(async (req, res) => created(res, await createTopic(req.auth!.userId, body(req)))),
);

supportRouter.post(
  '/forum/topics/:slug/posts',
  requireAuth,
  writeRateLimit,
  validate({ params: slugParam, body: createPostSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{ body: string; parentId?: number }>(req);
    return created(res, await createPost(req.auth!.userId, params<{ slug: string }>(req).slug, input.body, input.parentId));
  }),
);

supportRouter.post(
  '/forum/posts/:id/vote',
  requireAuth,
  writeRateLimit,
  validate({ params: idParam, body: forumVoteSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await vote(req.auth!.userId, 'post', params<{ id: number }>(req).id, body<{ vote: 1 | -1 | 0 }>(req).vote)),
  ),
);

supportRouter.post(
  '/forum/posts/:id/report',
  requireAuth,
  writeRateLimit,
  validate({ params: idParam, body: forumReportSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{ reasonCode: string; description?: string }>(req);
    return created(res, await reportPost(req.auth!.userId, params<{ id: number }>(req).id, input.reasonCode, input.description));
  }),
);

/* Channel webhooks ---------------------------------------------------------- */

supportRouter.post(
  '/webhooks/email',
  webhookGuard,
  validate({ body: emailWebhookSchema }),
  asyncHandler(async (req, res) => acceptedOrCreated(res, await ingestEmail(body(req)))),
);

/**
 * Meta's subscription handshake. Meta issues this GET when the webhook is first
 * registered (and periodically afterwards) and expects `hub.challenge` echoed
 * back as plain text. Without it the webhook cannot be subscribed at all.
 *
 * Unauthenticated by necessity — possession of the verify token is the proof.
 */
supportRouter.get('/webhooks/whatsapp', (req, res) => {
  const challenge = verifyWhatsAppSubscription({
    mode: req.query['hub.mode'] as string | undefined,
    token: req.query['hub.verify_token'] as string | undefined,
    challenge: req.query['hub.challenge'] as string | undefined,
  });
  if (challenge === null) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Verification failed' } });
    return;
  }
  res.type('text/plain').send(challenge);
});

/**
 * Inbound WhatsApp messages and delivery receipts.
 *
 * Two deliberate differences from the other channel webhooks:
 *
 *  - The signature is checked against the raw request bytes. The shared
 *    `webhookGuard` re-serialises `req.body`, which cannot reproduce the bytes
 *    Meta signed, so HMAC verification there could never succeed.
 *  - Meta's payload is an account-level batch, not one message, so it is
 *    normalised before ingest. Meta retries any non-2xx, so a malformed batch
 *    is acknowledged rather than rejected — otherwise it redelivers forever.
 */
supportRouter.post(
  '/webhooks/whatsapp',
  whatsappWebhookGuard,
  asyncHandler(async (req, res) => {
    const batch = normaliseWhatsAppWebhook(req.body);

    if (batch.messages.length === 0) {
      return ok(res, { accepted: 0, statuses: batch.statuses.length });
    }

    const results = [];
    for (const message of batch.messages) {
      // One malformed message must not discard the rest of the batch.
      try {
        results.push(await ingestWhatsApp(message));
      } catch (error) {
        log.warn({ err: error, messageId: message.messageId }, 'whatsapp message ingest skipped');
      }
    }

    return ok(res, { accepted: results.length, statuses: batch.statuses.length, tickets: results });
  }),
);

supportRouter.post(
  '/webhooks/phone',
  webhookGuard,
  validate({ body: phoneWebhookSchema }),
  asyncHandler(async (req, res) => acceptedOrCreated(res, await ingestPhone(body(req)))),
);

function acceptedOrCreated(res: Parameters<typeof created>[0], data: { reused?: boolean } & Record<string, unknown>) {
  return data.reused ? ok(res, data) : created(res, data);
}
