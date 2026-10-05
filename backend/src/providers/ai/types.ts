/**
 * The AI capability surface (§18 AI Features).
 *
 * Every AI feature in the product is expressed as one method here. Drivers
 * implement it however they like — an LLM call, a local heuristic, or a hosted
 * model — and the domain never knows which.
 */

export interface AiUsage {
  model: string;
  tokensUsed?: number;
  latencyMs?: number;
  cost?: number;
  cacheHit?: boolean;
}

/* §18 AI Description Generator ------------------------------------------------ */

export interface DescriptionRequest {
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
  existingDescription?: string | null;
}

export interface DescriptionResult extends AiUsage {
  title: string;
  description: string;
  highlights: string[];
  seoTitle: string;
  seoDescription: string;
}

/* §15 / spec line 1 — automatic comparison ------------------------------------ */

export interface CompareItem {
  id: number;
  title: string;
  price: number | null;
  currency: string | null;
  condition: string | null;
  city: string | null;
  sellerRating: number | null;
  isVerifiedSeller: boolean;
}

export interface CompareRow {
  code: string;
  label: string;
  group: string;
  better: 'higher' | 'lower' | 'none';
  unit: string | null;
  differs: boolean;
  values: Array<{ listingId: number; display: string; raw: unknown }>;
}

export interface CompareRequest {
  marketplaceCode: string;
  language: string;
  currency: string;
  items: CompareItem[];
  rows: CompareRow[];
}

export interface CompareResult extends AiUsage {
  summary: string;
  recommendation: string;
  bestOverallListingId: number | null;
  bestValueListingId: number | null;
  bestConditionListingId: number | null;
  /** listingId → { criterion → 0..100 } */
  criteriaScores: Record<string, Record<string, number>>;
  /** listingId → pros/cons */
  prosCons: Record<string, { pros: string[]; cons: string[] }>;
  /** Human-readable list of the fields that actually differ. */
  differences: string[];
}

/* §18 Price Recommendation ---------------------------------------------------- */

export interface PriceRequest {
  marketplaceCode: string;
  categoryId: number;
  categoryName: string;
  currency: string;
  countryId: number | null;
  cityId: number | null;
  attributes: Record<string, unknown>;
  details: Record<string, unknown>;
  comparables: Array<{ id: number; price: number; currency: string; createdAt: string; details?: Record<string, unknown> }>;
}

export interface PriceResult extends AiUsage {
  recommendedPrice: number;
  priceLow: number;
  priceHigh: number;
  confidence: number;
  rationale: string;
  demandLevel: 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';
  expectedDaysToSell: number | null;
}

/* §9 AI Search / Smart Search ------------------------------------------------- */

export interface SearchInterpretationRequest {
  query: string;
  language: string;
  marketplaces: Array<{ id: number; code: string; name: string }>;
  currency: string;
  countryCode: string;
}

export interface SearchInterpretation extends AiUsage {
  intent: 'buy' | 'sell' | 'rent' | 'compare' | 'valuate' | 'browse' | 'support' | 'unknown';
  marketplaceCode: string | null;
  categoryHint: string | null;
  filters: Record<string, unknown>;
  location: { city?: string; country?: string; radiusKm?: number } | null;
  priceRange: { min?: number; max?: number } | null;
  rewrittenQuery: string;
  confidence: number;
}

/* §12 / §18 Auto Translation -------------------------------------------------- */

export interface TranslateRequest {
  text: string;
  sourceLanguage?: string | null;
  targetLanguage: string;
}

export interface TranslateResult extends AiUsage {
  text: string;
  sourceLanguage: string;
  confidence: number;
}

/* §18 AI Customer Support ----------------------------------------------------- */

export interface ChatRequest {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  language: string;
  knowledgeBase?: Array<{ id: number; title: string; excerpt: string }>;
  userContext?: Record<string, unknown>;
}

export interface ChatResult extends AiUsage {
  reply: string;
  citations: number[];
  shouldEscalate: boolean;
  detectedTopic: string | null;
}

/* §18 Duplicate / Spam / Fraud text signals ----------------------------------- */

export interface ModerationRequest {
  text: string;
  language: string;
  context: 'listing' | 'review' | 'message' | 'profile' | 'forum';
}

export interface ModerationResult extends AiUsage {
  decision: 'approve' | 'flag' | 'reject';
  scores: Record<string, number>;
  detectedPii: string[];
  reasons: string[];
}

/* §18 Recommendation Engine --------------------------------------------------- */

export interface EmbeddingRequest {
  texts: string[];
  model?: string;
}

export interface EmbeddingResult extends AiUsage {
  vectors: number[][];
  dimensions: number;
}

export interface AiDriver {
  readonly name: string;
  readonly available: boolean;

  generateDescription(request: DescriptionRequest): Promise<DescriptionResult>;
  compareListings(request: CompareRequest): Promise<CompareResult>;
  recommendPrice(request: PriceRequest): Promise<PriceResult>;
  interpretSearch(request: SearchInterpretationRequest): Promise<SearchInterpretation>;
  translate(request: TranslateRequest): Promise<TranslateResult>;
  chat(request: ChatRequest): Promise<ChatResult>;
  moderate(request: ModerationRequest): Promise<ModerationResult>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}
