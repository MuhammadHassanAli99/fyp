import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import mysql from 'mysql2/promise';
import { env } from '../config/env';

/**
 * Migration checksum reconciliation.
 *
 * The problem this solves: several migrations were edited after they had
 * already been applied to a database. `schema_migrations.checksum` therefore
 * records the hash of the *old* file, while the file on disk hashes to
 * something else. Consequences:
 *
 *   - `npm run db:migrate:check` exits non-zero forever, so CI cannot gate a
 *     deploy on migration integrity.
 *   - `assertDatabaseCompatible()` refuses to boot in production
 *     (src/core/schema-compatibility.ts), so such a database can never be
 *     promoted.
 *
 * The tempting fix is `db:reset`, which destroys all data. This tool is the
 * non-destructive alternative: it only ever runs
 * `UPDATE schema_migrations SET checksum = ?`. It issues no DDL, touches no
 * application table, and deletes nothing.
 *
 * A hash cannot prove the edited file is equivalent to what was applied, so the
 * tool does not pretend to: it gathers evidence (every table and column the
 * migration files declare, checked against information_schema), shows the
 * operator exactly what it found, and requires an explicit typed confirmation
 * before re-recording. Every run writes a JSON report for the audit trail.
 *
 * Usage:
 *   npm run db:checksums                  report drift and verify schema (read-only)
 *   npm run db:checksums -- --verify      alias for the above, exits 1 on drift
 *   npm run db:checksums -- --reconcile   re-record checksums after confirmation
 *   npm run db:checksums -- --reconcile --yes   skip the prompt (for a runbook)
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), '..', 'database', 'migrations');

const args = process.argv.slice(2);
const shouldReconcile = args.includes('--reconcile');
const assumeYes = args.includes('--yes');
const onlyVersions = args
  .filter((arg) => arg.startsWith('--only='))
  .flatMap((arg) => arg.slice('--only='.length).split(','))
  .map((value) => value.trim())
  .filter(Boolean);

const green = (t: string) => `\x1b[32m${t}\x1b[0m`;
const red = (t: string) => `\x1b[31m${t}\x1b[0m`;
const yellow = (t: string) => `\x1b[33m${t}\x1b[0m`;
const dim = (t: string) => `\x1b[2m${t}\x1b[0m`;
const bold = (t: string) => `\x1b[1m${t}\x1b[0m`;

interface MigrationFile {
  version: string;
  name: string;
  checksum: string;
  declaredTables: Map<string, Set<string>>;
}

/**
 * Extracts the tables and columns a migration declares.
 *
 * Deliberately shallow: this is corroborating evidence that the migration ran,
 * not a schema differ. It reads `CREATE TABLE` bodies and `ADD COLUMN` clauses
 * and ignores everything else, so a false negative (a column we failed to
 * parse) is safe — it simply is not checked.
 */
function parseDeclaredSchema(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)(--\s.*|#.*)$/gm, '');

  const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(/gi;
  for (let match = createRe.exec(withoutComments); match; match = createRe.exec(withoutComments)) {
    const table = match[1]!.toLowerCase();
    const body = extractBalanced(withoutComments, createRe.lastIndex - 1);
    if (body === null) continue;

    const columns = new Set<string>();
    for (const line of splitTopLevel(body)) {
      const columnMatch = /^[`"]?(\w+)[`"]?\s+(?:BIGINT|INT|TINYINT|SMALLINT|MEDIUMINT|VARCHAR|CHAR|TEXT|LONGTEXT|MEDIUMTEXT|TINYTEXT|DECIMAL|NUMERIC|FLOAT|DOUBLE|DATE|DATETIME|TIMESTAMP|TIME|YEAR|JSON|BLOB|LONGBLOB|MEDIUMBLOB|TINYBLOB|ENUM|SET|BOOLEAN|BOOL|BIT|BINARY|VARBINARY|GEOMETRY|POINT)/i.exec(
        line.trim(),
      );
      if (columnMatch) columns.add(columnMatch[1]!.toLowerCase());
    }
    tables.set(table, columns);
  }

  const alterRe = /ALTER\s+TABLE\s+[`"]?(\w+)[`"]?([\s\S]*?);/gi;
  for (let match = alterRe.exec(withoutComments); match; match = alterRe.exec(withoutComments)) {
    const table = match[1]!.toLowerCase();
    const clause = match[2] ?? '';
    const existing = tables.get(table) ?? new Set<string>();
    const addRe = /ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s+(?!KEY|INDEX|CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|FULLTEXT|SPATIAL)/gi;
    for (let add = addRe.exec(clause); add; add = addRe.exec(clause)) {
      existing.add(add[1]!.toLowerCase());
    }
    if (existing.size > 0) tables.set(table, existing);
  }

  return tables;
}

/** Returns the contents of a parenthesised group starting at `openIndex`. */
function extractBalanced(text: string, openIndex: number): string | null {
  if (text[openIndex] !== '(') return null;
  let depth = 0;
  let inSingle = false;
  let inBacktick = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === "'" && text[i - 1] !== '\\' && !inBacktick) inSingle = !inSingle;
    else if (char === '`' && !inSingle) inBacktick = !inBacktick;
    if (inSingle || inBacktick) continue;
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, i);
    }
  }
  return null;
}

