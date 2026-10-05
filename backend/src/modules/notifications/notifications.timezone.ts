const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function isValidIanaTimeZone(timeZone: string | null | undefined): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(timeZone: string | null | undefined, fallback = 'UTC'): string {
  return isValidIanaTimeZone(timeZone) ? timeZone! : fallback;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

/** DST-correct wall-clock parts via Intl (IANA). */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const tz = resolveTimeZone(timeZone);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: Number(read('hour')),
    minute: Number(read('minute')),
    weekday: WEEKDAY_INDEX[read('weekday')] ?? date.getUTCDay(),
  };
}

export function parseClock(value: string | null | undefined): { hour: number; minute: number } | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/**
 * Quiet-hour window in the user's timezone. `end` may wrap past midnight
 * (e.g. 23:00 → 07:00).
 */
export function isWithinQuietHours(
  now: Date,
  startTime: string | null,
  endTime: string | null,
  timeZone: string,
  daysOfWeek: number[] | null,
): boolean {
  const start = parseClock(startTime);
  const end = parseClock(endTime);
  if (!start || !end) return false;
  const parts = zonedParts(now, timeZone);
  if (daysOfWeek && daysOfWeek.length > 0 && !daysOfWeek.includes(parts.weekday)) {
    return false;
  }
  const current = minutesOfDay(parts.hour, parts.minute);
  const from = minutesOfDay(start.hour, start.minute);
  const to = minutesOfDay(end.hour, end.minute);
  if (from === to) return true;
  if (from < to) return current >= from && current < to;
  return current >= from || current < to;
}

/**
 * Next UTC instant when the quiet window ends in `timeZone`.
 * Used to delay non-critical jobs rather than drop them.
 */
export function nextQuietHoursEnd(
  now: Date,
  startTime: string | null,
  endTime: string | null,
  timeZone: string,
): Date | null {
  const end = parseClock(endTime);
  if (!end) return null;
  if (!isWithinQuietHours(now, startTime, endTime, timeZone, null)) return null;

  const tz = resolveTimeZone(timeZone);
  for (let offsetMinutes = 0; offsetMinutes <= 24 * 60; offsetMinutes += 1) {
    const candidate = new Date(now.getTime() + offsetMinutes * 60_000);
    if (!isWithinQuietHours(candidate, startTime, endTime, tz, null)) {
      return candidate;
    }
  }
  return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

export function formatInTimeZone(date: Date, timeZone: string, locale = 'en'): string {
  const tz = resolveTimeZone(timeZone);
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
