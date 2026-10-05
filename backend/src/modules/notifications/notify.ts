import { notifyUser as dispatch, type NotifyResult } from './notifications.orchestrator';
import type { ActionType, NotifyCommand } from './notifications.types';

export interface NotifyInput {
  userId: number;
  categoryCode: string;
  title: string;
  body: string;
  actionType?: ActionType;
  actionTarget?: string | null;
  data?: Record<string, unknown>;
  priority?: NotifyCommand['priority'];
  eventType?: string;
  marketplace?: NotifyCommand['marketplace'];
  entityType?: string | null;
  entityId?: string | number | null;
  deepLink?: string | null;
  groupKey?: string | null;
  eventId?: string | null;
  isSilent?: boolean;
  icon?: string | null;
  imageUrl?: string | null;
  variables?: Record<string, unknown>;
  expiresAt?: Date | string | null;
}

/**
 * Public facade used by marketplace modules. Channel fan-out is queued — this
 * never waits on SMS/email/push providers and never logs secrets.
 */
export async function notifyUser(input: NotifyInput): Promise<NotifyResult | void> {
  return dispatch({
    userId: input.userId,
    categoryCode: input.categoryCode,
    title: input.title,
    body: input.body,
    actionType: input.actionType,
    actionTarget: input.actionTarget,
    data: input.data,
    priority: input.priority,
    eventType: input.eventType,
    marketplace: input.marketplace,
    entityType: input.entityType,
    entityId: input.entityId ?? input.actionTarget,
    deepLink: input.deepLink,
    groupKey: input.groupKey,
    eventId: input.eventId,
    isSilent: input.isSilent,
    icon: input.icon,
    imageUrl: input.imageUrl,
    variables: input.variables,
    expiresAt: input.expiresAt,
  });
}
