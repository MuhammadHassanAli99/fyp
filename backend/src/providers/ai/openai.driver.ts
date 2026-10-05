import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { AppError, ErrorCode } from '../../core/errors';
import { HeuristicAiDriver } from './heuristic.driver';
import { SYSTEM_GUARDRAILS } from '../../modules/ai/ai.security';
import type {
  AiDriver,
  ChatRequest,
  ChatResult,
  CompareRequest,
  CompareResult,
  DescriptionRequest,
  DescriptionResult,
  EmbeddingRequest,
  EmbeddingResult,
  ModerationRequest,
  ModerationResult,
  PriceRequest,
  PriceResult,
  SearchInterpretation,
  SearchInterpretationRequest,
  TranslateRequest,
  TranslateResult,
} from './types';

const log = loggerFor('ai.openai');

/**
 * Driver for any OpenAI-compatible chat-completions endpoint (OpenAI, Azure
 * OpenAI, Together, Groq, vLLM, Ollama…). Only `AI_BASE_URL`, `AI_API_KEY` and
 * `AI_MODEL` change between them.
 *
 * Design notes that matter in production:
 *  - Every prompt demands strict JSON and is parsed defensively; a model that
 *    returns prose must not crash a request.
 *  - The heuristic driver computes the numeric groundwork (scores, medians)
 *    and the model is asked to *explain and judge*, not to do arithmetic. LLMs
 *    are unreliable at the former and good at the latter.
 *  - Requests are bounded by AI_TIMEOUT_MS so a hanging provider cannot pin a
 *    connection.
 */
export class OpenAiCompatibleDriver implements AiDriver {
  readonly name = env.AI_PROVIDER;
  readonly available = Boolean(env.AI_API_KEY);

