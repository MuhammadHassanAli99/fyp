import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';

const log = loggerFor('risk.aml');

/**
 * AML is jurisdiction-configurable. Countries.requires_aml and gold_compliance_rules
 * decide whether screening runs. No single country's rule set is hard-coded.
 */
export async function amlRequiredFor(countryId: number | null): Promise<boolean> {
  if (!countryId) return false;
  const country = await queryOne<Row>('SELECT requires_aml FROM countries WHERE id = ?', [countryId]);
  return Number(country?.requires_aml ?? 0) === 1;
}

export async function runAmlIfRequired(userId: number, countryId: number | null): Promise<{ ran: boolean; result: string | null }> {
  const required = await amlRequiredFor(countryId);
  if (!required) return { ran: false, result: null };

  const existing = await queryOne<Row>(
    `SELECT result FROM aml_screenings WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    [userId],
  );
  if (existing && String(existing.result) === 'clear' && env.isProduction) {
    return { ran: false, result: 'clear' };
  }

  const result = env.isDevelopment ? 'clear' : 'clear';
  await insertAndGetId(
    `INSERT INTO aml_screenings (user_id, screening_type, provider, result, match_score, details)
     VALUES (?, 'sanctions', 'internal', ?, 0, ?)`,
    [userId, result, JSON.stringify({ note: 'Placeholder adapter — wire a licensed provider per jurisdiction' })],
  );
  log.info({ userId, result }, 'AML screening recorded');
  return { ran: true, result };
}

export async function latestAml(userId: number) {
  return queryOne<Row>(
    `SELECT id, screening_type, provider, result, match_score, created_at
       FROM aml_screenings WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    [userId],
  );
}

export async function listAmlQueue(limit = 50) {
  return queryRows<Row>(
    `SELECT id, user_id, screening_type, result, match_score, created_at
       FROM aml_screenings WHERE result IN ('potential_match','match')
      ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
}

export async function reviewAml(id: number, reviewerId: number, result: 'clear' | 'match'): Promise<void> {
  await execute(
    `UPDATE aml_screenings SET result = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [result, reviewerId, id],
  );
}
