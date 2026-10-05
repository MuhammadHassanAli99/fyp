import { execute, queryCount, queryOne, queryRows, type Row } from '../../db/query';
import { AppError, ErrorCode, badRequest } from '../../core/errors';
import { recordAudit } from '../../middleware/audit';
import { AuthEvent, recordAuthEvent } from '../auth/auth.security';
import {
  assertUsernameValid,
  normalizeUsername,
  usernameTakenError,
  validateUsername,
  type UsernameValidation,
} from './username';

const DEFAULT_COOLDOWN_DAYS = 14;
const DEFAULT_MAX_PER_YEAR = 3;
const DEFAULT_HOLD_DAYS = 90;

async function settingNumber(key: string, fallback: number): Promise<number> {
  const row = await queryOne<Row>('SELECT setting_value FROM app_settings WHERE setting_key = ? AND scope = ?', [
    key,
    'global',
  ]);
  if (!row) return fallback;
  const value = row.setting_value;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function extraReserved(): Promise<string[]> {
  const rows = await queryRows<Row>('SELECT username_normalized FROM reserved_usernames');
  return rows.map((row) => String(row.username_normalized));
}

export async function inspectUsernameAvailability(
  raw: string,
  exceptUserId?: number | null,
): Promise<UsernameValidation & { available: boolean }> {
  const extra = await extraReserved().catch(() => [] as string[]);
  const result = validateUsername(raw, extra);
  if (!result.ok) return { ...result, available: false };
  const taken = await isUsernameTaken(result.normalized, exceptUserId);
  if (!taken) return { ...result, available: true };
  return {
    ...result,
    ok: false,
    available: false,
    issues: [...result.issues, { code: 'taken', message: 'This username is taken' }],
  };
}

export async function isUsernameTaken(normalized: string, exceptUserId?: number | null): Promise<boolean> {
  const users = await queryCount(
    exceptUserId
      ? 'SELECT COUNT(*) FROM users WHERE username_normalized = ? AND id <> ? AND deleted_at IS NULL'
      : 'SELECT COUNT(*) FROM users WHERE username_normalized = ? AND deleted_at IS NULL',
    exceptUserId ? [normalized, exceptUserId] : [normalized],
  );
  if (users > 0) return true;

  const held = await queryCount(
    exceptUserId
      ? `SELECT COUNT(*) FROM username_history
          WHERE username_normalized = ? AND held_until > CURRENT_TIMESTAMP AND user_id <> ?`
      : `SELECT COUNT(*) FROM username_history
          WHERE username_normalized = ? AND held_until > CURRENT_TIMESTAMP`,
    exceptUserId ? [normalized, exceptUserId] : [normalized],
  );
  return held > 0;
}

export async function assertUsernameAvailable(raw: string, exceptUserId?: number | null): Promise<UsernameValidation> {
  const extra = await extraReserved().catch(() => [] as string[]);
  const result = assertUsernameValid(raw, extra);
  if (await isUsernameTaken(result.normalized, exceptUserId)) throw usernameTakenError();
  return result;
}

export async function changeUsername(userId: number, raw: string): Promise<{ username: string; normalized: string }> {
  const current = await queryOne<Row>(
    'SELECT id, username, username_changed_at, username_change_count FROM users WHERE id = ? AND deleted_at IS NULL',
    [userId],
  );
  if (!current) throw new AppError('User not found', { status: 404, code: ErrorCode.NOT_FOUND });

  const result = await assertUsernameAvailable(raw, userId);
  const previous = (current.username as string | null) ?? null;
  if (previous && normalizeUsername(previous) === result.normalized) {
    return { username: previous, normalized: result.normalized };
  }

  const cooldownDays = await settingNumber('profile.username_cooldown_days', DEFAULT_COOLDOWN_DAYS);
  const maxPerYear = await settingNumber('profile.username_max_changes_per_year', DEFAULT_MAX_PER_YEAR);
  const holdDays = await settingNumber('profile.username_hold_days', DEFAULT_HOLD_DAYS);

  if (current.username_changed_at) {
    const elapsedMs = Date.now() - new Date(current.username_changed_at as Date).getTime();
    const remaining = cooldownDays * 24 * 60 * 60 * 1000 - elapsedMs;
    if (remaining > 0) {
      throw badRequest(`You can change your username again in ${Math.ceil(remaining / 86_400_000)} day(s)`);
    }
  }

  const recent = await queryCount(
    `SELECT COUNT(*) FROM username_history
      WHERE user_id = ? AND changed_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 365 DAY)`,
    [userId],
  );
  if (recent >= maxPerYear) {
    throw badRequest(`You can change your username at most ${maxPerYear} times per year`);
  }

  await execute(
    `UPDATE users
        SET username = ?, username_changed_at = CURRENT_TIMESTAMP,
            username_change_count = username_change_count + 1
      WHERE id = ?`,
    [result.display, userId],
  );

  if (previous) {
    await execute(
      `INSERT INTO username_history (user_id, username, username_normalized, held_until)
       VALUES (?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? DAY))`,
      [userId, previous, normalizeUsername(previous), holdDays],
    );
  }

  void recordAudit({
    action: 'profile.username_changed',
    entityType: 'user',
    entityId: userId,
    before: { username: previous },
    after: { username: result.display },
  });
  void recordAuthEvent({
    type: AuthEvent.USERNAME_CHANGED,
    userId,
    metadata: { from: previous, to: result.display },
  });

  return { username: result.display, normalized: result.normalized };
}
