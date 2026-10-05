import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { sanitizeUntrustedText, wrapUntrusted } from './ai.security';
import { throughGateway, idempotencyKey } from './ai.gateway';
import { orchestrate, getAiJob } from './ai.orchestrator';
import {
  acceptGeneratedContent,
  persistGeneratedContent,
  persistPriceRecommendation,
  persistSearchInterpretation,
  translateCached,
  validateGeneratedDescription,
  runMarketAnalysis,
  generateRecommendations,
  detectDuplicates,
  scoreSpamSignals,
  assessFraudSignals,
} from './ai.capabilities';
import { executeApprovedTool, inferSupportTools, publicToolCatalog } from './ai.tools';
import { findCardsByIds } from '../listings/listings.repository';
import type { Request } from 'express';

export { getAiJob, acceptGeneratedContent };

function marketplaceIdFromCode(code: string | null | undefined): number | null {
  if (code === 'gold') return 1;
  if (code === 'property') return 2;
  if (code === 'vehicles') return 3;
  return null;
}

export async function generateDescription(
  req: Request,
  input: {
    marketplaceCode: string;
    categoryName: string;
    title: string;
    language: string;
    currency: string;
    price: number | null;
    city: string | null;
    attributes: Record<string, unknown>;
    details: Record<string, unknown>;
    tone?: 'neutral' | 'enthusiastic' | 'professional' | 'concise';
    listingId?: number | null;
  },
) {
  const gated = await throughGateway(req, {
    task: 'description_generate',
    input: { title: input.title, categoryName: input.categoryName },
    entityType: input.listingId ? 'listing' : null,
    entityId: input.listingId ?? null,
    language: input.language,
    idempotencyKey: idempotencyKey(req.auth!.userId, 'description_generate', {
      title: input.title,
      category: input.categoryName,
      listingId: input.listingId ?? null,
    }),
    run: (driver) =>
      driver.generateDescription({
        ...input,
        title: sanitizeUntrustedText(input.title, 191),
      }),
  });
  if ('accepted' in gated) return gated;
  const check = validateGeneratedDescription(gated.result.description, input.attributes, input.details);
  if (!check.ok) {
    gated.result.description = gated.result.description
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => !check.invented.some((token) => sentence.includes(token)))
      .join(' ');
    gated.meta.explanation = 'Removed numbers that were not present in the listing facts.';
  }
  if (input.listingId) {
    await persistGeneratedContent({
      entityType: 'listing',
      entityId: input.listingId,
      kind: 'description',
      language: input.language,
      content: gated.result.description,
      model: gated.meta.model,
    });
  }
  return {
    ...gated.result,
    meta: gated.meta,
    disclaimer: 'Review this copy before publishing. AI must not invent specifications.',
  };
}

export async function recommendPrice(
  req: Request,
  input: {
    marketplaceCode: string;
    categoryId: number;
    categoryName: string;
    currency: string;
    countryId?: number | null;
    cityId?: number | null;
    attributes: Record<string, unknown>;
    details?: Record<string, unknown>;
    comparables: Array<{ id?: number; price: number | null; currency: string | null; title: string }>;
    listingId?: number | null;
  },
) {
  const gated = await throughGateway(req, {
    task: 'price_recommend',
    input: { categoryId: input.categoryId, comparableCount: input.comparables.length },
    run: (driver) =>
      driver.recommendPrice({
        marketplaceCode: input.marketplaceCode,
        categoryId: input.categoryId,
        categoryName: input.categoryName,
        currency: input.currency,
        countryId: input.countryId ?? null,
        cityId: input.cityId ?? null,
        attributes: input.attributes,
        details: input.details ?? {},
        comparables: input.comparables.map((item, index) => ({
          id: item.id ?? index + 1,
          price: item.price ?? 0,
          currency: item.currency ?? input.currency,
          createdAt: new Date().toISOString(),
        })),
      }),
  });
  if ('accepted' in gated) return gated;
  await persistPriceRecommendation({
    marketplaceId: marketplaceIdFromCode(input.marketplaceCode) ?? 1,
    listingId: input.listingId ?? null,
    userId: req.auth!.userId,
    categoryId: input.categoryId,
    currency: input.currency,
    recommended: gated.result.recommendedPrice,
    low: gated.result.priceLow,
    high: gated.result.priceHigh,
    confidence: gated.result.confidence,
    rationale: gated.result.rationale,
    comparables: input.comparables,
    model: gated.meta.model,
  });
  return {
    ...gated.result,
    meta: gated.meta,
    disclaimer: 'Suggested range from comparable listings. Not a guaranteed market price.',
  };
}

