import crypto from 'node:crypto';
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

/**
 * The default AI driver: deterministic heuristics, no network, no API key.
 *
 * This is not a stub that returns placeholder text. Each method produces a
 * genuinely useful result computed from the structured data the platform already
 * has — the comparison verdict, for instance, scores every criterion from the
 * comparison table and picks real winners. That matters for three reasons:
 * the whole product is demonstrable offline, an LLM outage degrades instead of
 * breaking, and the heuristic output is the baseline an LLM has to beat.
 *
 * Set AI_PROVIDER=openai (with AI_API_KEY) to layer a model on top.
 */
const round = (value: number, decimals = 2): number => Number(value.toFixed(decimals));
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export class HeuristicAiDriver implements AiDriver {
  readonly name = 'heuristic';
  readonly available = true;

  /* §18 AI Description Generator -------------------------------------------- */

  async generateDescription(request: DescriptionRequest): Promise<DescriptionResult> {
    const startedAt = Date.now();
    const facts = this.collectFacts(request);
    const highlights = facts.slice(0, 6).map((fact) => `${fact.label}: ${fact.value}`);

    const opening = `${request.title} — ${request.categoryName.toLowerCase()}${request.city ? ` in ${request.city}` : ''}.`;
    const specSentence =
      facts.length > 0
        ? ` Key details: ${facts
            .slice(0, 8)
            .map((fact) => `${fact.label.toLowerCase()} ${fact.value}`)
            .join(', ')}.`
        : '';
    const priceSentence =
      request.price !== null
        ? ` Priced at ${new Intl.NumberFormat('en-US').format(request.price)} ${request.currency}.`
        : ' Contact for pricing.';
    const closing = ' Message me through the app to arrange a viewing or ask anything I have not covered.';

    const description = [opening, specSentence, priceSentence, closing]
      .join('')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      title: request.title.slice(0, 191),
      description,
      highlights,
      seoTitle: `${request.title} | ${request.categoryName}${request.city ? ` in ${request.city}` : ''}`.slice(0, 191),
      seoDescription: description.slice(0, 300),
      model: 'heuristic-description-v1',
      latencyMs: Date.now() - startedAt,
    };
  }

  private collectFacts(request: DescriptionRequest): Array<{ label: string; value: string }> {
    const facts: Array<{ label: string; value: string }> = [];
    const push = (label: string, value: unknown): void => {
      if (value === null || value === undefined || value === '' || value === false) return;
      facts.push({ label, value: typeof value === 'boolean' ? 'yes' : String(value) });
    };

    for (const [key, value] of Object.entries({ ...request.details, ...request.attributes })) {
      if (key.startsWith('ai') || key.endsWith('Url') || key.endsWith('Id')) continue;
      push(this.humanize(key), value);
      if (facts.length >= 14) break;
    }
    return facts;
  }

  private humanize(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^./, (char) => char.toUpperCase());
  }

  /* §15 / spec line 1 — automatic comparison -------------------------------- */

  /**
   * Scores each listing per criterion group by normalising every differing
   * numeric/boolean row onto 0..100, then aggregates into an overall score.
   * Rows the module marked `better: 'none'` are reported as differences but do
   * not influence the winner, because "different colour" is not "better".
   */
  async compareListings(request: CompareRequest): Promise<CompareResult> {
    const startedAt = Date.now();
    const items = request.items;
    if (items.length === 0) {
      return this.emptyCompare(startedAt);
    }

    const criteriaScores: Record<string, Record<string, number>> = {};
    const groupTotals = new Map<number, Map<string, { sum: number; count: number }>>();
    const differences: string[] = [];

    for (const item of items) {
      criteriaScores[String(item.id)] = {};
      groupTotals.set(item.id, new Map());
    }

    for (const row of request.rows) {
      if (row.differs) {
        differences.push(`${row.label}: ${row.values.map((value) => value.display).join(' vs ')}`);
      }
      if (row.better === 'none' || !row.differs) continue;

      const numeric = row.values
        .map((value) => ({
          listingId: value.listingId,
          number: typeof value.raw === 'boolean' ? (value.raw ? 1 : 0) : Number(value.raw),
        }))
        .filter((entry) => Number.isFinite(entry.number));

      if (numeric.length < 2) continue;

      const values = numeric.map((entry) => entry.number);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min;

      for (const entry of numeric) {
        // A flat row carries no information, so award everyone the midpoint.
        const normalized = span === 0 ? 50 : ((entry.number - min) / span) * 100;
        const score = row.better === 'higher' ? normalized : 100 - normalized;
        criteriaScores[String(entry.listingId)]![row.code] = round(score, 1);

        const groups = groupTotals.get(entry.listingId)!;
        const bucket = groups.get(row.group) ?? { sum: 0, count: 0 };
        bucket.sum += score;
        bucket.count += 1;
        groups.set(row.group, bucket);
      }
    }

    // Group averages, then an overall mean of groups so a group with 12 rows
    // does not drown out one with 2.
    const overall = new Map<number, number>();
    for (const item of items) {
      const groups = groupTotals.get(item.id)!;
      let total = 0;
      let count = 0;
      for (const [group, bucket] of groups) {
        const average = bucket.sum / bucket.count;
        criteriaScores[String(item.id)]![`group:${group}`] = round(average, 1);
        total += average;
        count += 1;
      }
      // Seller trust nudges the overall score: a marginally better spec from an
      // unverified seller is not actually the better buy.
      const trustBonus = (item.isVerifiedSeller ? 4 : 0) + (item.sellerRating ? (item.sellerRating - 3) * 3 : 0);
      const base = count > 0 ? total / count : 50;
      overall.set(item.id, round(clamp(base + trustBonus, 0, 100), 1));
      criteriaScores[String(item.id)]!.overall = overall.get(item.id)!;
    }

    const bestOverall = this.argmax(items, (item) => overall.get(item.id) ?? 0);

    // Best value: score per unit of price, using the cheapest as the reference.
    const priced = items.filter((item) => item.price !== null && item.price > 0);
    const bestValue =
      priced.length >= 2
        ? this.argmax(priced, (item) => (overall.get(item.id) ?? 0) / (item.price as number))
        : bestOverall;

    const conditionRank: Record<string, number> = {
      new: 7, like_new: 6, excellent: 5, very_good: 4.5, good: 4, refurbished: 3, fair: 2, used: 2, poor: 1, for_parts: 0, salvage: 0,
    };
    const bestCondition = this.argmax(items, (item) => conditionRank[item.condition ?? ''] ?? 2);

    const prosCons: CompareResult['prosCons'] = {};
    for (const item of items) {
      const wins: string[] = [];
      const losses: string[] = [];
      for (const row of request.rows) {
        if (row.better === 'none' || !row.differs) continue;
        const score = criteriaScores[String(item.id)]?.[row.code];
        if (score === undefined) continue;
        if (score >= 85) wins.push(`Best ${row.label.toLowerCase()} (${row.values.find((v) => v.listingId === item.id)?.display ?? ''})`);
        else if (score <= 15) losses.push(`Weakest ${row.label.toLowerCase()} (${row.values.find((v) => v.listingId === item.id)?.display ?? ''})`);
      }
      if (item.isVerifiedSeller) wins.push('Verified seller');
      if (item.sellerRating !== null && item.sellerRating >= 4.5) wins.push(`Highly rated seller (${item.sellerRating.toFixed(1)}★)`);
      if (item.sellerRating !== null && item.sellerRating < 3) losses.push(`Low seller rating (${item.sellerRating.toFixed(1)}★)`);

      prosCons[String(item.id)] = { pros: wins.slice(0, 5), cons: losses.slice(0, 5) };
    }

    const nameOf = (id: number | null): string => items.find((item) => item.id === id)?.title ?? 'this option';

    const summary =
      differences.length === 0
        ? `These ${items.length} options are near-identical on every field we compare, so choose on seller trust and location.`
        : `Comparing ${items.length} options across ${request.rows.filter((row) => row.differs).length} differing fields. ` +
          `${nameOf(bestOverall?.id ?? null)} scores highest overall at ${overall.get(bestOverall?.id ?? 0)?.toFixed(0)}/100` +
          (bestValue && bestValue.id !== bestOverall?.id
            ? `, while ${nameOf(bestValue.id)} gives the most for the money.`
            : '.');

    const recommendation = this.buildRecommendation(bestOverall, bestValue, bestCondition, overall, nameOf);

    return {
      summary,
      recommendation,
      bestOverallListingId: bestOverall?.id ?? null,
      bestValueListingId: bestValue?.id ?? null,
      bestConditionListingId: bestCondition?.id ?? null,
      criteriaScores,
      prosCons,
      differences: differences.slice(0, 40),
      model: 'heuristic-compare-v1',
      latencyMs: Date.now() - startedAt,
    };
  }

  private buildRecommendation(
    bestOverall: CompareRequest['items'][number] | null,
    bestValue: CompareRequest['items'][number] | null,
    bestCondition: CompareRequest['items'][number] | null,
    overall: Map<number, number>,
    nameOf: (id: number | null) => string,
  ): string {
    if (!bestOverall) return 'Add more items to get a recommendation.';

    const parts: string[] = [];
    parts.push(`Pick ${nameOf(bestOverall.id)} if specifications matter most to you.`);

    if (bestValue && bestValue.id !== bestOverall.id) {
      const gap = (overall.get(bestOverall.id) ?? 0) - (overall.get(bestValue.id) ?? 0);
      parts.push(
        gap < 10
          ? `${nameOf(bestValue.id)} is only ${gap.toFixed(0)} points behind for noticeably less money, which makes it the better buy for most people.`
          : `${nameOf(bestValue.id)} costs less but gives up ${gap.toFixed(0)} points of capability.`,
      );
    }
    if (bestCondition && bestCondition.id !== bestOverall.id && bestCondition.id !== bestValue?.id) {
      parts.push(`${nameOf(bestCondition.id)} is in the best condition of the group.`);
    }
    parts.push('Inspect in person and verify paperwork before paying, whichever you choose.');
    return parts.join(' ');
  }

  private argmax<T>(items: T[], score: (item: T) => number): T | null {
    if (items.length === 0) return null;
    return items.reduce((best, item) => (score(item) > score(best) ? item : best), items[0]!);
  }

  private emptyCompare(startedAt: number): CompareResult {
    return {
      summary: 'Nothing to compare yet.',
      recommendation: 'Add at least two listings.',
      bestOverallListingId: null,
      bestValueListingId: null,
      bestConditionListingId: null,
      criteriaScores: {},
      prosCons: {},
      differences: [],
      model: 'heuristic-compare-v1',
      latencyMs: Date.now() - startedAt,
    };
  }

  /* §18 Price Recommendation ------------------------------------------------ */

  async recommendPrice(request: PriceRequest): Promise<PriceResult> {
    const startedAt = Date.now();
    const prices = request.comparables.map((comparable) => comparable.price).filter((price) => price > 0).sort((a, b) => a - b);

    if (prices.length === 0) {
      return {
        recommendedPrice: 0,
        priceLow: 0,
        priceHigh: 0,
        confidence: 0,
        rationale: 'There are not enough comparable listings in this category and area yet to suggest a price.',
        demandLevel: 'moderate',
        expectedDaysToSell: null,
        model: 'heuristic-price-v1',
        latencyMs: Date.now() - startedAt,
      };
    }

    // Median is the right centre here: a single mispriced outlier is common and
    // would drag a mean badly.
    const median = this.percentile(prices, 50);
    const p25 = this.percentile(prices, 25);
    const p75 = this.percentile(prices, 75);

    // Dispersion drives confidence: a tight cluster is a reliable signal.
    const spread = median > 0 ? (p75 - p25) / median : 1;
    const sampleConfidence = clamp((prices.length / 25) * 60, 0, 60);
    const spreadConfidence = clamp((1 - Math.min(spread, 1)) * 40, 0, 40);
    const confidence = round(sampleConfidence + spreadConfidence, 1);

    const recentCount = request.comparables.filter(
      (comparable) => Date.now() - new Date(comparable.createdAt).getTime() < 14 * 86_400_000,
    ).length;
    const recentShare = recentCount / request.comparables.length;
    const demandLevel: PriceResult['demandLevel'] =
      recentShare > 0.6 ? 'very_high' : recentShare > 0.4 ? 'high' : recentShare > 0.2 ? 'moderate' : recentShare > 0.1 ? 'low' : 'very_low';

    // Slightly under the median sells materially faster without leaving money on
    // the table, so that is what we suggest.
    const recommended = round(median * 0.97, 2);

    return {
      recommendedPrice: recommended,
      priceLow: round(p25, 2),
      priceHigh: round(p75, 2),
      confidence,
      rationale:
        `Based on ${prices.length} comparable ${request.categoryName.toLowerCase()} listings, the middle of the market is ` +
        `${new Intl.NumberFormat('en-US').format(round(median))} ${request.currency}, with most between ` +
        `${new Intl.NumberFormat('en-US').format(round(p25))} and ${new Intl.NumberFormat('en-US').format(round(p75))}. ` +
        `Pricing just under the median typically sells fastest. ${recentCount} of these were listed in the last two weeks, ` +
        `which suggests ${demandLevel.replace('_', ' ')} demand.`,
      demandLevel,
      expectedDaysToSell:
        demandLevel === 'very_high' ? 7 : demandLevel === 'high' ? 14 : demandLevel === 'moderate' ? 30 : 60,
      model: 'heuristic-price-v1',
      latencyMs: Date.now() - startedAt,
    };
  }

  private percentile(sorted: number[], percentile: number): number {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0]!;
    const position = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const weight = position - lower;
    return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
  }

  /* §9 AI Search ------------------------------------------------------------ */

  /**
   * Rule-based query understanding. It handles the patterns that actually occur
   * in marketplace search — "3 bed house lahore under 2 crore", "22k gold chain",
   * "corolla 2018 automatic" — by extracting numbers with units and matching
   * marketplace keywords.
   */
  async interpretSearch(request: SearchInterpretationRequest): Promise<SearchInterpretation> {
    const startedAt = Date.now();
    const query = request.query.toLowerCase().trim();
    const filters: Record<string, unknown> = {};

    const KEYWORDS: Record<string, string[]> = {
      gold: ['gold', 'jewellery', 'jewelry', 'karat', 'karat', 'karat', 'tola', 'bangle', 'necklace', 'ring', 'bullion', 'coin', 'bar', 'sona', 'zewar', 'ذهب', 'سونا'],
      property: ['house', 'home', 'flat', 'apartment', 'plot', 'marla', 'kanal', 'villa', 'office', 'shop', 'rent', 'bedroom', 'bed', 'land', 'farmhouse', 'makan', 'عقار', 'گھر'],
      vehicles: ['car', 'bike', 'motorcycle', 'truck', 'bus', 'van', 'suv', 'sedan', 'mileage', 'automatic', 'manual', 'petrol', 'diesel', 'corolla', 'civic', 'alto', 'gari', 'سيارة', 'گاڑی'],
    };

    let marketplaceCode: string | null = null;
    let bestHits = 0;
    for (const [code, words] of Object.entries(KEYWORDS)) {
      const hits = words.filter((word) => query.includes(word)).length;
      if (hits > bestHits) {
        bestHits = hits;
        marketplaceCode = code;
      }
    }
    if (marketplaceCode && !request.marketplaces.some((marketplace) => marketplace.code === marketplaceCode)) {
      marketplaceCode = null;
    }

    const intent: SearchInterpretation['intent'] = /\b(rent|rental|kiraya|для аренды|للإيجار)\b/.test(query)
      ? 'rent'
      : /\b(sell|selling|bech)\b/.test(query)
        ? 'sell'
        : /\b(compare|vs|versus|difference between)\b/.test(query)
          ? 'compare'
          : /\b(worth|value|valuation|estimate|price of)\b/.test(query)
            ? 'valuate'
            : /\b(buy|for sale|purchase)\b/.test(query)
              ? 'buy'
              : 'browse';

    if (intent === 'rent') filters.operation = 'rent';
    if (intent === 'buy') filters.operation = 'sell';

    // Price bounds, including South Asian lakh/crore and Gulf k/m shorthand.
    const priceRange = this.extractPriceRange(query);

    const bedrooms = query.match(/(\d+)\s*(?:bed|bedroom|beds|bhk)\b/);
    if (bedrooms?.[1]) filters.bedroomsMin = Number(bedrooms[1]);

    const karat = query.match(/(\d{1,2})\s*(?:k|karat|carat)\b/);
    if (karat?.[1] && marketplaceCode === 'gold') filters.karat = karat[1];

    const year = query.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
    if (year?.[1] && marketplaceCode === 'vehicles') {
      filters.yearMin = Number(year[1]);
      filters.yearMax = Number(year[1]);
    }

    if (/\bautomatic\b/.test(query)) filters.transmission = 'automatic';
    if (/\bmanual\b/.test(query)) filters.transmission = 'manual';
    for (const fuel of ['petrol', 'diesel', 'hybrid', 'electric', 'cng', 'lpg']) {
      if (query.includes(fuel)) filters.fuelType = fuel;
    }
    if (/\b(furnished|fully furnished)\b/.test(query)) filters.furnishing = 'furnished';
    if (/\bnew\b/.test(query)) filters.condition = 'new';

    // Strip the structured parts so what remains is a clean keyword query.
    const rewritten = query
      .replace(/\b(under|below|above|over|between|from|to|less than|more than)\b/g, ' ')
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:k|m|lakh|lac|crore|cr|million|thousand)?\b/g, ' ')
      .replace(/\b(bed|bedroom|beds|bhk|karat|carat|automatic|manual|for sale|for rent|buy|sell|rent)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const signals = Object.keys(filters).length + (marketplaceCode ? 1 : 0) + (priceRange ? 1 : 0);

    return {
      intent,
      marketplaceCode,
      categoryHint: null,
      filters,
      location: null,
      priceRange,
      rewrittenQuery: rewritten || request.query,
      confidence: round(clamp(signals * 18, 10, 92), 1),
      model: 'heuristic-search-v1',
      latencyMs: Date.now() - startedAt,
    };
  }

  private extractPriceRange(query: string): { min?: number; max?: number } | null {
    const scale = (raw: string, suffix: string | undefined): number => {
      const value = Number(raw.replace(/,/g, ''));
      switch ((suffix ?? '').toLowerCase()) {
        case 'k':
        case 'thousand':
          return value * 1_000;
        case 'lakh':
        case 'lac':
          return value * 100_000;
        case 'crore':
        case 'cr':
          return value * 10_000_000;
        case 'm':
        case 'million':
          return value * 1_000_000;
        default:
          return value;
      }
    };

    const pattern = /(\d+(?:[.,]\d+)?)\s*(k|m|lakh|lac|crore|cr|million|thousand)?/gi;

    const under = query.match(/(?:under|below|less than|upto|up to|max)\s*(\d+(?:[.,]\d+)?)\s*(k|m|lakh|lac|crore|cr|million|thousand)?/i);
    if (under?.[1]) return { max: scale(under[1], under[2]) };

    const over = query.match(/(?:above|over|more than|from|min)\s*(\d+(?:[.,]\d+)?)\s*(k|m|lakh|lac|crore|cr|million|thousand)?/i);
    if (over?.[1]) return { min: scale(over[1], over[2]) };

    const between = query.match(
      /between\s*(\d+(?:[.,]\d+)?)\s*(k|m|lakh|lac|crore|cr|million|thousand)?\s*(?:and|to|-)\s*(\d+(?:[.,]\d+)?)\s*(k|m|lakh|lac|crore|cr|million|thousand)?/i,
    );
    if (between?.[1] && between[3]) {
      return { min: scale(between[1], between[2]), max: scale(between[3], between[4]) };
    }

    void pattern;
    return null;
  }

  /* §12 Translation --------------------------------------------------------- */

  async translate(request: TranslateRequest): Promise<TranslateResult> {
    // Honest behaviour: without a translation backend we return the source text
    // and a zero confidence, so the UI can show "translation unavailable"
    // instead of silently presenting untranslated text as translated.
    return {
      text: request.text,
      sourceLanguage: request.sourceLanguage ?? 'unknown',
      confidence: 0,
      model: 'heuristic-passthrough-v1',
      latencyMs: 0,
    };
  }

  /* §18 AI Customer Support ------------------------------------------------- */

  /**
   * Retrieval-based support: matches the question against knowledge-base
   * articles by term overlap and answers from the best match, escalating when
   * nothing scores well enough or the user is clearly frustrated.
   */
  async chat(request: ChatRequest): Promise<ChatResult> {
    const startedAt = Date.now();
    const lastUserMessage = [...request.messages].reverse().find((message) => message.role === 'user');
    const question = (lastUserMessage?.content ?? '').toLowerCase();

    const escalationSignals = /\b(agent|human|manager|complaint|refund|scam|fraud|police|legal|lawyer|angry|useless|kyc|aml|takeover|hacked|chargeback)\b/.test(question);

    const scored = (request.knowledgeBase ?? [])
      .map((article) => {
        const haystack = `${article.title} ${article.excerpt}`.toLowerCase();
        const terms = question.split(/\W+/).filter((term) => term.length > 3);
        const hits = terms.filter((term) => haystack.includes(term)).length;
        return { article, score: terms.length > 0 ? hits / terms.length : 0 };
      })
      .filter((entry) => entry.score > 0.2)
      .sort((a, b) => b.score - a.score);

    const best = scored[0];

    if (!best || escalationSignals) {
      return {
        reply: escalationSignals
          ? 'I understand — let me pass this to a human colleague who can look at your account directly. I have created a support ticket and someone will reply shortly.'
          : 'I could not find a confident answer for that. I have created a support ticket so a colleague can help you properly.',
        citations: [],
        shouldEscalate: true,
        detectedTopic: null,
        model: 'heuristic-support-v1',
        latencyMs: Date.now() - startedAt,
      };
    }

    return {
      reply: `${best.article.excerpt}\n\nThis is from our help article "${best.article.title}". If that does not cover your case, reply and I will hand you to a colleague.`,
      citations: scored.slice(0, 3).map((entry) => entry.article.id),
      shouldEscalate: false,
      detectedTopic: best.article.title,
      model: 'heuristic-support-v1',
      latencyMs: Date.now() - startedAt,
    };
  }

  /* §18 Moderation --------------------------------------------------------- */

  async moderate(request: ModerationRequest): Promise<ModerationResult> {
    const startedAt = Date.now();
    const text = request.text;
    const scores: Record<string, number> = {};
    const reasons: string[] = [];
    const detectedPii: string[] = [];

    const PATTERNS: Array<{ key: string; pattern: RegExp; weight: number; reason: string }> = [
      { key: 'scam', pattern: /\b(advance fee|western union|money ?gram|wire transfer only|send deposit first)\b/i, weight: 0.8, reason: 'Advance-payment scam wording' },
      { key: 'offsite', pattern: /\b(whats\s?app me|telegram me|contact outside|deal outside)\b/i, weight: 0.5, reason: 'Directing the deal off-platform' },
      { key: 'adult', pattern: /\b(escort|xxx|porn|nude)\b/i, weight: 0.9, reason: 'Adult content' },
      { key: 'weapons', pattern: /\b(ak-?47|pistol|ammunition|explosive)\b/i, weight: 0.9, reason: 'Prohibited item' },
      { key: 'drugs', pattern: /\b(cocaine|heroin|mdma|cannabis for sale)\b/i, weight: 0.9, reason: 'Prohibited item' },
      { key: 'hate', pattern: /\b(no [a-z]+ people|only for [a-z]+ race)\b/i, weight: 0.7, reason: 'Discriminatory wording' },
      { key: 'crypto', pattern: /\b(bitcoin only|crypto payment only|usdt only)\b/i, weight: 0.4, reason: 'Crypto-only payment' },
    ];

    for (const rule of PATTERNS) {
      if (rule.pattern.test(text)) {
        scores[rule.key] = rule.weight;
        reasons.push(rule.reason);
      }
    }

    if (/[\w.+-]+@[\w-]+\.[\w.]{2,}/.test(text)) {
      detectedPii.push('email');
      scores.pii = Math.max(scores.pii ?? 0, 0.3);
    }
    if (/(?:\+?\d[\s.-]?){9,}/.test(text)) {
      detectedPii.push('phone');
      scores.pii = Math.max(scores.pii ?? 0, 0.3);
    }
    if (/\b\d{13,19}\b/.test(text.replace(/[\s-]/g, ''))) {
      detectedPii.push('card_number');
      scores.pii = 0.9;
      reasons.push('Possible card number');
    }

    const max = Object.values(scores).reduce((highest, value) => Math.max(highest, value), 0);
    const decision: ModerationResult['decision'] = max >= 0.8 ? 'reject' : max >= 0.35 ? 'flag' : 'approve';

    return {
      decision,
      scores,
      detectedPii,
      reasons,
      model: 'heuristic-moderation-v1',
      latencyMs: Date.now() - startedAt,
    };
  }

  /* §18 Recommendation Engine ---------------------------------------------- */

  /**
   * Deterministic hashed bag-of-words vectors. Not semantically aware, but they
   * do make "listings that share vocabulary" retrievable, which is enough for
   * similar-listing recommendations until a real embedding model is configured.
   */
  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const startedAt = Date.now();
    const dimensions = 128;

    const vectors = request.texts.map((text) => {
      const vector = new Array<number>(dimensions).fill(0);
      const tokens = text
        .toLowerCase()
        .split(/\W+/)
        .filter((token) => token.length > 2);

      for (const token of tokens) {
        const hash = crypto.createHash('md5').update(token).digest();
        const index = ((hash[0]! << 8) | hash[1]!) % dimensions;
        const sign = (hash[2]! & 1) === 0 ? 1 : -1;
        vector[index] = vector[index]! + sign;
      }

      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
      return norm > 0 ? vector.map((value) => value / norm) : vector;
    });

    return {
      vectors,
      dimensions,
      model: 'heuristic-hash-embed-v1',
      latencyMs: Date.now() - startedAt,
    };
  }
}
