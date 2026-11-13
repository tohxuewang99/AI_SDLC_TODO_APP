import type {
  CreateTodoInput,
  Priority,
  RecurrencePattern,
  Todo,
  UpdateTodoInput,
} from './db.ts';
import {
  getSingaporeNow,
  isDueDateAtLeastOneMinuteAway,
  parseSingaporeDateTime,
} from './timezone.ts';

const priorities = new Set<Priority>(['high', 'medium', 'low']);
const recurrencePatterns = new Set<RecurrencePattern>(['daily', 'weekly', 'monthly', 'yearly']);
const reminderValues = new Set([15, 30, 60, 120, 1440, 2880, 10080]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeTodoTitle(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const title = value.trim();
  return title.length > 0 ? title : null;
}

export function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && priorities.has(value as Priority);
}

export function validatePriority(value: unknown): Priority {
  if (value === undefined || value === null) {
    return 'medium';
  }
  if (isPriority(value)) {
    return value;
  }
  throw new Error(
    `Invalid priority: ${String(value)}. Must be 'high', 'medium', or 'low'.`,
  );
}

function validateDueDate(value: unknown, mustBeFuture: boolean): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Due date must be a valid ISO 8601 date-time');
  }

  const dueDate = parseSingaporeDateTime(value);
  if (!dueDate) {
    throw new Error('Due date must be a valid ISO 8601 date-time');
  }
  if (mustBeFuture && !isDueDateAtLeastOneMinuteAway(dueDate, getSingaporeNow())) {
    throw new Error('Due date must be at least 1 minute in the future');
  }
  return value;
}

function validateTagIds(value: unknown): number[] {
  if (!Array.isArray(value) || !value.every(
    (tagId) => Number.isSafeInteger(tagId) && Number(tagId) > 0,
  )) {
    throw new Error('Tag IDs must be an array of positive integers');
  }
  return [...new Set(value as number[])];
}

export function parseCreateTodoInput(value: unknown): CreateTodoInput {
  if (!isRecord(value)) {
    throw new Error('Request body must be an object');
  }
  const title = normalizeTodoTitle(value.title);
  if (!title) {
    throw new Error('Title is required');
  }

  const priority = validatePriority(value.priority);
  const isRecurring = value.is_recurring ?? false;
  if (typeof isRecurring !== 'boolean') {
    throw new Error('is_recurring must be a boolean');
  }
  const dueDate = value.due_date === undefined
    ? null
    : validateDueDate(value.due_date, value.due_date !== null);
  const pattern = value.recurrence_pattern ?? null;
  if (isRecurring && (!recurrencePatterns.has(pattern as RecurrencePattern) || !dueDate)) {
    if (!dueDate) {
      throw new Error('Recurring todos require a due date');
    }
    throw new Error('Invalid recurrence pattern');
  }
  if (!isRecurring && pattern !== null) {
    throw new Error('Non-recurring todos cannot have a recurrence pattern');
  }
  const reminderMinutes = value.reminder_minutes ?? null;
  if (
    reminderMinutes !== null &&
    (!Number.isInteger(reminderMinutes) || !reminderValues.has(Number(reminderMinutes)))
  ) {
    throw new Error('Invalid reminder timing');
  }

  return {
    title,
    due_date: dueDate,
    priority,
    is_recurring: isRecurring,
    recurrence_pattern: isRecurring ? pattern as RecurrencePattern : null,
    reminder_minutes: reminderMinutes as number | null,
    ...(value.tag_ids === undefined ? {} : { tag_ids: validateTagIds(value.tag_ids) }),
  };
}

export function parseUpdateTodoInput(value: unknown, existing: Todo): UpdateTodoInput {
  if (!isRecord(value)) {
    throw new Error('Request body must be an object');
  }

  const input: UpdateTodoInput = {};
  if (value.title !== undefined) {
    const title = normalizeTodoTitle(value.title);
    if (!title) {
      throw new Error('Title cannot be empty');
    }
    input.title = title;
  }
  if (value.completed !== undefined) {
    if (typeof value.completed !== 'boolean') {
      throw new Error('completed must be a boolean');
    }
    input.completed = value.completed;
  }
  if (value.due_date !== undefined) {
    input.due_date = validateDueDate(value.due_date, false);
  }
  if (value.priority !== undefined) {
    if (value.priority === null) {
      throw new Error(
        "Invalid priority: null. Must be 'high', 'medium', or 'low'.",
      );
    }
    input.priority = validatePriority(value.priority);
  }
  if (value.is_recurring !== undefined) {
    if (typeof value.is_recurring !== 'boolean') {
      throw new Error('is_recurring must be a boolean');
    }
    input.is_recurring = value.is_recurring;
  }
  if (value.recurrence_pattern !== undefined) {
    if (
      value.recurrence_pattern !== null &&
      (typeof value.recurrence_pattern !== 'string' ||
        !recurrencePatterns.has(value.recurrence_pattern as RecurrencePattern))
    ) {
      throw new Error('Invalid recurrence pattern');
    }
    input.recurrence_pattern = value.recurrence_pattern as RecurrencePattern | null;
  }
  if (value.reminder_minutes !== undefined) {
    if (
      value.reminder_minutes !== null &&
      (!Number.isInteger(value.reminder_minutes) ||
        !reminderValues.has(Number(value.reminder_minutes)))
    ) {
      throw new Error('Invalid reminder timing');
    }
    input.reminder_minutes = value.reminder_minutes as number | null;
  }
  if (value.tag_ids !== undefined) {
    input.tag_ids = validateTagIds(value.tag_ids);
  }

  const isRecurring = input.is_recurring ?? existing.is_recurring;
  const dueDate = input.due_date === undefined ? existing.due_date : input.due_date;
  let pattern = input.recurrence_pattern === undefined
    ? existing.recurrence_pattern
    : input.recurrence_pattern;
  if (!isRecurring) {
    if (input.recurrence_pattern != null) {
      throw new Error('Non-recurring todos cannot have a recurrence pattern');
    }
    input.recurrence_pattern = null;
    pattern = null;
  } else {
    if (!dueDate) {
      throw new Error('Recurring todos require a due date');
    }
    if (!pattern || !recurrencePatterns.has(pattern)) {
      throw new Error('Invalid recurrence pattern');
    }
  }

  return input;
}