export async function translateText(req: Request, text: string, targetLanguage: string, sourceLanguage?: string) {
  const gated = await throughGateway(req, {
    task: 'translate',
    input: { targetLanguage, length: text.length },
    run: (driver) => translateCached(driver, text, targetLanguage, sourceLanguage),
  });
  if ('accepted' in gated) return gated;
  return { ...gated.result, meta: gated.meta };
}

export async function interpretSearch(
  req: Request,
  query: string,
  language: string,
  currency: string,
  countryCode: string,
  marketplaces: Array<{ id: number; code: string; name: string }>,
) {
  const gated = await throughGateway(req, {
    task: 'smart_search',
    input: { query },
    run: (driver) => driver.interpretSearch({ query: wrapUntrusted('search_query', query), language, currency, countryCode, marketplaces }),
  });
  if ('accepted' in gated) return gated;
  await persistSearchInterpretation({
    query,
    language,
    interpretation: gated.result as unknown as Record<string, unknown>,
    userId: req.auth?.userId,
  });
  return { ...gated.result, meta: gated.meta };
}

export async function queueImageEnhance(req: Request, mediaId: number) {
  return throughGateway(req, {
    task: 'image_enhance',
    async: true,
    entityType: 'media',
    entityId: mediaId,
    input: { mediaId },
    idempotencyKey: idempotencyKey(req.auth!.userId, 'image_enhance', { mediaId }),
    run: async () => ({ model: 'queued', latencyMs: 0 }),
  });
}

export async function marketAnalysis(
  req: Request,
  input: { marketplaceId: number; countryId: number; currency: string; period?: 'week' | 'month' },
) {
  const gated = await throughGateway(req, {
    task: 'market_analysis',
    input,
    run: async () => {
      const stats = await runMarketAnalysis(input);
      return { ...stats, model: 'stats-v1', confidence: 90, latencyMs: 0 };
    },
  });
  if ('accepted' in gated) return gated;
  return { ...gated.result, meta: gated.meta };
}

export async function recommendations(req: Request, marketplaceId?: number | null) {
  const gated = await throughGateway(req, {
    task: 'recommend',
    input: { marketplaceId: marketplaceId ?? null },
    run: async () => {
      const slate = await generateRecommendations({
        userId: req.auth!.userId,
        marketplaceId: marketplaceId ?? null,
      });
      const cards = await findCardsByIds(slate.listingIds.slice(0, 8), req.context?.language ?? 'en');
      return { ...slate, cards, model: 'rec-v1', confidence: 60, latencyMs: 0 };
    },
  });
  if ('accepted' in gated) return gated;
  return { ...gated.result, meta: gated.meta };
}

export async function duplicateCheck(req: Request, listingId: number) {
  const gated = await throughGateway(req, {
    task: 'duplicate_detect',
    entityType: 'listing',
    entityId: listingId,
    privacy: 'strict',
    input: { listingId },
    run: async () => {
      const result = await detectDuplicates(listingId);
      return { ...result, model: 'duplicate-v2', latencyMs: 0 };
    },
  });
  if ('accepted' in gated) return gated;
  return { ...gated.result, meta: gated.meta };
}

export async function spamCheck(req: Request, text: string) {
  const gated = await throughGateway(req, {
    task: 'spam_detect',
    privacy: 'strict',
    input: { length: text.length },
    run: async () => {
      const result = await scoreSpamSignals(text);
      return { ...result, model: 'spam-rules-v1', latencyMs: 0 };
    },
  });
  if ('accepted' in gated) return gated;
  return { ...gated.result, meta: gated.meta };
}

export async function fraudCheck(req: Request, listingId?: number) {
  const gated = await throughGateway(req, {
    task: 'fraud_detect',
    privacy: 'strict',
    entityType: listingId ? 'listing' : 'user',
    entityId: listingId ?? req.auth!.userId,
    input: { listingId: listingId ?? null },
    run: async () => {
      const result = await assessFraudSignals({ userId: req.auth!.userId, listingId: listingId ?? null });
      return { ...result, model: 'fraud-signals-v1', latencyMs: 0 };
    },
  });
  if ('accepted' in gated) return gated;
  return {
    ...gated.result,
    meta: gated.meta,
    disclaimer: 'AI is not the sole authority for bans, holds or irreversible fraud actions.',
  };
}

