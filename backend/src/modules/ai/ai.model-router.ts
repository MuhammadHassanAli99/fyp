import { env } from '../../config/env';
import { remember, cacheKeys } from '../../config/cache';
import { queryRows, type Row } from '../../db/query';
import type { AiCapabilityKind, AiTask, ModelRoute } from './ai.types';
import { CAPABILITY_BY_TASK } from './ai.types';

export interface ProviderRow {
  code: string;
  capability: string;
  modelDefault: string | null;
  priority: number;
  isActive: boolean;
  health: string;
  costIn: number | null;
  costOut: number | null;
}

const loadProviders = () =>
  remember(cacheKeys.aiProviders(), 60, async () => {
    const rows = await queryRows<Row>(
      `SELECT code, capability, model_default, priority, is_active, health_status,
              cost_per_1k_input, cost_per_1k_output
         FROM ai_providers
        WHERE is_active = 1
        ORDER BY priority ASC, id ASC`,
    );
    return rows.map(
      (row): ProviderRow => ({
        code: String(row.code),
        capability: String(row.capability),
        modelDefault: row.model_default ? String(row.model_default) : null,
        priority: Number(row.priority),
        isActive: Number(row.is_active) === 1,
        health: String(row.health_status ?? 'healthy'),
        costIn: row.cost_per_1k_input === null ? null : Number(row.cost_per_1k_input),
        costOut: row.cost_per_1k_output === null ? null : Number(row.cost_per_1k_output),
      }),
    );
  });

function capabilityFor(task: AiTask, requested?: AiCapabilityKind): AiCapabilityKind {
  if (requested) return requested;
  const mapped = CAPABILITY_BY_TASK[task];
  // Prediction has no provider enum row — use heuristic LLM slot for routing metadata.
  return mapped === 'prediction' ? 'llm' : mapped;
}

/**
 * Chooses provider + model from the database registry. Env remains the runtime
 * switch for whether a cloud driver is actually available.
 */
export async function selectModel(params: {
  task: AiTask;
  quality?: 'fast' | 'balanced' | 'accurate';
  privacy?: 'normal' | 'strict';
  capability?: AiCapabilityKind;
}): Promise<ModelRoute> {
  const capability = capabilityFor(params.task, params.capability);
  const providers = await loadProviders().catch(() => [] as ProviderRow[]);

  const preferLocal =
    params.privacy === 'strict' ||
    params.task === 'fraud_detect' ||
    params.task === 'spam_detect' ||
    params.task === 'duplicate_detect' ||
    params.task === 'image_enhance' ||
    env.AI_PROVIDER === 'heuristic' ||
    !env.AI_API_KEY;

  const ranked = providers
    .filter((row) => row.capability === capability && row.health !== 'down')
    .sort((a, b) => {
      if (preferLocal) {
        const localA = a.code === 'heuristic' ? 0 : 1;
        const localB = b.code === 'heuristic' ? 0 : 1;
        if (localA !== localB) return localA - localB;
      }
      if (params.quality === 'accurate') return a.priority - b.priority;
      if (params.quality === 'fast') {
        const fastA = a.code === 'heuristic' ? 0 : 1;
        const fastB = b.code === 'heuristic' ? 0 : 1;
        if (fastA !== fastB) return fastA - fastB;
      }
      return a.priority - b.priority;
    });

  const chosen = ranked[0];
  const usePrimaryLlm = Boolean(env.AI_API_KEY && env.AI_PROVIDER !== 'heuristic' && !preferLocal);

  if (!chosen) {
    return {
      providerCode: usePrimaryLlm ? env.AI_PROVIDER : 'heuristic',
      capability,
      model: usePrimaryLlm ? env.AI_MODEL : 'heuristic-v1',
      usePrimaryLlm,
    };
  }

  const cloud = chosen.code !== 'heuristic' && usePrimaryLlm;
  return {
    providerCode: cloud ? chosen.code : 'heuristic',
    capability,
    model: cloud ? (chosen.modelDefault ?? env.AI_MODEL) : (chosen.modelDefault ?? 'heuristic-v1'),
    usePrimaryLlm: cloud,
  };
}

export async function estimateCostUsd(providerCode: string, capability: string, promptTokens: number, completionTokens: number): Promise<number | null> {
  const providers = await loadProviders().catch(() => [] as ProviderRow[]);
  const row = providers.find((item) => item.code === providerCode && item.capability === capability);
  if (!row) return 0;
  const input = ((row.costIn ?? 0) * promptTokens) / 1000;
  const output = ((row.costOut ?? 0) * completionTokens) / 1000;
  return Number((input + output).toFixed(6));
}
