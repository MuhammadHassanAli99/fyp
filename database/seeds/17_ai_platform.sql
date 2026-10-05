-- =============================================================================
-- 17  AI platform catalogue (idempotent)
--     Provider registry, granular entitlements, confidence thresholds,
--     notification category. Never gates on plan name.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

INSERT INTO features (code, name, description, unit, is_metered, reset_period, sort_order) VALUES
  ('generate_description', 'AI description generator', 'Generate listing copy from structured facts',     'boolean', FALSE, 'none', 91),
  ('enhance_image',        'AI image enhancement',     'Enhance listing photos without replacing originals','boolean', FALSE, 'none', 92),
  ('ai_search',            'AI search',                'Natural-language and semantic search assistance', 'boolean', FALSE, 'none', 93),
  ('ai_valuation',         'AI valuation',             'Price recommendation and marketplace valuations', 'boolean', FALSE, 'none', 94),
  ('ai_analytics',         'AI analytics',             'Market analysis summaries from real statistics',  'boolean', FALSE, 'none', 95),
  ('ai_support',           'AI customer support',      'In-app support agent with approved tools',         'boolean', FALSE, 'none', 96)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  unit = VALUES(unit),
  is_metered = VALUES(is_metered),
  reset_period = VALUES(reset_period),
  sort_order = VALUES(sort_order);

INSERT INTO plan_features (plan_id, feature_code, limit_value, is_unlimited, is_enabled)
SELECT p.id, f.code, NULL, FALSE, TRUE
  FROM subscription_plans p
  CROSS JOIN features f
 WHERE p.marketplace_id IS NULL
   AND p.is_active = 1
   AND f.code IN (
     'generate_description','enhance_image','ai_search',
     'ai_valuation','ai_analytics','ai_support'
   )
ON DUPLICATE KEY UPDATE is_enabled = TRUE;

INSERT INTO ai_providers
  (code, name, capability, model_default, is_active, priority, cost_per_1k_input, cost_per_1k_output, currency, health_status)
VALUES
  ('heuristic', 'On-device heuristics', 'llm', 'heuristic-v1', TRUE, 80, 0, 0, 'USD', 'healthy'),
  ('heuristic', 'On-device heuristics', 'embedding', 'heuristic-hash-embed-v1', TRUE, 80, 0, 0, 'USD', 'healthy'),
  ('heuristic', 'On-device heuristics', 'moderation', 'heuristic-moderation-v1', TRUE, 20, 0, 0, 'USD', 'healthy'),
  ('heuristic', 'On-device heuristics', 'translation', 'heuristic-passthrough-v1', TRUE, 90, 0, 0, 'USD', 'healthy'),
  ('heuristic', 'On-device heuristics', 'image_enhancement', 'heuristic-enhance-v1', TRUE, 40, 0, 0, 'USD', 'healthy'),
  ('openai-compatible', 'OpenAI-compatible LLM', 'llm', 'gpt-4o-mini', TRUE, 10, 0.150000, 0.600000, 'USD', 'healthy'),
  ('openai-compatible', 'OpenAI-compatible vision', 'vision', 'gpt-4o-mini', TRUE, 10, 0.150000, 0.600000, 'USD', 'healthy'),
  ('openai-compatible', 'OpenAI-compatible embeddings', 'embedding', 'text-embedding-3-small', TRUE, 10, 0.020000, 0, 'USD', 'healthy'),
  ('openai-compatible', 'OpenAI-compatible translation', 'translation', 'gpt-4o-mini', TRUE, 10, 0.150000, 0.600000, 'USD', 'healthy'),
  ('openai-compatible', 'OpenAI-compatible moderation', 'moderation', 'gpt-4o-mini', TRUE, 40, 0.150000, 0.600000, 'USD', 'healthy'),
  ('openai-compatible', 'OpenAI-compatible speech', 'speech_to_text', 'whisper-1', TRUE, 10, 0.006000, 0, 'USD', 'healthy')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  model_default = VALUES(model_default),
  is_active = VALUES(is_active),
  priority = VALUES(priority),
  cost_per_1k_input = VALUES(cost_per_1k_input),
  cost_per_1k_output = VALUES(cost_per_1k_output),
  health_status = VALUES(health_status);

