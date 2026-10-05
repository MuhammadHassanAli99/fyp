/**
 * Server timestamps are UTC. Display conversion happens here — never mutate
 * stored values. DST is resolved by the IANA timezone through Intl.
 */

export type ClockHour = '12' | '24';

export interface DateTimeDisplay {
  utc: string;
  timezone: string;
  localIso: string;
  date: string;
  time: string;
  hourCycle: ClockHour;
}

export function formatInTimezone(input: {
  utc: Date | string;
  timezone: string;
  dateFormat?: string;
  timeFormat?: string;
}): DateTimeDisplay {
  const date = input.utc instanceof Date ? input.utc : new Date(input.utc);
  if (Number.isNaN(date.getTime())) {
    return {
      utc: '',
      timezone: input.timezone,
      localIso: '',
      date: '',
      time: '',
      hourCycle: hourCycleOf(input.timeFormat),
    };
  }

  const timezone = input.timezone || 'UTC';
  const hourCycle = hourCycleOf(input.timeFormat);
  const dateParts = formatParts(date, timezone, hourCycle);

  return {
    utc: date.toISOString(),
    timezone,
    localIso: toOffsetIso(date, timezone, dateParts),
    date: applyDatePattern(input.dateFormat ?? 'yyyy-MM-dd', dateParts),
    time: applyTimePattern(input.timeFormat ?? (hourCycle === '12' ? 'hh:mm a' : 'HH:mm'), dateParts),
    hourCycle,
  };
}

export function nowUtc(): Date {
  return new Date();
}

function hourCycleOf(timeFormat?: string): ClockHour {
  if (!timeFormat) return '24';
  return /a|h{1,2}(?!:)/i.test(timeFormat) && !timeFormat.includes('HH') ? '12' : '24';
}

function formatParts(date: Date, timezone: string, hourCycle: ClockHour) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: hourCycle === '12' ? 'h12' : 'h23',
      timeZoneName: 'shortOffset',
    }).formatToParts(date);
    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
    return {
      year: pick('year'),
      month: pick('month'),
      day: pick('day'),
      hour: pick('hour'),
      minute: pick('minute'),
      second: pick('second'),
      dayPeriod: pick('dayPeriod'),
      offset: pick('timeZoneName'),
    };
  } catch {
    const iso = date.toISOString();
    return {
      year: iso.slice(0, 4),
      month: iso.slice(5, 7),
      day: iso.slice(8, 10),
      hour: iso.slice(11, 13),
      minute: iso.slice(14, 16),
      second: iso.slice(17, 19),
      dayPeriod: '',
      offset: 'GMT',
    };
  }
}

function applyDatePattern(
  pattern: string,
  parts: { year: string; month: string; day: string },
): string {
  return pattern
    .replace(/yyyy/g, parts.year)
    .replace(/MM/g, parts.month)
    .replace(/dd/g, parts.day);
}

function applyTimePattern(
  pattern: string,
  parts: { hour: string; minute: string; second: string; dayPeriod: string },
): string {
  const hour12 = parts.hour.padStart(2, '0');
  return pattern
    .replace(/HH/g, hour12)
    .replace(/hh/g, hour12)
    .replace(/mm/g, parts.minute)
    .replace(/ss/g, parts.second)
    .replace(/a/g, parts.dayPeriod);
}

function toOffsetIso(
  date: Date,
  timezone: string,
  parts: { year: string; month: string; day: string; hour: string; minute: string; second: string },
): string {
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}[${timezone}]`;
}
