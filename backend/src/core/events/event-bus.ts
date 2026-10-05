import type { PoolConnection } from '../../db/pool';
import { execute } from '../../db/query';
import { loggerFor } from '../../config/logger';
import { uuid } from '../security/crypto';
import { getContext } from '../context';
import type { DomainEventName, DomainEventPayloads } from './domain-events';

const log = loggerFor('events');

export interface DomainEvent<K extends DomainEventName = DomainEventName> {
  id: string;
  name: K;
  aggregateType: string;
  aggregateId: string;
  payload: DomainEventPayloads[K];
  occurredAt: Date;
  requestId?: string;
  actorId?: number | null;
}

type Handler<K extends DomainEventName> = (event: DomainEvent<K>) => Promise<void> | void;

/**
 * In-process event bus with a transactional outbox.
 *
 * Services call `publish` with the *transaction connection*: the event row is
 * written in the same transaction as the state change, so a crash between
 * "listing published" and "alert sent" can never lose the alert. Dispatch to
 * in-process handlers happens after commit; the outbox worker retries anything
 * that failed.
 *
 * Handlers must be side-effect-only and must never throw into the caller — a
 * failed analytics write must not roll back a successful publish.
 */
class EventBus {
  private readonly handlers = new Map<string, Handler<DomainEventName>[]>();

  on<K extends DomainEventName>(name: K, handler: Handler<K>): void {
    const existing = this.handlers.get(name) ?? [];
    existing.push(handler as Handler<DomainEventName>);
    this.handlers.set(name, existing);
  }

  /** Persist the event inside the caller's transaction. Nothing is dispatched yet. */
  async enqueue<K extends DomainEventName>(
    connection: PoolConnection,
    name: K,
    aggregateType: string,
    aggregateId: string | number,
    payload: DomainEventPayloads[K],
  ): Promise<DomainEvent<K>> {
    const context = getContext();
    const event: DomainEvent<K> = {
      id: uuid(),
      name,
      aggregateType,
      aggregateId: String(aggregateId),
      payload,
      occurredAt: new Date(),
      requestId: context?.requestId,
      actorId: context?.userId ?? null,
    };

    await execute(
      `INSERT INTO outbox_events (event_id, event_name, aggregate_type, aggregate_id, payload)
       VALUES (?, ?, ?, ?, ?)`,
      [event.id, name, aggregateType, event.aggregateId, JSON.stringify({ ...payload, _requestId: event.requestId, _actorId: event.actorId })],
      connection,
    );

    return event;
  }

  /** Persist + return an event when the caller has no open transaction. */
  async enqueueNow<K extends DomainEventName>(
    name: K,
    aggregateType: string,
    aggregateId: string | number,
    payload: DomainEventPayloads[K],
  ): Promise<DomainEvent<K>> {
    const context = getContext();
    const event: DomainEvent<K> = {
      id: uuid(),
      name,
      aggregateType,
      aggregateId: String(aggregateId),
      payload,
      occurredAt: new Date(),
      requestId: context?.requestId,
      actorId: context?.userId ?? null,
    };

    await execute(
      `INSERT INTO outbox_events (event_id, event_name, aggregate_type, aggregate_id, payload)
       VALUES (?, ?, ?, ?, ?)`,
      [
        event.id,
        name,
        aggregateType,
        event.aggregateId,
        JSON.stringify({ ...payload, _requestId: event.requestId, _actorId: event.actorId }),
      ],
    );

    return event;
  }

  /**
   * Dispatch to in-process handlers. Call after the transaction commits.
   * Errors are swallowed and left for the outbox worker to retry.
   */
  async dispatch<K extends DomainEventName>(event: DomainEvent<K>): Promise<void> {
    const handlers = this.handlers.get(event.name);
    if (!handlers || handlers.length === 0) {
      await this.markProcessed(event.id);
      return;
    }

    const results = await Promise.allSettled(handlers.map((handler) => handler(event as DomainEvent<DomainEventName>)));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    if (failures.length === 0) {
      await this.markProcessed(event.id);
      return;
    }

    log.error(
      { event: event.name, eventId: event.id, failed: failures.length, total: handlers.length, err: failures[0]?.reason },
      'event handler(s) failed; left for outbox retry',
    );
    await this.markFailed(event.id, failures[0]?.reason);
  }

  /** Convenience for the common "write then dispatch" shape. */
  async publishAfterCommit<K extends DomainEventName>(event: DomainEvent<K>): Promise<void> {
    // Fire and forget: request latency must not depend on side effects.
    void this.dispatch(event).catch((error) => log.error({ err: error, event: event.name }, 'dispatch crashed'));
  }

  private async markProcessed(eventId: string): Promise<void> {
    try {
      await execute(
        `UPDATE outbox_events SET status = 'done', processed_at = CURRENT_TIMESTAMP WHERE event_id = ?`,
        [eventId],
      );
    } catch (error) {
      log.error({ err: error, eventId }, 'could not mark event processed');
    }
  }

  private async markFailed(eventId: string, reason: unknown): Promise<void> {
    const message = reason instanceof Error ? reason.message : String(reason);
    try {
      await execute(
        `UPDATE outbox_events
            SET status = IF(attempts + 1 >= 5, 'failed', 'pending'),
                attempts = attempts + 1,
                last_error = ?,
                available_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL POW(2, attempts) * 30 SECOND)
          WHERE event_id = ?`,
        [message.slice(0, 2000), eventId],
      );
    } catch (error) {
      log.error({ err: error, eventId }, 'could not mark event failed');
    }
  }

  registeredEvents(): string[] {
    return [...this.handlers.keys()];
  }
}

export const eventBus = new EventBus();
