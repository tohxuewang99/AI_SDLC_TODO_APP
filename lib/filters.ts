import type { Priority, Todo } from './db';

export interface FilterState {
  search: string;
  priority: Priority | 'all';
  tagId: number | 'all';
  completion: 'all' | 'incomplete' | 'completed';
  dueDateFrom: string | null;
  dueDateTo: string | null;
}

export const DEFAULT_FILTER_STATE: FilterState = {
  search: '',
  priority: 'all',
  tagId: 'all',
  completion: 'all',
  dueDateFrom: null,
  dueDateTo: null,
};

export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.priority !== 'all' ||
    filters.tagId !== 'all' ||
    filters.completion !== 'all' ||
    filters.dueDateFrom !== null ||
    filters.dueDateTo !== null
  );
}

export function applyFilters(todos: Todo[], filters: FilterState): Todo[] {
  const query = filters.search.trim().toLowerCase();
  const result: Todo[] = [];

  for (const todo of todos) {
    if (
      query &&
      !todo.title.toLowerCase().includes(query) &&
      !(todo.subtasks ?? []).some((subtask) => subtask.title.toLowerCase().includes(query))
    ) {
      continue;
    }

    if (filters.priority !== 'all' && todo.priority !== filters.priority) {
      continue;
    }

    if (
      filters.tagId !== 'all' &&
      !(todo.tags ?? []).some((tag) => tag.id === filters.tagId)
    ) {
      continue;
    }

    if (
      (filters.completion === 'incomplete' && todo.completed) ||
      (filters.completion === 'completed' && !todo.completed)
    ) {
      continue;
    }

    if (filters.dueDateFrom || filters.dueDateTo) {
      if (!todo.due_date) {
        continue;
      }

      const dueDate = todo.due_date.slice(0, 10);
      if (filters.dueDateFrom && dueDate < filters.dueDateFrom) {
        continue;
      }
      if (filters.dueDateTo && dueDate > filters.dueDateTo) {
        continue;
      }
    }

    result.push(todo);
  }

  return result;
}
