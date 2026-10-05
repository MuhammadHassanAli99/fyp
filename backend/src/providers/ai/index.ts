import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { HeuristicAiDriver } from './heuristic.driver';
import { OpenAiCompatibleDriver } from './openai.driver';
import type { AiDriver } from './types';

const log = loggerFor('ai');

/**
 * Provider drivers only. Usage/audit is recorded by the AI Orchestrator so we
 * do not double-write ai_jobs when capabilities run through the Gateway.
 */
const heuristic = new HeuristicAiDriver();

const primary: AiDriver = (() => {
  if (env.AI_PROVIDER === 'heuristic') return heuristic;
  if (env.AI_API_KEY) return new OpenAiCompatibleDriver();
  log.warn({ provider: env.AI_PROVIDER }, 'AI provider configured without AI_API_KEY; using heuristic driver');
  return heuristic;
})();

log.info({ driver: primary.name, fallback: heuristic.name }, 'AI provider initialised');

export async function runWithFallback<T>(run: (driver: AiDriver) => Promise<T>): Promise<T> {
  try {
    return await run(primary);
  } catch (error) {
    log.warn({ err: error, driver: primary.name }, 'primary AI driver failed, falling back');
    if (primary === heuristic) throw error;
    return run(heuristic);
  }
}

export const ai = {
  driverName: primary.name,
  generateDescription: (request: Parameters<AiDriver['generateDescription']>[0]) =>
    runWithFallback((driver) => driver.generateDescription(request)),
  compareListings: (request: Parameters<AiDriver['compareListings']>[0]) =>
    runWithFallback((driver) => driver.compareListings(request)),
  recommendPrice: (request: Parameters<AiDriver['recommendPrice']>[0]) =>
    runWithFallback((driver) => driver.recommendPrice(request)),
  interpretSearch: (request: Parameters<AiDriver['interpretSearch']>[0]) =>
    runWithFallback((driver) => driver.interpretSearch(request)),
  translate: (request: Parameters<AiDriver['translate']>[0]) =>
    runWithFallback((driver) => driver.translate(request)),
  chat: (request: Parameters<AiDriver['chat']>[0]) => runWithFallback((driver) => driver.chat(request)),
  moderate: (request: Parameters<AiDriver['moderate']>[0]) =>
    runWithFallback((driver) => driver.moderate(request)),
  embed: (request: Parameters<AiDriver['embed']>[0]) => runWithFallback((driver) => driver.embed(request)),
};

export type { AiDriver } from './types';
