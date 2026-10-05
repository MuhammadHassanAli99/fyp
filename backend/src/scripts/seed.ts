import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { env } from '../config/env';

/**
 * Seed runner — applies `database/seeds/*.sql` in filename order.
 * Unlike migrations, seeds are idempotent where possible (INSERT IGNORE / ON DUPLICATE KEY).
 *
 * Two modes:
 *
 *   npm run db:seed              everything, refused in production
 *   npm run db:seed:production   reference + system data only, safe for production
 *
 * Production mode exists because the seeds mix two very different kinds of
 * data. Most of it is *required* for the application to function at all —
 * roles, permissions, marketplaces, currencies, categories, subscription
 * plans, notification templates. A fresh production database without it has no
 * roles and no marketplaces, so nobody can log in or list anything.
 *
 * Interleaved with that are demo accounts and fake listings, including staff
 * logins with a published password. Those must never reach production. Rather
 * than maintain a duplicate set of seed files that would drift, production mode
 * filters at statement level: any INSERT targeting a table that holds user or
 * listing data is skipped, and as a second line of defence any statement
 * mentioning a demo credential is skipped too.
 */

const SEEDS_DIR = path.resolve(process.cwd(), '..', 'database', 'seeds');

const args = process.argv.slice(2);
const productionMode = args.includes('--production');
const isDryRun = args.includes('--dry');

const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;

/** Statement-level rules live in ./seed-filter so they can be unit-tested. */
import { productionSkipReason } from './seed-filter';

/** Reuses the migration splitter — seeds use the same statement format. */
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
  return statements;
}

async function main(): Promise<void> {
  if (env.isProduction && !productionMode) {
    console.error(red('Refusing to run db:seed in production.'));
    console.error(dim('Use `npm run db:seed:production` to apply reference and system data only.'));
    process.exit(1);
  }

  if (productionMode) {
    console.log(yellow('Production seed mode: reference and system data only.'));
    console.log(dim('Demo accounts, demo companies and fake listings will be skipped.\n'));
  }

  if (!fs.existsSync(SEEDS_DIR)) {
    console.error(red(`Seeds directory not found: ${SEEDS_DIR}`));
    process.exit(1);
  }

  const files = fs
    .readdirSync(SEEDS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  if (files.length === 0) {
    console.log('No seed files found.');
    return;
  }

  const connection = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: false,
    charset: 'utf8mb4_0900_ai_ci',
  });

  try {
    await connection.query(
      `CREATE TABLE IF NOT EXISTS schema_seeds (
        filename   VARCHAR(255) NOT NULL,
        checksum   CHAR(64)     NOT NULL,
        applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (filename)
      ) ENGINE = InnoDB`,
    );

    const [appliedRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT filename, checksum FROM schema_seeds',
    );
    const applied = new Map(appliedRows.map((row) => [row.filename as string, row.checksum as string]));

    let appliedCount = 0;

    let skippedTotal = 0;

    for (const file of files) {
      const fullPath = path.join(SEEDS_DIR, file);
      const sql = fs.readFileSync(fullPath, 'utf8');

      const allStatements = splitStatements(sql);
      const statements: string[] = [];
      const skipped: string[] = [];

      for (const statement of allStatements) {
        const reason = productionMode ? productionSkipReason(statement) : null;
        if (reason) skipped.push(reason);
        else statements.push(statement);
      }

      /**
       * Checksum the statements we will actually run, not the file. Dev and
       * production modes therefore record different values, so switching modes
       * correctly re-applies rather than reporting "already applied".
       */
      const checksum = crypto.createHash('sha256').update(statements.join(';')).digest('hex');

      if (applied.get(file) === checksum) {
        console.log(dim(`· ${file} already applied`));
        continue;
      }

      if (statements.length === 0) {
        console.log(dim(`· ${file} nothing to apply in this mode (${skipped.length} statement(s) skipped)`));
        skippedTotal += skipped.length;
        continue;
      }

      process.stdout.write(`→ ${file} … `);

      if (isDryRun) {
        process.stdout.write(
          yellow(`dry run: would apply ${statements.length}, skip ${skipped.length}\n`),
        );
        skippedTotal += skipped.length;
        continue;
      }

      try {
        for (const statement of statements) {
          await connection.query(statement);
        }
      } catch (error) {
        process.stdout.write(red('failed\n'));
        const err = error as { sqlMessage?: string; message?: string };
        console.error(red(`\n  ${err.sqlMessage ?? err.message}`));
        process.exit(1);
      }

      await connection.query(
        'INSERT INTO schema_seeds (filename, checksum) VALUES (?, ?) ON DUPLICATE KEY UPDATE checksum = VALUES(checksum), applied_at = CURRENT_TIMESTAMP',
        [file, checksum],
      );

      process.stdout.write(
        green(`ok ${dim(`(${statements.length} statements${skipped.length > 0 ? `, ${skipped.length} skipped` : ''})`)}\n`),
      );
      skippedTotal += skipped.length;
      appliedCount += 1;
    }

    console.log(appliedCount > 0 ? green(`\nApplied ${appliedCount} seed file(s).`) : green('\nSeeds are up to date.'));
    if (productionMode) {
      console.log(dim(`${skippedTotal} demo statement(s) skipped.`));
      const [demoUsers] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@aurelia.test'",
      );
      const count = Number(demoUsers[0]?.n ?? 0);
      console.log(
        count === 0
          ? green('Verified: no demo accounts present in this database.')
          : red(`WARNING: ${count} demo account(s) with @aurelia.test emails exist in this database. Remove them before launch.`),
      );
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(red('Seed run failed:'), error);
  process.exit(1);
});
