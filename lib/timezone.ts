const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1000;

const LOCAL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const ZONED_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|[+-]\d{2}:\d{2})$/;

function hasValidCalendarFields(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): boolean {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second
    && date.getUTCMilliseconds() === millisecond;
}

export function getSingaporeNow(): Date {
  return new Date();
}

export function parseSingaporeDateTime(value: string): Date | null {
  const localMatch = LOCAL_DATE_TIME.exec(value);
  const zonedMatch = ZONED_DATE_TIME.exec(value);
  const match = localMatch ?? zonedMatch;
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? 0);
  const millisecond = Number((fractionText ?? '').padEnd(3, '0') || 0);
  if (!hasValidCalendarFields(year, month, day, hour, minute, second, millisecond)) {
    return null;
  }

  const normalized = localMatch
    ? `${value}${secondText === undefined ? ':00' : ''}+08:00`
    : value;
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

export function toSingaporeIsoString(value: Date): string {
  return new Date(value.getTime() + SINGAPORE_OFFSET_MS)
    .toISOString()
    .replace(/Z$/, '+08:00');
}

export function toSingaporeDateTimeLocal(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Date(date.getTime() + SINGAPORE_OFFSET_MS).toISOString().slice(0, 16);
}

export function formatSingaporeDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('en-SG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Singapore',
  }).format(date);
}

export function isDueDateAtLeastOneMinuteAway(
  dueDate: Date,
  now: Date = getSingaporeNow(),
): boolean {
  return dueDate.getTime() >= now.getTime() + 60_000;
}
