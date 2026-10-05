import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { env } from '../config/env';
import { loggerFor } from '../config/logger';

const log = loggerFor('db');

/**
 * TLS options for the MySQL connection.
 *
 * `required` verifies the server certificate, which is the only mode that
 * actually defends against an in-path attacker. `required-no-verify` still
 * encrypts and is the realistic setting for managed providers that present a
 * certificate for an internal hostname.
 *
 * DB_SSL_CA accepts either inline PEM or a path, because secret managers hand
 * you the former and container images tend to mount the latter.
 */
function sslOptions(): mysql.PoolOptions['ssl'] {
  if (env.DB_SSL_MODE === 'disabled') return undefined;
  if (env.DB_SSL_MODE === 'required-no-verify') return { rejectUnauthorized: false };

  const ca = env.DB_SSL_CA;
  if (!ca) return { rejectUnauthorized: true };

  const pem = ca.includes('-----BEGIN') ? ca.replace(/\\n/g, '\n') : fs.readFileSync(ca, 'utf8');
  return { ca: pem, rejectUnauthorized: true };
}

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  ssl: sslOptions(),
  waitForConnections: true,
  connectionLimit: env.DB_POOL_SIZE,
  maxIdle: env.DB_POOL_SIZE,
  idleTimeout: 60_000,
  queueLimit: 0,
  connectTimeout: env.DB_CONNECT_TIMEOUT_MS,
  timezone: env.DB_TIMEZONE,
  charset: 'utf8mb4_0900_ai_ci',
  namedPlaceholders: false,
  /**
   * DECIMAL columns must not become JS floats — money would silently lose
   * precision. Return them as strings and convert at the domain boundary.
   */
  decimalNumbers: false,
  supportBigNumbers: true,
  bigNumberStrings: false,
  dateStrings: false,
  multipleStatements: false,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
});

export type Pool = typeof pool;
export type PoolConnection = mysql.PoolConnection;
/** Anything that can run a query: the pool, or a connection inside a transaction. */
export type Executor = Pick<mysql.Pool, 'query' | 'execute'> | Pick<mysql.PoolConnection, 'query' | 'execute'>;

export async function verifyConnection(): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.query('SELECT 1');
    const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT VERSION() AS version');
    log.info(
      { version: rows[0]?.version, database: env.DB_NAME, tls: env.DB_SSL_MODE },
      'database connected',
    );
  } finally {
    connection.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
  log.info('database pool closed');
}
