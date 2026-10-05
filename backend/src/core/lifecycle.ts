import { loggerFor } from '../config/logger';

const log = loggerFor('lifecycle');

let shuttingDown = false;

/**
 * Whether the process has begun shutting down.
 *
 * The readiness probe consults this so a rolling deploy drains correctly: on
 * SIGTERM we start failing `/health/ready` immediately, the load balancer
 * removes this instance from rotation, and only then do we stop accepting
 * connections. Without the flip, the balancer keeps routing to a socket that is
 * already closing and users see connection resets during every deploy.
 */
export const isShuttingDown = (): boolean => shuttingDown;

export function beginShutdown(): void {
  shuttingDown = true;
}

/**
 * Runs `task`, but never lets shutdown hang forever.
 *
 * A keep-alive connection that never closes will stall `server.close()`
 * indefinitely, and the orchestrator's response is SIGKILL — which can land
 * mid-write. Bounding each phase means we finish on our own terms.
 */
export async function withTimeout(label: string, timeoutMs: number, task: () => Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
    timer.unref();
  });

  try {
    const outcome = await Promise.race([task().then(() => 'done' as const), timeout]);
    if (outcome === 'timeout') log.warn({ phase: label, timeoutMs }, 'shutdown phase timed out; continuing');
  } catch (error) {
    log.error({ err: error, phase: label }, 'shutdown phase failed; continuing');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
