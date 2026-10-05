import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { env } from '../config/env';

/**
 * Migration runner.
 *
 * - Applies `database/migrations/*.sql` in filename order.
 * - Records each file in `schema_migrations` with a checksum, so an edited
 *   migration is detected instead of silently diverging from production.
 * - Splits on `;` at statement level while respecting strings and comments,
 *   because `multipleStatements` is off in the app pool and we do not want to
 *   enable it just for migrations.
 *
 * Usage:
 *   npm run db:migrate            apply pending
 *   npm run db:migrate -- --fresh drop and recreate the database first
 *   npm run db:migrate -- --dry   list pending without applying
 *   npm run db:migrate -- --check verify applied checksums and pending files (no writes)
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), '..', 'database', 'migrations');
const args = process.argv.slice(2);
const isFresh = args.includes('--fresh');
const isDryRun = args.includes('--dry');
const isCheck = args.includes('--check');

const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;

/** Splits a SQL file into individual statements. */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]!;
    const next = sql[i + 1];

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      current += char;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        current += '*/';
        i += 1;
        continue;
      }
      current += char;
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick) {
      if (char === '-' && next === '-') {
        inLineComment = true;
        current += char;
        continue;
      }
      if (char === '#') {
        inLineComment = true;
        current += char;
        continue;
      }
      if (char === '/' && next === '*') {
        inBlockComment = true;
        current += '/*';
        i += 1;
        continue;
      }
    }

    if (char === "'" && !inDouble && !inBacktick && sql[i - 1] !== '\\') inSingle = !inSingle;
    else if (char === '"' && !inSingle && !inBacktick && sql[i - 1] !== '\\') inDouble = !inDouble;
    else if (char === '`' && !inSingle && !inDouble) inBacktick = !inBacktick;

    if (char === ';' && !inSingle && !inDouble && !inBacktick) {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      continue;
    }
    current += char;
  }

  const tail = current.trim();
  if (tail.length > 0 && !/^(--|#)/.test(tail)) statements.push(tail);
  return statements.filter((statement) => stripComments(statement).length > 0);
}

const stripComments = (statement: string): string =>
  statement
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)(--\s.*|#.*)$/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();

async function main(): Promise<void> {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(red(`Migrations directory not found: ${MIGRATIONS_DIR}`));
    process.exit(1);
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  if (files.length === 0) {
    console.log(yellow('No migration files found.'));
    return;
  }

  // Connect without a database: migration 001 creates it.
  const connection = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    multipleStatements: false,
    charset: 'utf8mb4_0900_ai_ci',
  });

  try {
    if (isFresh) {
      if (env.isProduction) {
        console.error(red('Refusing to run --fresh in production.'));
        process.exit(1);
      }
      console.log(yellow(`Dropping database "${env.DB_NAME}"…`));
      await connection.query(`DROP DATABASE IF EXISTS \`${env.DB_NAME}\``);
    }

    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    await connection.query(`USE \`${env.DB_NAME}\``);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     VARCHAR(64)  NOT NULL,
        name        VARCHAR(255) NOT NULL,
        checksum    CHAR(64)     NULL,
        applied_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        duration_ms INT UNSIGNED NULL,
        PRIMARY KEY (version)
      ) ENGINE = InnoDB
    `);

    const [appliedRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const applied = new Map(appliedRows.map((row) => [row.version as string, row.checksum as string | null]));

    let appliedCount = 0;

    for (const file of files) {
      const version = file.split('_')[0] ?? file;
      const fullPath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(fullPath, 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');

      if (applied.has(version)) {
        const previous = applied.get(version);
        if (previous && previous !== checksum) {
          console.log(yellow(`~ ${file} already applied but its contents changed (checksum mismatch)`));
          if (env.isProduction || isCheck) {
            console.error(red(`Checksum mismatch is a deployment integrity failure: ${file}`));
            process.exit(1);
          }
        } else {
          console.log(dim(`· ${file} already applied`));
        }
        continue;
      }

      const statements = splitStatements(sql);
      if (isDryRun || isCheck) {
        console.log(yellow(`→ ${file} (${statements.length} statements) — ${isCheck ? 'pending' : 'dry run, not applied'}`));
        continue;
      }

      const startedAt = Date.now();
      process.stdout.write(`→ ${file} … `);

      try {
        for (const statement of statements) {
          await connection.query(statement);
        }
      } catch (error) {
        process.stdout.write(red('failed\n'));
        const err = error as { sqlMessage?: string; message?: string; sql?: string };
        console.error(red(`\n  ${err.sqlMessage ?? err.message}`));
        if (err.sql) console.error(dim(`\n  Statement:\n  ${err.sql.slice(0, 900)}`));
        process.exit(1);
      }

      const durationMs = Date.now() - startedAt;
      await connection.query('INSERT INTO schema_migrations (version, name, checksum, duration_ms) VALUES (?, ?, ?, ?)', [
        version,
        file,
        checksum,
        durationMs,
      ]);
      process.stdout.write(green(`ok ${dim(`(${statements.length} statements, ${durationMs}ms)`)}\n`));
      appliedCount += 1;
    }

    const [tableCount] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ?',
      [env.DB_NAME],
    );

    if (isCheck) {
      const pending = files.filter((file) => !applied.has(file.split('_')[0] ?? file));
      if (pending.length > 0) {
        console.error(red(`\n${pending.length} pending migration(s). Run npm run db:migrate.`));
        process.exit(1);
      }
      console.log(green('\nMigration integrity check passed.'));
      return;
    }

    console.log(
      appliedCount > 0
        ? green(`\nApplied ${appliedCount} migration(s). Database "${env.DB_NAME}" now has ${tableCount[0]?.total} tables.`)
        : green(`\nDatabase "${env.DB_NAME}" is up to date (${tableCount[0]?.total} tables).`),
    );
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(red('Migration run failed:'), error);
  process.exit(1);
});