export async function supportTurn(
  req: Request,
  input: { message: string; sessionUuid?: string | null; confirmTool?: boolean },
) {
  const userId = req.auth!.userId;
  let session = input.sessionUuid
    ? await queryOne<Row>('SELECT id, uuid FROM chatbot_sessions WHERE uuid = ? AND user_id = ?', [input.sessionUuid, userId])
    : null;
  if (!session) {
    const sessionUuid = uuid();
    const id = await insertAndGetId(
      `INSERT INTO chatbot_sessions (uuid, user_id, language, channel, status)
       VALUES (?, ?, ?, 'in_app', 'active')`,
      [sessionUuid, userId, req.context.language],
    );
    session = { id, uuid: sessionUuid } as Row;
  }

  await execute(
    `INSERT INTO chatbot_messages (session_id, role, content) VALUES (?, 'user', ?)`,
    [session.id, input.message],
  );

  const { detectSensitiveIntent, AI_CONFIDENCE_THRESHOLD } = await import('../support/support.types');
  const { retrieveForAi, scoreKnowledgeOverlap } = await import('../support/support.kb');
  const sensitive = detectSensitiveIntent(input.message);

  const inferred = inferSupportTools(input.message);
  const toolResults: Array<{ name: string; result: unknown }> = [];
  if (!sensitive) {
    for (const call of inferred) {
      try {
        const result = await executeApprovedTool({
          name: call.name,
          args: { ...call.args, confirm: input.confirmTool === true },
          userId,
          language: req.context.language,
          currency: req.context.currency,
          confirmed: input.confirmTool,
        });
        toolResults.push({ name: call.name, result });
        await execute(
          `INSERT INTO chatbot_messages (session_id, role, tool_name, tool_payload) VALUES (?, 'tool', ?, ?)`,
          [session.id, call.name, JSON.stringify(result)],
        );
      } catch (error) {
        toolResults.push({ name: call.name, result: { error: error instanceof Error ? error.message : String(error) } });
      }
    }
  }

  const kb = await retrieveForAi({
    question: input.message,
    language: req.context.language,
    marketplaceCode: req.marketplaceCode ?? undefined,
    limit: 8,
  });
  const bestOverlap = kb.reduce(
    (max, article) => Math.max(max, scoreKnowledgeOverlap(input.message, article.title, article.excerpt)),
    0,
  );
  const grounded = bestOverlap >= AI_CONFIDENCE_THRESHOLD && kb.length > 0;
  const shouldForceEscalate = Boolean(sensitive) || !grounded;

  const gated = await throughGateway(req, {
    task: 'chat_support',
    input: { length: input.message.length, tools: inferred.map((item) => item.name), sensitive: sensitive ?? null },
    run: (driver) =>
      driver.chat({
        messages: [{ role: 'user', content: wrapUntrusted('support_message', input.message) }],
        language: req.context.language,
        knowledgeBase: kb.map((row) => ({
          id: row.id,
          title: row.title,
          excerpt: row.excerpt,
        })),
        userContext: {
          tools: toolResults,
          sensitiveIntent: sensitive,
          grounded,
          policy: 'Answer only from supplied help articles. Never invent policies, refunds, or account changes.',
        },
      }),
  });
  if ('accepted' in gated) return gated;

  let ticketUuid: string | null = null;
  const escalate = shouldForceEscalate || gated.result.shouldEscalate;
  if (escalate) {
    const { ingestCase } = await import('../support/support.service');
    const ticket = await ingestCase(userId, {
      subject: (input.message.slice(0, 80) || 'Support request'),
      description: input.message,
      channel: 'chatbot',
      threadKey: `chatbot:${String(session.uuid)}`,
      categoryCode: sensitive === 'fraud' || sensitive === 'account_takeover' ? 'fraud' : sensitive === 'kyc' || sensitive === 'aml' ? 'kyc' : sensitive?.includes('payment') || sensitive === 'refund_dispute' ? 'payments' : 'general',
      tags: { chatbotSessionId: Number(session.id), intent: sensitive },
      reuseOpen: true,
    });
    ticketUuid = ticket.uuid ?? null;
    await execute('UPDATE chatbot_sessions SET status = ?, escalated_ticket_id = ? WHERE id = ?', [
      'escalated',
      ticket.id ?? null,
      session.id,
    ]).catch(() => undefined);
  }

  const reply = escalate && sensitive
    ? 'This needs a verified human specialist (payments, identity, fraud, or legal). I opened a support case and will not change your account or issue a refund from chat.'
    : escalate && !grounded
      ? 'I could not find an approved help article that answers this with enough confidence, so I am not going to guess. A colleague will continue on your ticket.'
      : gated.result.reply;

  await execute(
    `INSERT INTO chatbot_messages (session_id, role, content, citations, latency_ms)
     VALUES (?, 'assistant', ?, ?, ?)`,
    [session.id, reply, JSON.stringify(gated.result.citations ?? kb.map((row) => row.id)), gated.meta.latencyMs],
  );
  await execute(
    'UPDATE chatbot_sessions SET message_count = message_count + 2, topic = ? WHERE id = ?',
    [gated.result.detectedTopic ?? sensitive, session.id],
  );

  return {
    sessionUuid: String(session.uuid),
    reply,
    citations: gated.result.citations,
    shouldEscalate: escalate,
    ticketUuid,
    confidence: bestOverlap,
    grounded,
    tools: publicToolCatalog(),
    toolResults,
    meta: gated.meta,
  };
}

