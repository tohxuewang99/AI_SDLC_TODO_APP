const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface SingaporeDateParts {
  year: number;
  month: number;
  day: number;
}

interface SingaporeDateTimeParts extends SingaporeDateParts {
  hour: number;
  minute: number;
  second: number;
}

const LOCAL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const ZONED_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|[+-]\d{2}:\d{2})$/;

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function validDateTimeParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond = 0,
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

function partsFromDate(date: Date): SingaporeDateTimeParts {
  const parts = Object.fromEntries(
    dateTimeFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function getSingaporeNow(): Date {
  return new Date();
}

// UTC is used only as a host-timezone-independent carrier for calendar arithmetic.
export function singaporeCalendarDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(4, 0, 0, 0);
  return date;
}

export function singaporeWeekday(value: Date): number {
  return new Date(value.getTime() + SINGAPORE_OFFSET_MS).getUTCDay();
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
  if (!validDateTimeParts(year, month, day, hour, minute, second, millisecond)) {
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

export function toSingaporeParts(value: string | Date): SingaporeDateTimeParts {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('Invalid date');
    }
    return partsFromDate(value);
  }

  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) {
      throw new Error('Invalid date');
    }
    return partsFromDate(instant);
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!match) {
    throw new Error('Date must be an ISO 8601 date or local date-time');
  }
  const [, rawYear, rawMonth, rawDay, rawHour = '00', rawMinute = '00', rawSecond = '00'] = match;
  const parts = {
    year: Number(rawYear),
    month: Number(rawMonth),
    day: Number(rawDay),
    hour: Number(rawHour),
    minute: Number(rawMinute),
    second: Number(rawSecond),
  };
  if (!validDateTimeParts(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )) {
    throw new Error('Invalid date');
  }
  return parts;
}

export function fromSingaporeParts(
  date: SingaporeDateParts,
  hour: number,
  minute: number,
  second = 0,
): string {
  if (!validDateTimeParts(date.year, date.month, date.day, hour, minute, second)) {
    throw new Error('Invalid Singapore date-time parts');
  }
  const pad = (part: number) => String(part).padStart(2, '0');
  const dateTime = `${String(date.year).padStart(4, '0')}-${pad(date.month)}-${pad(date.day)}T${pad(hour)}:${pad(minute)}`;
  return second === 0 ? dateTime : `${dateTime}:${pad(second)}`;
}

export function singaporeTimestamp(value: string): number {
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    const instant = Date.parse(value);
    if (!Number.isFinite(instant)) {
      throw new Error('Invalid date');
    }
    return instant;
  }

  const { year, month, day, hour, minute, second } = toSingaporeParts(value);
  return Date.UTC(year, month - 1, day, hour, minute, second) - SINGAPORE_OFFSET_MS;
}

export function formatSingaporeDate(
  value: Date,
  format = 'yyyy-MM-dd HH:mm:ss',
): string {
  const parts = partsFromDate(value);
  const replacements: Record<string, string> = {
    yyyy: String(parts.year).padStart(4, '0'),
    MM: String(parts.month).padStart(2, '0'),
    dd: String(parts.day).padStart(2, '0'),
    HH: String(parts.hour).padStart(2, '0'),
    mm: String(parts.minute).padStart(2, '0'),
    ss: String(parts.second).padStart(2, '0'),
  };
  return format.replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => replacements[token]);
}