/** Splits a CREATE TABLE body on commas that are not inside parentheses. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let inSingle = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]!;
    if (char === "'" && body[i - 1] !== '\\') inSingle = !inSingle;
    if (!inSingle) {
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      else if (char === ',' && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function loadMigrationFiles(): MigrationFile[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
      return {
        version: name.split('_')[0] ?? name,
        name,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
        declaredTables: parseDeclaredSchema(sql),
      };
    });
}

async function main(): Promise<void> {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(red(`Migrations directory not found: ${MIGRATIONS_DIR}`));
    process.exit(1);
  }

  const files = loadMigrationFiles();
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
    console.log(bold(`\nMigration checksum report — ${env.DB_NAME} @ ${env.DB_HOST}:${env.DB_PORT}`));
    console.log(dim(`environment: ${env.NODE_ENV}\n`));

    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version',
    );
    const applied = new Map(
      rows.map((row) => [
        String(row.version),
        { name: String(row.name), checksum: (row.checksum as string | null) ?? null, appliedAt: row.applied_at as Date },
      ]),
    );

    const pending = files.filter((file) => !applied.has(file.version));
    const drifted = files.filter((file) => {
      const record = applied.get(file.version);
      return record?.checksum != null && record.checksum !== file.checksum;
    });

    if (pending.length > 0) {
      console.log(yellow(`${pending.length} pending migration(s):`));
      for (const file of pending) console.log(`  → ${file.name}`);
      console.log(
        red('\nRefusing to reconcile while migrations are pending. Run `npm run db:migrate` first.\n'),
      );
      // Reconciling a partially-migrated database would record checksums for a
      // schema that was never fully applied.
      if (shouldReconcile) process.exit(1);
    }

    if (drifted.length === 0) {
      console.log(green('No checksum drift. Every applied migration matches the file on disk.\n'));
      return;
    }

    console.log(yellow(`${drifted.length} migration(s) applied with different contents than the current file:\n`));

    /* Evidence: does the live schema contain what these files declare? ------ */
    const [liveColumns] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.columns WHERE table_schema = ?',
      [env.DB_NAME],
    );
    const live = new Map<string, Set<string>>();
    for (const row of liveColumns) {
      const table = String(row.t).toLowerCase();
      if (!live.has(table)) live.set(table, new Set());
      live.get(table)!.add(String(row.c).toLowerCase());
    }

    const report = {
      generatedAt: new Date().toISOString(),
      database: env.DB_NAME,
      host: env.DB_HOST,
      environment: env.NODE_ENV,
      reconciled: false as boolean,
      migrations: [] as Array<Record<string, unknown>>,
    };

    let allSatisfied = true;

    for (const file of drifted) {
      const record = applied.get(file.version)!;
      const missingTables: string[] = [];
      const missingColumns: string[] = [];

      for (const [table, columns] of file.declaredTables) {
        const liveTable = live.get(table);
        if (!liveTable) {
          missingTables.push(table);
          continue;
        }
        for (const column of columns) {
          if (!liveTable.has(column)) missingColumns.push(`${table}.${column}`);
        }
      }

      const satisfied = missingTables.length === 0 && missingColumns.length === 0;
      if (!satisfied) allSatisfied = false;

      console.log(`  ${bold(file.name)}`);
      console.log(`    applied at    ${record.appliedAt?.toISOString?.() ?? String(record.appliedAt)}`);
      console.log(`    recorded hash ${dim(record.checksum?.slice(0, 16) ?? 'none')}…`);
      console.log(`    file hash     ${dim(file.checksum.slice(0, 16))}…`);
      console.log(
        `    declares      ${file.declaredTables.size} table(s), ${[...file.declaredTables.values()].reduce((n, s) => n + s.size, 0)} column(s)`,
      );
      if (satisfied) {
        console.log(`    live schema   ${green('all declared tables and columns present')}`);
      } else {
        if (missingTables.length > 0) console.log(`    live schema   ${red(`missing tables: ${missingTables.join(', ')}`)}`);
        if (missingColumns.length > 0) {
          const shown = missingColumns.slice(0, 8).join(', ');
          console.log(
            `    live schema   ${red(`missing columns: ${shown}${missingColumns.length > 8 ? ` (+${missingColumns.length - 8} more)` : ''}`)}`,
          );
        }
      }
      console.log();

      report.migrations.push({
        version: file.version,
        name: file.name,
        appliedAt: record.appliedAt,
        recordedChecksum: record.checksum,
        fileChecksum: file.checksum,
        declaredTableCount: file.declaredTables.size,
        missingTables,
        missingColumns,
        evidenceSatisfied: satisfied,
      });
    }

    if (!shouldReconcile) {
      console.log(dim('Read-only report. Re-run with --reconcile to re-record these checksums.'));
      console.log(
        dim('Reconciliation only runs `UPDATE schema_migrations SET checksum`. It never issues DDL or touches data.\n'),
      );
      writeReport(report);
      process.exit(1);
    }

    /* Reconcile ------------------------------------------------------------- */

    const targets = onlyVersions.length > 0 ? drifted.filter((f) => onlyVersions.includes(f.version)) : drifted;
    if (targets.length === 0) {
      console.log(yellow(`No drifted migration matched --only=${onlyVersions.join(',')}\n`));
      return;
    }

    if (!allSatisfied) {
      console.log(
        red(
          'Some declared tables or columns are missing from the live schema.\n' +
            'That means these migrations did NOT fully apply, so re-recording their\n' +
            'checksums would hide a real schema problem. Investigate before reconciling.\n',
        ),
      );
      process.exit(1);
    }

    if (env.isProduction) {
      console.log(
        yellow(
          'This is a PRODUCTION database.\n' +
            'Take a verified backup first (npm run db:backup) and confirm you have\n' +
            'reviewed the diff between the applied migration and the current file.\n',
        ),
      );
    }

    if (!assumeYes) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log(
        `About to re-record ${targets.length} checksum(s): ${targets.map((t) => t.version).join(', ')}`,
      );
      const answer = await rl.question(`Type ${bold('RECONCILE')} to proceed: `);
      rl.close();
      if (answer.trim() !== 'RECONCILE') {
        console.log(yellow('\nAborted. Nothing was changed.\n'));
        process.exit(1);
      }
    }

    for (const file of targets) {
      await connection.query('UPDATE schema_migrations SET checksum = ? WHERE version = ?', [
        file.checksum,
        file.version,
      ]);
      console.log(green(`  ✓ ${file.name} checksum re-recorded`));
    }

    report.reconciled = true;
    writeReport(report);

    console.log(green(`\nReconciled ${targets.length} migration(s).`));
    console.log(dim('Verify with: npm run db:migrate:check\n'));
  } finally {
    await connection.end();
  }
}

/** Persists the run for the audit trail. */
function writeReport(report: Record<string, unknown>): void {
  try {
    const dir = path.resolve(process.cwd(), env.BACKUP_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `checksum-reconciliation-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
    console.log(dim(`Report written to ${file}`));
  } catch (error) {
    console.error(yellow(`Could not write report: ${(error as Error).message}`));
  }
}

main().catch((error) => {
  console.error(red('Checksum reconciliation failed:'), error);
  process.exit(1);
});
