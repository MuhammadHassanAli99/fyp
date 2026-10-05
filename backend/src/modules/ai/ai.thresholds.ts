import { remember, cacheKeys } from '../../config/cache';
import { queryRows, type Row } from '../../db/query';
import type { AiTask, ConfidenceBand } from './ai.types';

export interface Threshold {
  highMin: number;
  mediumMin: number;
  autoAction: 'none' | 'allow' | 'review' | 'reject';
}

const DEFAULT: Threshold = { highMin: 80, mediumMin: 50, autoAction: 'none' };

export async function loadThresholds(): Promise<Record<string, Threshold>> {
  return remember(cacheKeys.aiThresholds(), 120, async () => {
    const rows = await queryRows<Row>(
      'SELECT capability, high_min, medium_min, auto_action FROM ai_confidence_thresholds',
    );
    const map: Record<string, Threshold> = {};
    for (const row of rows) {
      map[String(row.capability)] = {
        highMin: Number(row.high_min),
        mediumMin: Number(row.medium_min),
        autoAction: (row.auto_action as Threshold['autoAction']) ?? 'none',
      };
    }
    return map;
  }).catch(() => ({} as Record<string, Threshold>));
}

export async function thresholdFor(task: AiTask | string): Promise<Threshold> {
  const all = await loadThresholds();
  return all[task] ?? DEFAULT;
}

export function bandFor(confidence: number, threshold: Threshold): ConfidenceBand {
  if (confidence >= threshold.highMin) return 'high';
  if (confidence >= threshold.mediumMin) return 'medium';
  return 'low';
}
