import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { env } from '../../config/env';
import { encryptBytes } from '../../core/security/crypto';
import { loggerFor } from '../../config/logger';
import { queryRows, type Row } from '../../db/query';

const log = loggerFor('security.backup');

export const disasterTargets = () => ({
  rpoMinutes: env.RPO_MINUTES,
  rtoMinutes: env.RTO_MINUTES,
  tested: false,
  note: 'Targets are configurable business objectives. Restoration must be tested before claiming DR readiness.',
});

/**
 * Development-only encrypted logical backup of the MySQL database.
 * Production backups belong to the managed database / object-storage pipeline.
 */
export async function runDevelopmentBackup(): Promise<{ file: string; bytes: number; encrypted: true } | null> {
  if (env.isProduction) {
    log.warn('refusing to run the development backup helper in production');
    return null;
  }

  const dir = path.resolve(process.cwd(), env.BACKUP_DIR);
  await fs.mkdir(dir, { recursive: true });
  await pruneOldBackups(dir, env.BACKUP_RETENTION_DAYS);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `marketplace-${stamp}.sql.enc`);

  const dump = await tryMysqldump().catch(() => null);
  const plaintext = dump ?? (await logicalDump());
  const encrypted = encryptBytes(plaintext);
  await fs.writeFile(target, encrypted);
  log.info({ file: target, bytes: encrypted.byteLength, driver: dump ? 'mysqldump' : 'logical' }, 'development backup written');
  return { file: target, bytes: encrypted.byteLength, encrypted: true };
}

async function tryMysqldump(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      `-h${env.DB_HOST}`,
      `-P${String(env.DB_PORT)}`,
      `-u${env.DB_USER}`,
      env.DB_PASSWORD ? `-p${env.DB_PASSWORD}` : '--password=',
      '--single-transaction',
      '--routines',
      '--no-tablespaces',
      env.DB_NAME,
    ];
    const child = spawn('mysqldump', args, { windowsHide: true });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
      else reject(new Error(Buffer.concat(errChunks).toString('utf8') || `mysqldump exited ${code}`));
    });
  });
}

async function logicalDump(): Promise<Buffer> {
  const tables = await queryRows<Row>(
    `SELECT table_name AS name
       FROM information_schema.tables
      WHERE table_schema = ?
        AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    [env.DB_NAME],
  );
  const parts: string[] = [`-- logical dump ${new Date().toISOString()} ${env.DB_NAME}`];
  for (const table of tables) {
    const name = String(table.name);
    const countRow = await queryRows<Row>(`SELECT COUNT(*) AS c FROM \`${name}\``);
    parts.push(`-- table ${name} rows=${Number(countRow[0]?.c ?? 0)}`);
  }
  return Buffer.from(parts.join('\n'), 'utf8');
}

async function pruneOldBackups(dir: string, retentionDays: number): Promise<void> {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const entries = await fs.readdir(dir).catch(() => []);
  for (const entry of entries) {
    if (!entry.endsWith('.enc')) continue;
    const full = path.join(dir, entry);
    const stat = await fs.stat(full).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) await fs.rm(full, { force: true });
  }
}
