import type {
  CreateTemplateInput,
  Priority,
  RecurrencePattern,
  Template,
  TemplateSubtask,
  UpdateTemplateInput,
} from './db.ts';
import { isReminderMinutes } from './reminders.ts';

const priorities = new Set<Priority>(['high', 'medium', 'low']);
const recurrencePatterns = new Set<RecurrencePattern>([
  'daily',
  'weekly',
  'monthly',
  'yearly',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  return value.trim() || null;
}

function parsePriority(value: unknown): Priority {
  if (value === undefined || value === null) return 'medium';
  if (typeof value === 'string' && priorities.has(value as Priority)) {
    return value as Priority;
  }
  throw new Error("Priority must be 'high', 'medium', or 'low'");
}

function parseRecurring(value: unknown, defaultValue = false): boolean {
  if (value === undefined) return defaultValue;
  if (typeof value === 'boolean') return value;
  throw new Error('is_recurring must be a boolean');
}

function parseRecurrencePattern(value: unknown): RecurrencePattern | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && recurrencePatterns.has(value as RecurrencePattern)) {
    return value as RecurrencePattern;
  }
  throw new Error('Invalid recurrence pattern');
}

function parseReminderMinutes(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (isReminderMinutes(value)) return value;
  throw new Error('Invalid reminder timing');
}

function parseDueDateOffset(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  throw new Error('Due date offset must be a non-negative integer');
}

function parseSubtasks(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new Error('Subtasks must be an array');
  }

  const subtasks: TemplateSubtask[] = value.map((item, position) => {
    if (!isRecord(item)) {
      throw new Error('Each subtask must be an object');
    }
    const title = requiredText(item.title, 'Subtask title');
    if (
      item.position !== undefined &&
      (!Number.isSafeInteger(item.position) || Number(item.position) < 0)
    ) {
      throw new Error('Subtask position must be a non-negative integer');
    }
    return { title, position };
  });
  return subtasks.length > 0 ? JSON.stringify(subtasks) : null;
}

function validateTemplateRelations(
  isRecurring: boolean,
  recurrencePattern: RecurrencePattern | null,
  reminderMinutes: number | null,
  dueDateOffsetMinutes: number | null,
): void {
  if (isRecurring && !recurrencePattern) {
    throw new Error('Recurring templates require a recurrence pattern');
  }
  if (!isRecurring && recurrencePattern !== null) {
    throw new Error('Non-recurring templates cannot have a recurrence pattern');
  }
  if (isRecurring && dueDateOffsetMinutes === null) {
    throw new Error('Recurring templates require a due date offset');
  }
  if (reminderMinutes !== null && dueDateOffsetMinutes === null) {
    throw new Error('Templates with reminders require a due date offset');
  }
}

export function parseCreateTemplateInput(value: unknown): CreateTemplateInput {
  if (!isRecord(value)) {
    throw new Error('Request body must be an object');
  }

  const isRecurring = parseRecurring(value.is_recurring);
  const recurrencePattern = parseRecurrencePattern(value.recurrence_pattern);
  const reminderMinutes = parseReminderMinutes(value.reminder_minutes);
  const dueDateOffsetMinutes = parseDueDateOffset(value.due_date_offset_minutes);
  validateTemplateRelations(
    isRecurring,
    recurrencePattern,
    reminderMinutes,
    dueDateOffsetMinutes,
  );

  return {
    name: requiredText(value.name, 'Name'),
    description: optionalText(value.description, 'Description'),
    category: optionalText(value.category, 'Category'),
    title_template: requiredText(value.title_template, 'Title'),
    priority: parsePriority(value.priority),
    is_recurring: isRecurring,
    recurrence_pattern: recurrencePattern,
    reminder_minutes: reminderMinutes,
    due_date_offset_minutes: dueDateOffsetMinutes,
    subtasks_json: parseSubtasks(value.subtasks),
  };
}

export function parseUpdateTemplateInput(
  value: unknown,
  existing: Template,
): UpdateTemplateInput {
  if (!isRecord(value)) {
    throw new Error('Request body must be an object');
  }

  const input: UpdateTemplateInput = {};
  if (Object.hasOwn(value, 'name')) input.name = requiredText(value.name, 'Name');
  if (Object.hasOwn(value, 'description')) {
    input.description = optionalText(value.description, 'Description');
  }
  if (Object.hasOwn(value, 'category')) {
    input.category = optionalText(value.category, 'Category');
  }
  if (Object.hasOwn(value, 'title_template')) {
    input.title_template = requiredText(value.title_template, 'Title');
  }
  if (Object.hasOwn(value, 'priority')) {
    input.priority = parsePriority(value.priority);
  }
  if (Object.hasOwn(value, 'is_recurring')) {
    input.is_recurring = parseRecurring(value.is_recurring);
  }
  if (Object.hasOwn(value, 'recurrence_pattern')) {
    input.recurrence_pattern = parseRecurrencePattern(value.recurrence_pattern);
  }
  if (Object.hasOwn(value, 'reminder_minutes')) {
    input.reminder_minutes = parseReminderMinutes(value.reminder_minutes);
  }
  if (Object.hasOwn(value, 'due_date_offset_minutes')) {
    input.due_date_offset_minutes = parseDueDateOffset(value.due_date_offset_minutes);
  }
  if (Object.hasOwn(value, 'subtasks')) {
    input.subtasks_json = parseSubtasks(value.subtasks);
  }

  const isRecurring = input.is_recurring ?? existing.is_recurring;
  const recurrencePattern = input.recurrence_pattern === undefined
    ? existing.recurrence_pattern
    : input.recurrence_pattern;
  const reminderMinutes = input.reminder_minutes === undefined
    ? existing.reminder_minutes
    : input.reminder_minutes;
  const dueDateOffsetMinutes = input.due_date_offset_minutes === undefined
    ? existing.due_date_offset_minutes
    : input.due_date_offset_minutes;

  if (!isRecurring && input.is_recurring === false) {
    if (
      input.recurrence_pattern !== undefined &&
      input.recurrence_pattern !== null
    ) {
      throw new Error('Non-recurring templates cannot have a recurrence pattern');
    }
    input.recurrence_pattern = null;
  }
  validateTemplateRelations(
    isRecurring,
    !isRecurring && input.is_recurring === false ? null : recurrencePattern,
    reminderMinutes,
    dueDateOffsetMinutes,
  );
  return input;
}

export function parseTemplateId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
