import type { Request } from 'express';
import { sha256 } from '../../core/security/crypto';
import { assertFeature, consumeQuota, releaseQuota } from '../../middleware/entitlements';
import { AppError, ErrorCode, unauthenticated } from '../../core/errors';
import { orchestrate, insertQueuedJob, type Orchestrated } from './ai.orchestrator';
import { selectModel } from './ai.model-router';
import { ENTITLEMENT_BY_TASK, type AiTask, type OrchestratorRequest } from './ai.types';
import type { AiDriver } from '../../providers/ai/types';

export interface GatewayOptions<T> extends Omit<OrchestratorRequest<unknown>, 'userId'> {
  task: AiTask;
  run: (driver: AiDriver) => Promise<T>;
}

function actorId(req: Request | { userId: number }): number {
  if ('userId' in req && typeof req.userId === 'number') return req.userId;
  const userId = (req as Request).auth?.userId;
  if (!userId) throw unauthenticated();
  return userId;
}

/**
 * Every user-facing AI call: auth (caller), entitlement, quota, then orchestrator.
 */
export async function throughGateway<T>(
  req: Request | { userId: number },
  options: GatewayOptions<T>,
): Promise<Orchestrated<T> | { accepted: true; jobUuid: string; status: 'queued' }> {
  const userId = actorId(req);
  await assertFeature(userId, 'ai_tools');
  const extra = ENTITLEMENT_BY_TASK[options.task];
  if (extra) await assertFeature(userId, extra);
  await consumeQuota(userId, 'ai_operations');
  try {
    if (options.async) {
      const route = await selectModel({
        task: options.task,
        quality: options.quality,
        privacy: options.privacy,
      });
      const queued = await insertQueuedJob({
        task: options.task,
        userId,
        entityType: options.entityType,
        entityId: options.entityId,
        marketplaceId: options.marketplaceId,
        language: options.language,
        input: options.input,
        idempotencyKey: options.idempotencyKey ?? null,
        provider: route.providerCode,
        model: route.model,
      });
      return { accepted: true, jobUuid: queued.uuid, status: 'queued' };
    }
    return await orchestrate<T>(
      {
        ...options,
        userId,
        skipEntitlement: true,
        skipQuota: true,
      },
      options.run,
    );
  } catch (error) {
    await releaseQuota(userId, 'ai_operations').catch(() => undefined);
    throw error;
  }
}

export function idempotencyKey(userId: number, task: AiTask, parts: unknown): string {
  return sha256(`ai:${userId}:${task}:${JSON.stringify(parts)}`).slice(0, 120);
}

export function requireConfidence(meta: { band: string }, allowLow = true): void {
  if (!allowLow && meta.band === 'low') {
    throw new AppError('AI is not confident enough to continue. Please add more information.', {
      status: 422,
      code: ErrorCode.UNPROCESSABLE,
      expected: true,
    });
  }
}