export async function submitAiFeedback(params: {
  userId: number;
  jobUuid?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  feedback: 'helpful' | 'not_helpful' | 'inaccurate' | 'offensive' | 'report';
  comment?: string | null;
}) {
  let jobId: number | null = null;
  if (params.jobUuid) {
    const job = await queryOne<Row>('SELECT id FROM ai_jobs WHERE uuid = ?', [params.jobUuid]);
    jobId = job ? Number(job.id) : null;
  }
  const id = await insertAndGetId(
    `INSERT INTO ai_feedback (job_id, entity_type, entity_id, user_id, feedback, comment)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [jobId, params.entityType ?? null, params.entityId ?? null, params.userId, params.feedback, params.comment ?? null],
  );
  return { id };
}

export async function overrideAiDecision(params: {
  reviewerId: number;
  jobUuid: string;
  decision: string;
  reason: string;
}) {
  const job = await queryOne<Row>('SELECT id FROM ai_jobs WHERE uuid = ?', [params.jobUuid]);
  if (!job) {
    const { notFound } = await import('../../core/errors');
    throw notFound('AI job');
  }
  await execute(
    `UPDATE ai_jobs
        SET decision = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_reason = ?
      WHERE id = ?`,
    [params.decision, params.reviewerId, params.reason.slice(0, 255), job.id],
  );
  return { overridden: true, jobUuid: params.jobUuid, decision: params.decision };
}

export async function aiUsageReport(period: 'today' | 'month') {
  const since = period === 'today' ? 'CURRENT_DATE' : 'DATE_FORMAT(CURRENT_DATE, \'%Y-%m-01\')';
  const [totals] = await Promise.all([
    queryOne<Row>(
      `SELECT COUNT(*) AS requests,
              SUM(status = 'succeeded') AS succeeded,
              SUM(status = 'failed') AS failed,
              SUM(COALESCE(cost,0)) AS cost,
              AVG(latency_ms) AS avg_latency,
              SUM(cache_hit = 1) AS cache_hits
         FROM ai_jobs WHERE created_at >= ${since}`,
    ),
  ]);
  const byFeature = await queryRows<Row>(
    `SELECT task, COUNT(*) AS requests, SUM(COALESCE(cost,0)) AS cost, AVG(confidence) AS avg_confidence
       FROM ai_jobs WHERE created_at >= ${since} GROUP BY task ORDER BY requests DESC`,
  );
  const byModel = await queryRows<Row>(
    `SELECT COALESCE(model,'unknown') AS model, COALESCE(provider_code,'unknown') AS provider,
            COUNT(*) AS requests, SUM(COALESCE(cost,0)) AS cost
       FROM ai_jobs WHERE created_at >= ${since} GROUP BY model, provider_code ORDER BY requests DESC LIMIT 20`,
  );
  const byUser = await queryRows<Row>(
    `SELECT user_id, COUNT(*) AS requests, SUM(COALESCE(cost,0)) AS cost
       FROM ai_jobs WHERE created_at >= ${since} AND user_id IS NOT NULL
       GROUP BY user_id ORDER BY cost DESC LIMIT 20`,
  );
  const byMarketplace = await queryRows<Row>(
    `SELECT marketplace_id, COUNT(*) AS requests, SUM(COALESCE(cost,0)) AS cost
       FROM ai_jobs WHERE created_at >= ${since} GROUP BY marketplace_id`,
  );
  return {
    period,
    totals: {
      requests: Number(totals?.requests ?? 0),
      succeeded: Number(totals?.succeeded ?? 0),
      failed: Number(totals?.failed ?? 0),
      cost: Number(totals?.cost ?? 0),
      avgLatencyMs: Number(totals?.avg_latency ?? 0),
      cacheHits: Number(totals?.cache_hits ?? 0),
    },
    byFeature,
    byModel,
    byUser,
    byMarketplace,
  };
}

/** System path (no quota) used by search embed / screening. */
export { orchestrate };
