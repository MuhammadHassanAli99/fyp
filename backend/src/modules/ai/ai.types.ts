/**
 * Central AI vocabulary. Capabilities are features behind one platform —
 * not GoldAI / PropertyAI / VehicleAI silos.
 */

export const AI_TASKS = [
  'description_generate',
  'title_generate',
  'image_enhance',
  'image_moderate',
  'duplicate_detect',
  'spam_detect',
  'fraud_detect',
  'price_recommend',
  'market_analysis',
  'property_valuation',
  'vehicle_estimate',
  'gold_trend',
  'translate',
  'smart_search',
  'recommend',
  'chat_support',
  'compare',
  'ocr',
  'embed',
  'speech_to_text',
  'review_authenticity',
] as const;

export type AiTask = (typeof AI_TASKS)[number];

export const AI_CAPABILITIES = [
  'llm',
  'vision',
  'embedding',
  'translation',
  'speech_to_text',
  'moderation',
  'image_enhancement',
  'prediction',
] as const;

export type AiCapabilityKind = (typeof AI_CAPABILITIES)[number];

/** Feature codes (never plan names). Every user call also requires `ai_tools`. */
export const ENTITLEMENT_BY_TASK: Partial<Record<AiTask, string>> = {
  description_generate: 'generate_description',
  title_generate: 'generate_description',
  image_enhance: 'enhance_image',
  smart_search: 'ai_search',
  price_recommend: 'ai_valuation',
  property_valuation: 'ai_valuation',
  vehicle_estimate: 'ai_valuation',
  gold_trend: 'ai_valuation',
  review_authenticity: 'ai_valuation',
  market_analysis: 'ai_analytics',
  chat_support: 'ai_support',
  ocr: 'ai_search',
  speech_to_text: 'ai_search',
};

export const CAPABILITY_BY_TASK: Record<AiTask, AiCapabilityKind> = {
  description_generate: 'llm',
  title_generate: 'llm',
  image_enhance: 'image_enhancement',
  image_moderate: 'moderation',
  duplicate_detect: 'moderation',
  spam_detect: 'moderation',
  fraud_detect: 'moderation',
  price_recommend: 'prediction',
  market_analysis: 'prediction',
  property_valuation: 'prediction',
  vehicle_estimate: 'prediction',
  gold_trend: 'prediction',
  translate: 'translation',
  smart_search: 'llm',
  recommend: 'embedding',
  chat_support: 'llm',
  compare: 'llm',
  ocr: 'vision',
  embed: 'embedding',
  speech_to_text: 'speech_to_text',
  review_authenticity: 'prediction',
};

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface AiMeta {
  jobUuid: string;
  task: AiTask;
  provider: string;
  model: string;
  version: string;
  confidence: number;
  band: ConfidenceBand;
  explanation?: string;
  signals?: Record<string, number | string>;
  cacheHit: boolean;
  timestamp: string;
  latencyMs: number;
  tokensUsed?: number;
  estimatedCost?: number | null;
}

export interface OrchestratorRequest<TInput> {
  task: AiTask;
  input: TInput;
  userId?: number | null;
  entityType?: string | null;
  entityId?: number | null;
  marketplaceId?: number | null;
  language?: string | null;
  idempotencyKey?: string | null;
  skipEntitlement?: boolean;
  skipQuota?: boolean;
  async?: boolean;
  timeoutMs?: number;
  privacy?: 'normal' | 'strict';
  quality?: 'fast' | 'balanced' | 'accurate';
}

export interface ModelRoute {
  providerCode: string;
  capability: AiCapabilityKind;
  model: string;
  usePrimaryLlm: boolean;
}
