import {
  formatSingaporeDate,
  getSingaporeNow,
  parseSingaporeDateTime,
  singaporeCalendarDate,
  singaporeWeekday,
} from './timezone.ts';
import type { Todo } from './db';
import { PRIORITY_ORDER } from './priority.ts';

export interface CalendarDay {
  date: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  isWeekend: boolean;
}

export interface CalendarMonth {
  year: number;
  month: number;
}

export function monthKey({ year, month }: CalendarMonth): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function parseMonthParam(raw: string | null, now = getSingaporeNow()): CalendarMonth {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [year, month] = raw.split('-').map(Number);
    if (year >= 1 && month >= 1 && month <= 12) return { year, month };
  }
  const [year, month] = formatSingaporeDate(now).split('-').map(Number);
  return { year, month };
}

export function moveMonth(current: CalendarMonth, offset: number): CalendarMonth {
  const index = current.year * 12 + current.month - 1 + offset;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 + 1 };
}

export function generateCalendarGrid(year: number, month: number, now = getSingaporeNow()): CalendarDay[] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('Calendar year and month must be valid integers');
  }
  const leading = singaporeWeekday(singaporeCalendarDate(year, month, 1));
  const today = formatSingaporeDate(now);
  const currentMonth = monthKey({ year, month });
  return Array.from({ length: 42 }, (_, index) => {
    const date = formatSingaporeDate(singaporeCalendarDate(year, month, index - leading + 1));
    return {
      date,
      isCurrentMonth: date.slice(0, 7) === currentMonth,
      isToday: date === today,
      isPast: date < today,
      isWeekend: index % 7 === 0 || index % 7 === 6,
    };
  });
}

export function groupCalendarTodos(todos: Todo[]): Map<string, Todo[]> {
  const groups = new Map<string, Todo[]>();
  for (const todo of todos) {
    if (!todo.due_date) continue;
    const parsed = parseSingaporeDateTime(todo.due_date);
    if (!parsed) throw new Error(`Todo ${todo.id} has an invalid due date`);
    const key = formatSingaporeDate(parsed);
    const group = groups.get(key) ?? [];
    group.push(todo);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
      || (a.due_date ?? '').localeCompare(b.due_date ?? '') || a.id - b.id);
  }
  return groups;
}
