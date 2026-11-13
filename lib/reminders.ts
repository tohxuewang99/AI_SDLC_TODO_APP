import type { Todo } from './db.ts';
import { parseSingaporeDateTime } from './timezone.ts';

export type ReminderMinutes = 15 | 30 | 60 | 120 | 1440 | 2880 | 10080;

export const REMINDER_LABELS: Record<ReminderMinutes, string> = {
  15: '15m',
  30: '30m',
  60: '1h',
  120: '2h',
  1440: '1d',
  2880: '2d',
  10080: '1w',
};

export function isReminderMinutes(value: unknown): value is ReminderMinutes {
  return typeof value === 'number' && Object.hasOwn(REMINDER_LABELS, value);
}

export function isReminderDue(
  todo: Pick<Todo, 'completed' | 'due_date' | 'reminder_minutes' | 'last_notification_sent'>,
  now: Date,
): boolean {
  if (
    todo.completed ||
    todo.due_date === null ||
    !isReminderMinutes(todo.reminder_minutes) ||
    todo.last_notification_sent !== null
  ) {
    return false;
  }
  const dueDate = parseSingaporeDateTime(todo.due_date);
  if (!dueDate) {
    throw new Error('Stored reminder has an invalid due date');
  }
  const due = dueDate.getTime();
  return due - todo.reminder_minutes * 60_000 <= now.getTime() && now.getTime() <= due;
}
