import type { Priority } from '@/lib/db';

export function normalizeTodoTitle(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const title = value.trim();
  return title.length > 0 ? title : null;
}

export function isPriority(value: unknown): value is Priority {
  return value === 'high' || value === 'medium' || value === 'low';
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
