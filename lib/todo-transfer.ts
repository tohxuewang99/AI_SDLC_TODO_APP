import { z } from 'zod';
import type { Todo } from './db.ts';
import { isReminderMinutes } from './reminders.ts';
import { parseSingaporeDateTime } from './timezone.ts';

const nonBlank = z.string().refine((value) => value.trim().length > 0);

export const todoExportSchema = z.object({
  version: z.literal(1),
  exported_at: nonBlank,
  todos: z.array(z.object({
    title: nonBlank,
    completed: z.boolean(),
    due_date: z.string().refine((value) => parseSingaporeDateTime(value) !== null).nullable(),
    priority: z.enum(['high', 'medium', 'low']),
    is_recurring: z.boolean(),
    recurrence_pattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable(),
    reminder_minutes: z.number().refine((value): boolean => isReminderMinutes(value)).nullable(),
    created_at: nonBlank,
    subtasks: z.array(z.object({
      title: nonBlank,
      completed: z.boolean(),
      position: z.number().int().safe(),
    })),
    tags: z.array(z.object({
      name: nonBlank,
      color: z.string().regex(/^#[0-9a-f]{6}$/i),
    })),
  }).refine((item) => (
    (item.is_recurring
      ? item.recurrence_pattern !== null && item.due_date !== null
      : item.recurrence_pattern === null)
    && (item.reminder_minutes === null || item.due_date !== null)
  ))),
});

export type TodoExport = z.infer<typeof todoExportSchema>;
export type TodoExportItem = TodoExport['todos'][number];

export interface ImportResult {
  imported: number;
  tagsCreated: number;
  tagsReused: number;
}

export function toExportItem(todo: Todo): TodoExportItem {
  return {
    title: todo.title,
    completed: todo.completed,
    due_date: todo.due_date,
    priority: todo.priority,
    is_recurring: todo.is_recurring,
    recurrence_pattern: todo.recurrence_pattern,
    reminder_minutes: todo.reminder_minutes,
    created_at: todo.created_at,
    subtasks: (todo.subtasks ?? []).map(({ title, completed, position }) => ({
      title, completed, position,
    })),
    tags: todo.tags.map(({ name, color }) => ({ name, color })),
  };
}

export function toCsv(todos: Todo[]): string {
  const escape = (value: string | number | boolean | null): string => {
    const text = value === null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = [
    ['ID', 'Title', 'Completed', 'Due Date', 'Priority', 'Recurring', 'Pattern', 'Reminder'],
    ...todos.map((todo) => [
      todo.id, todo.title, todo.completed, todo.due_date, todo.priority,
      todo.is_recurring, todo.recurrence_pattern, todo.reminder_minutes,
    ]),
  ];
  return `${rows.map((row) => row.map(escape).join(',')).join('\r\n')}\r\n`;
}
