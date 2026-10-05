import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool, type Executor, type PoolConnection } from './pool';
import { fromDatabaseError, notFound } from '../core/errors';
import { loggerFor } from '../config/logger';
import { env } from '../config/env';

const log = loggerFor('db.query');
const SLOW_QUERY_MS = 300;

export type Row = RowDataPacket;
export type Params = ReadonlyArray<unknown>;

const run = async <T>(executor: Executor, sql: string, params: Params, label: string): Promise<T> => {
  const startedAt = performance.now();
  try {
    const [result] = await executor.query(sql, params as unknown[]);
    return result as T;
  } catch (error) {
    log.error({ err: error, sql: env.isProduction ? undefined : sql, label }, 'query failed');
    throw fromDatabaseError(error);
  } finally {
    const durationMs = performance.now() - startedAt;
    if (durationMs > SLOW_QUERY_MS) {
      log.warn({ durationMs: Math.round(durationMs), label, sql: env.isProduction ? undefined : sql }, 'slow query');
    }
  }
};

/** Multiple rows. */
export const queryRows = async <T extends Row = Row>(
  sql: string,
  params: Params = [],
  executor: Executor = pool,
): Promise<T[]> => run<T[]>(executor, sql, params, 'rows');

/** First row or null. */
export const queryOne = async <T extends Row = Row>(
  sql: string,
  params: Params = [],
  executor: Executor = pool,
): Promise<T | null> => {
  const rows = await run<T[]>(executor, sql, params, 'one');
  return rows[0] ?? null;
};

/** First row, or a 404 — removes the `if (!row) throw` boilerplate everywhere. */
export const queryOneOrFail = async <T extends Row = Row>(
  sql: string,
  params: Params = [],
  resource = 'Resource',
  executor: Executor = pool,
): Promise<T> => {
  const row = await queryOne<T>(sql, params, executor);
  if (!row) throw notFound(resource);
  return row;
};

/** A single scalar, e.g. `SELECT COUNT(*) AS value FROM ...`. */
export const queryScalar = async <T>(sql: string, params: Params = [], executor: Executor = pool): Promise<T | null> => {
  const row = await queryOne(sql, params, executor);
  if (!row) return null;
  const first = Object.values(row)[0];
  return (first ?? null) as T | null;
};

export const queryCount = async (sql: string, params: Params = [], executor: Executor = pool): Promise<number> =>
  Number((await queryScalar<number | string>(sql, params, executor)) ?? 0);

/** INSERT/UPDATE/DELETE. */
export const execute = async (sql: string, params: Params = [], executor: Executor = pool): Promise<ResultSetHeader> =>
  run<ResultSetHeader>(executor, sql, params, 'execute');

export const insertAndGetId = async (sql: string, params: Params = [], executor: Executor = pool): Promise<number> => {
  const result = await execute(sql, params, executor);
  return result.insertId;
};

export const affectedRows = async (sql: string, params: Params = [], executor: Executor = pool): Promise<number> => {
  const result = await execute(sql, params, executor);
  return result.affectedRows;
};

/* -------------------------------------------------------------------------- */
/* Transactions                                                               */
/* -------------------------------------------------------------------------- */

export interface TransactionOptions {
  /** Retry once on deadlock — cheap insurance for hot counter updates. */
  retryOnDeadlock?: boolean;
  isolation?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
}

/**
 * Runs `fn` inside a transaction, passing the connection so every statement
 * enlists. Always pass this connection down to repositories — a stray `pool`
 * call inside a transaction silently escapes it.
 */
export async function transaction<T>(
  fn: (connection: PoolConnection) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const attempt = async (): Promise<T> => {
    const connection = await pool.getConnection();
    try {
      if (options.isolation) {
        await connection.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolation}`);
      }
      await connection.beginTransaction();
      const result = await fn(connection);
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        log.error({ err: rollbackError }, 'rollback failed');
      }
      throw error;
    } finally {
      connection.release();
    }
  };

  try {
    return await attempt();
  } catch (error) {
    const isDeadlock =
      (error as { code?: string })?.code === 'CONCURRENT_MODIFICATION' ||
      (error as { code?: string })?.code === 'ER_LOCK_DEADLOCK';
    if (options.retryOnDeadlock && isDeadlock) {
      log.warn('retrying transaction after deadlock');
      return attempt();
    }
    throw error;
  }
}
