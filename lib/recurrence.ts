import type { RecurrencePattern } from './db.ts';
import { fromSingaporeParts, toSingaporeParts } from './timezone.ts';

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function calculateNextDueDate(
  currentDueDate: string,
  pattern: RecurrencePattern,
): string {
  const { year, month, day, hour, minute, second } = toSingaporeParts(currentDueDate);
  let nextDate: { year: number; month: number; day: number };

  switch (pattern) {
    case 'daily':
      nextDate = addDays(year, month, day, 1);
      break;
    case 'weekly':
      nextDate = addDays(year, month, day, 7);
      break;
    case 'monthly': {
      const targetMonth = month === 12 ? 1 : month + 1;
      const targetYear = month === 12 ? year + 1 : year;
      nextDate = {
        year: targetYear,
        month: targetMonth,
        day: Math.min(day, daysInMonth(targetYear, targetMonth)),
      };
      break;
    }
    case 'yearly': {
      const targetYear = year + 1;
      nextDate = {
        year: targetYear,
        month,
        day: Math.min(day, daysInMonth(targetYear, month)),
      };
      break;
    }
    default:
      throw new Error(`Unsupported recurrence pattern: ${String(pattern)}`);
  }

  return fromSingaporeParts(nextDate, hour, minute, second);
}