INSERT INTO ai_confidence_thresholds (capability, high_min, medium_min, auto_action, notes) VALUES
  ('description_generate', 70, 40, 'allow', 'Seller always reviews copy before publish'),
  ('image_enhance', 75, 50, 'none', 'User must preview; original is never overwritten'),
  ('duplicate_detect', 98, 82, 'review', 'Never auto-delete. Exact match may reject publish'),
  ('spam_detect', 85, 35, 'review', 'ALLOW / REVIEW / REJECT from combined score'),
  ('fraud_detect', 90, 55, 'review', 'AI is never the sole irreversible authority'),
  ('price_recommend', 70, 45, 'none', 'Range + explanation; not a guaranteed price'),
  ('property_valuation', 70, 45, 'none', 'Not a professional surveyed valuation'),
  ('vehicle_estimate', 70, 45, 'none', 'Not a guaranteed trade-in or retail price'),
  ('gold_trend', 65, 40, 'none', 'Forecast vs historical vs current must stay distinct'),
  ('market_analysis', 80, 50, 'allow', 'LLM may summarise stats, never invent them'),
  ('translate', 80, 40, 'allow', 'Cache only non-sensitive repeated text'),
  ('smart_search', 60, 30, 'allow', 'Keyword search is the default path'),
  ('recommend', 55, 30, 'allow', 'Cold-start falls back to trending'),
  ('chat_support', 70, 45, 'none', 'Sensitive tools require auth and confirmation')
ON DUPLICATE KEY UPDATE
  high_min = VALUES(high_min),
  medium_min = VALUES(medium_min),
  auto_action = VALUES(auto_action),
  notes = VALUES(notes);

INSERT INTO moderation_policies (code, name, entity_type, description, rules, auto_action, threshold, is_active, version)
VALUES
  ('ai.spam.listing', 'Listing spam', 'listing', 'Combined rules + ML + velocity',
   JSON_OBJECT('review', 0.35, 'reject', 0.85), 'flag', 0.3500, TRUE, 1),
  ('ai.duplicate.listing', 'Listing duplicate', 'listing', 'Multi-signal duplicate review',
   JSON_OBJECT('review', 0.82, 'reject', 0.98), 'hold', 0.8200, TRUE, 1)
ON DUPLICATE KEY UPDATE
  rules = VALUES(rules),
  threshold = VALUES(threshold),
  auto_action = VALUES(auto_action),
  is_active = VALUES(is_active);

INSERT INTO notification_categories
  (code, name, description, group_code, default_push, default_email, default_sms, default_in_app, is_transactional, policy_group, marketplace_scope, sort_order, is_active)
VALUES
  ('ai.job', 'AI job', 'Long-running AI job finished', 'system', TRUE, FALSE, FALSE, TRUE, FALSE, 'SYSTEM', 'GENERAL', 40, TRUE)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  is_active = VALUES(is_active);

INSERT INTO notification_templates
  (category_code, channel, language, subject, title, body, action_url, variables, is_active, version)
VALUES
  ('ai.job', 'in_app', 'en', 'AI job {{status}}', 'AI {{feature}} {{status}}', '{{summary}}', '/ai/jobs/{{jobUuid}}',
   '["status","feature","summary","jobUuid"]', TRUE, 1),
  ('ai.job', 'push', 'en', 'AI job {{status}}', 'AI {{feature}} {{status}}', '{{summary}}', '/ai/jobs/{{jobUuid}}',
   '["status","feature","summary","jobUuid"]', TRUE, 1)
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  body = VALUES(body),
  is_active = VALUES(is_active);