  private readonly baseUrl = (env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  private readonly model = env.AI_MODEL;
  /** Numeric groundwork and the fallback for anything the model cannot do. */
  private readonly heuristic = new HeuristicAiDriver();

  private async complete(
    systemPrompt: string,
    userPrompt: string,
    options: { temperature?: number; maxTokens?: number } = {},
  ): Promise<{ content: string; tokens: number; latencyMs: number }> {
    if (!env.AI_API_KEY) {
      throw new AppError('AI provider is not configured', { status: 503, code: ErrorCode.AI_UNAVAILABLE });
    }

    const startedAt = Date.now();
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: `${SYSTEM_GUARDRAILS}\n${systemPrompt}` },
          { role: 'user', content: userPrompt },
        ],
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 1200,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new AppError(`AI provider returned ${response.status}`, {
        status: response.status === 429 ? 429 : 502,
        code: response.status === 429 ? ErrorCode.RATE_LIMITED : ErrorCode.PROVIDER_ERROR,
        details: body.slice(0, 400),
      });
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new AppError('AI provider returned an empty response', { status: 502, code: ErrorCode.PROVIDER_ERROR });
    }

    return { content, tokens: payload.usage?.total_tokens ?? 0, latencyMs: Date.now() - startedAt };
  }

  /** Models occasionally wrap JSON in prose or fences; recover rather than fail. */
  private parseJson<T>(content: string): T {
    const attempt = (text: string): T | null => {
      try {
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    };

    const direct = attempt(content);
    if (direct !== null) return direct;

    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced?.[1]) {
      const parsed = attempt(fenced[1].trim());
      if (parsed !== null) return parsed;
    }

    const braced = content.match(/\{[\s\S]*\}/);
    if (braced?.[0]) {
      const parsed = attempt(braced[0]);
      if (parsed !== null) return parsed;
    }

    throw new AppError('AI provider returned unparseable output', { status: 502, code: ErrorCode.PROVIDER_ERROR });
  }

  async generateDescription(request: DescriptionRequest): Promise<DescriptionResult> {
    const facts = { ...request.details, ...request.attributes };
    const result = await this.complete(
      `You write marketplace listing copy. Reply with JSON only:
{"title":string,"description":string,"highlights":string[],"seoTitle":string,"seoDescription":string}
Rules: write in the language with code "${request.language}". Use ONLY the facts provided — never invent a
specification, condition, or history. No emojis, no ALL CAPS, no "best deal ever" hype. 90-180 words.
Close by inviting the buyer to message through the app. Do not include phone numbers or emails.`,
      JSON.stringify({
        marketplace: request.marketplaceCode,
        category: request.categoryName,
        title: request.title,
        price: request.price,
        currency: request.currency,
        city: request.city,
        tone: request.tone ?? 'neutral',
        facts,
        existingDescription: request.existingDescription ?? undefined,
      }),
      { temperature: 0.6, maxTokens: 900 },
    );

    const parsed = this.parseJson<Partial<DescriptionResult>>(result.content);
    const fallback = await this.heuristic.generateDescription(request);

    return {
      title: parsed.title?.slice(0, 191) ?? fallback.title,
      description: parsed.description ?? fallback.description,
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 8).map(String) : fallback.highlights,
      seoTitle: parsed.seoTitle?.slice(0, 191) ?? fallback.seoTitle,
      seoDescription: parsed.seoDescription?.slice(0, 300) ?? fallback.seoDescription,
      model: this.model,
      tokensUsed: result.tokens,
      latencyMs: result.latencyMs,
    };
  }

  /**
   * The model judges; the heuristic computes. We hand it the pre-computed
   * per-criterion scores and ask for the narrative and the verdict, so the
   * numbers shown to the user are always reproducible arithmetic.
   */
  async compareListings(request: CompareRequest): Promise<CompareResult> {
    const baseline = await this.heuristic.compareListings(request);

    const result = await this.complete(
      `You are an impartial buying adviser comparing ${request.items.length} marketplace listings.
Reply with JSON only:
{"summary":string,"recommendation":string,"bestOverallListingId":number,"bestValueListingId":number,
 "bestConditionListingId":number,"prosCons":{"<listingId>":{"pros":string[],"cons":string[]}}}
Rules: write in the language with code "${request.language}". Base every claim on the supplied rows and scores —
never invent a specification. Say plainly when two options are effectively equivalent. Mention the single most
important trade-off. Recommend inspecting in person and verifying paperwork. 3-5 sentences for summary,
2-4 for recommendation. Use the exact listing ids given.`,
      JSON.stringify({
        marketplace: request.marketplaceCode,
        currency: request.currency,
        items: request.items,
        differingRows: request.rows.filter((row) => row.differs),
        computedScores: baseline.criteriaScores,
      }),
      { temperature: 0.4, maxTokens: 1400 },
    );

    const parsed = this.parseJson<Partial<CompareResult>>(result.content);
    const validId = (value: unknown): number | null =>
      typeof value === 'number' && request.items.some((item) => item.id === value) ? value : null;

    return {
      summary: parsed.summary ?? baseline.summary,
      recommendation: parsed.recommendation ?? baseline.recommendation,
      // Fall back to the computed winner if the model names a listing that is
      // not in the set — a common failure mode with numeric ids.
      bestOverallListingId: validId(parsed.bestOverallListingId) ?? baseline.bestOverallListingId,
      bestValueListingId: validId(parsed.bestValueListingId) ?? baseline.bestValueListingId,
      bestConditionListingId: validId(parsed.bestConditionListingId) ?? baseline.bestConditionListingId,
      criteriaScores: baseline.criteriaScores,
      prosCons:
        parsed.prosCons && typeof parsed.prosCons === 'object' ? (parsed.prosCons as CompareResult['prosCons']) : baseline.prosCons,
      differences: baseline.differences,
      model: this.model,
      tokensUsed: result.tokens,
      latencyMs: result.latencyMs,
    };
  }

  async recommendPrice(request: PriceRequest): Promise<PriceResult> {
    // Statistics from the comparables are authoritative; the model only writes
    // the rationale a seller reads.
    const baseline = await this.heuristic.recommendPrice(request);
    if (request.comparables.length === 0) return baseline;

    const result = await this.complete(
      `You explain a pricing recommendation to a seller. Reply with JSON only:
{"rationale":string,"demandLevel":"very_low"|"low"|"moderate"|"high"|"very_high","expectedDaysToSell":number}
Write in the seller's language (use English if unknown). Use the supplied statistics; do not recalculate or
contradict them. 2-4 sentences, concrete and practical.`,
      JSON.stringify({
        category: request.categoryName,
        currency: request.currency,
        statistics: {
          recommendedPrice: baseline.recommendedPrice,
          priceLow: baseline.priceLow,
          priceHigh: baseline.priceHigh,
          comparableCount: request.comparables.length,
          demandLevel: baseline.demandLevel,
        },
        item: { ...request.details, ...request.attributes },
      }),
      { temperature: 0.4, maxTokens: 500 },
    );

    const parsed = this.parseJson<Partial<PriceResult>>(result.content);
    return {
      ...baseline,
      rationale: parsed.rationale ?? baseline.rationale,
      demandLevel: parsed.demandLevel ?? baseline.demandLevel,
      expectedDaysToSell:
        typeof parsed.expectedDaysToSell === 'number' ? parsed.expectedDaysToSell : baseline.expectedDaysToSell,
      model: this.model,
      tokensUsed: result.tokens,
      latencyMs: result.latencyMs,
    };
  }

  async interpretSearch(request: SearchInterpretationRequest): Promise<SearchInterpretation> {
    const result = await this.complete(
      `You convert a marketplace search phrase into structured filters. Reply with JSON only:
{"intent":"buy"|"sell"|"rent"|"compare"|"valuate"|"browse"|"support"|"unknown","marketplaceCode":string|null,
 "categoryHint":string|null,"filters":object,"location":{"city":string,"country":string,"radiusKm":number}|null,
 "priceRange":{"min":number,"max":number}|null,"rewrittenQuery":string,"confidence":number}
Available marketplaces: ${request.marketplaces.map((marketplace) => marketplace.code).join(', ')}.
Filter keys you may use: operation, categoryId, condition, karat, weightMin, weightMax, form, bedroomsMin,
bedroomsMax, bathroomsMin, areaMin, areaMax, areaUnit, furnishing, makeId, modelId, yearMin, yearMax,
mileageMin, mileageMax, fuelType, transmission, bodyType, colorFamily, priceMin, priceMax.
Interpret South Asian number words (lakh = 100000, crore = 10000000). confidence is 0-100.`,
      JSON.stringify({ query: request.query, language: request.language, country: request.countryCode, currency: request.currency }),
      { temperature: 0.1, maxTokens: 600 },
    );

    const parsed = this.parseJson<Partial<SearchInterpretation>>(result.content);
    const fallback = await this.heuristic.interpretSearch(request);

    return {
      intent: parsed.intent ?? fallback.intent,
      marketplaceCode:
        parsed.marketplaceCode && request.marketplaces.some((marketplace) => marketplace.code === parsed.marketplaceCode)
          ? parsed.marketplaceCode
          : fallback.marketplaceCode,
      categoryHint: parsed.categoryHint ?? null,
      filters: (parsed.filters as Record<string, unknown>) ?? fallback.filters,
      location: parsed.location ?? fallback.location,
      priceRange: parsed.priceRange ?? fallback.priceRange,
      rewrittenQuery: parsed.rewrittenQuery ?? fallback.rewrittenQuery,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : fallback.confidence,
      model: this.model,
      tokensUsed: result.tokens,
      latencyMs: result.latencyMs,
    };
  }

  async translate(request: TranslateRequest): Promise<TranslateResult> {
    const result = await this.complete(
      `Translate the text into the language with code "${request.targetLanguage}".
Reply with JSON only: {"text":string,"sourceLanguage":string,"confidence":number}
Preserve meaning, tone and any numbers or units exactly. Do not add commentary. confidence is 0-100.`,
      JSON.stringify({ text: request.text.slice(0, 4000), sourceLanguage: request.sourceLanguage ?? 'auto' }),
      { temperature: 0.1, maxTokens: 1600 },
    );

    const parsed = this.parseJson<Partial<TranslateResult>>(result.content);
    return {
      text: parsed.text ?? request.text,
      sourceLanguage: parsed.sourceLanguage ?? request.sourceLanguage ?? 'unknown',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 70,
      model: this.model,
      tokensUsed: result.tokens,
      latencyMs: result.latencyMs,
    };
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const result = await this.complete(
      `You are a marketplace support assistant. Reply with JSON only:
{"reply":string,"citations":number[],"shouldEscalate":boolean,"detectedTopic":string|null}
Answer in the language with code "${request.language}". Use ONLY the supplied help articles; if they do not cover
the question, or the user asks for a human, a refund, or reports fraud, set shouldEscalate true and say a
colleague will follow up. Never promise refunds, never disclose another user's data, never give legal advice.
citations are the ids of articles you used.`,
      JSON.stringify({
        conversation: request.messages.slice(-8),
        helpArticles: request.knowledgeBase ?? [],
        user: request.userContext ?? {},
      }),
      { temperature: 0.3, maxTokens: 900 },
    );

    const parsed = this.parseJson<Partial<ChatResult>>(result.content);
    const fallback = await this.heuristic.chat(request);

    return {
      reply: parsed.reply ?? fallback.reply,
      citations: Array.isArray(parsed.citations) ? parsed.citations.filter((id): id is number => typeof id === 'number') : [],
      shouldEscalate: parsed.shouldEscalate ?? fallback.shouldEscalate,
      detectedTopic: parsed.detectedTopic ?? fallback.detectedTopic,
      model: this.model,
      tokensUsed: result.tokens,
      latencyMs: result.latencyMs,
    };
  }

  async moderate(request: ModerationRequest): Promise<ModerationResult> {
    // Union of both: the rules catch known-bad patterns cheaply and reliably,
    // the model catches novel phrasing. Neither alone is sufficient.
    const rules = await this.heuristic.moderate(request);

    try {
      const result = await this.complete(
        `You moderate marketplace content. Reply with JSON only:
{"decision":"approve"|"flag"|"reject","scores":{"spam":number,"scam":number,"adult":number,"violence":number,
"hate":number,"prohibited":number,"offsite":number},"detectedPii":string[],"reasons":string[]}
Scores are 0-1. reject only for clearly prohibited content (weapons, drugs, adult services, obvious fraud).
flag for anything doubtful. Context: ${request.context}.`,
        JSON.stringify({ text: request.text.slice(0, 4000), language: request.language }),
        { temperature: 0, maxTokens: 500 },
      );

      const parsed = this.parseJson<Partial<ModerationResult>>(result.content);
      const modelScores = (parsed.scores as Record<string, number>) ?? {};
      const merged = { ...rules.scores };
      for (const [key, value] of Object.entries(modelScores)) {
        if (typeof value === 'number') merged[key] = Math.max(merged[key] ?? 0, value);
      }

      const max = Object.values(merged).reduce((highest, value) => Math.max(highest, value), 0);
      const severities = { approve: 0, flag: 1, reject: 2 } as const;
      const strictest =
        severities[parsed.decision ?? 'approve'] >= severities[rules.decision] ? (parsed.decision ?? 'approve') : rules.decision;

      return {
        decision: max >= 0.8 ? 'reject' : max >= 0.35 ? (strictest === 'approve' ? 'flag' : strictest) : strictest,
        scores: merged,
        detectedPii: [...new Set([...rules.detectedPii, ...(parsed.detectedPii ?? [])])],
        reasons: [...new Set([...rules.reasons, ...(parsed.reasons ?? [])])],
        model: this.model,
        tokensUsed: result.tokens,
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      log.warn({ err: error }, 'model moderation failed; using rule results only');
      return rules;
    }
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    if (!env.AI_API_KEY) return this.heuristic.embed(request);

    const startedAt = Date.now();
    const model = request.model ?? 'text-embedding-3-small';

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.AI_API_KEY}` },
      body: JSON.stringify({ model, input: request.texts.map((text) => text.slice(0, 8000)) }),
      signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new AppError(`Embedding provider returned ${response.status}`, {
        status: 502,
        code: ErrorCode.PROVIDER_ERROR,
      });
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding: number[] }>;
      usage?: { total_tokens?: number };
    };
    const vectors = (payload.data ?? []).map((entry) => entry.embedding);

    return {
      vectors,
      dimensions: vectors[0]?.length ?? 0,
      model,
      tokensUsed: payload.usage?.total_tokens,
      latencyMs: Date.now() - startedAt,
    };
  }
}
