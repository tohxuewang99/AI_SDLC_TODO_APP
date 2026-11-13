import type { TemplateSubtask } from './db.ts';

export function serializeTemplateSubtasks(subtasks: TemplateSubtask[]): string | null {
  return subtasks.length
    ? JSON.stringify(subtasks.map(({ title }, position) => ({ title, position })))
    : null;
}

export function parseTemplateSubtasks(json: string | null): TemplateSubtask[] {
  if (json === null) return [];

  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value) || !value.every(
      (item: unknown) => (
        typeof item === 'object' && item !== null &&
        'title' in item && typeof item.title === 'string' && item.title.trim().length > 0 &&
        'position' in item && typeof item.position === 'number' &&
        Number.isSafeInteger(item.position) && item.position >= 0
      ),
    )) {
      throw new Error('Invalid template subtask snapshot');
    }
    return value.map(({ title, position }: TemplateSubtask) => ({ title, position }));
  } catch (error) {
    console.warn('Invalid template subtasks; creating todo without subtasks', error);
    return [];
  }
}
