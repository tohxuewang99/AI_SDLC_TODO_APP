import { PRIORITY_ORDER } from './priority.ts';
import type { Todo } from '@/lib/db';

function dateTime(value: string): number {
  const parsed = new Date(value);
  return parsed.getTime();
}

export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    const priorityDifference = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    const aDue = a.due_date ? dateTime(a.due_date) : Number.POSITIVE_INFINITY;
    const bDue = b.due_date ? dateTime(b.due_date) : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) {
      return aDue - bDue;
    }
    return dateTime(b.created_at) - dateTime(a.created_at);
  });
}

export function sectionTodos(todos: Todo[], now: Date) {
  const incomplete = todos.filter((todo) => !todo.completed);
  const overdue = sortTodos(incomplete.filter(
    (todo) => todo.due_date !== null && dateTime(todo.due_date) < now.getTime(),
  ));
  const pending = sortTodos(incomplete.filter(
    (todo) => todo.due_date === null || dateTime(todo.due_date) >= now.getTime(),
  ));
  const completed = todos
    .filter((todo) => todo.completed)
    .sort((a, b) => dateTime(b.updated_at ?? b.created_at) - dateTime(a.updated_at ?? a.created_at));
  return { overdue, pending, completed };
}
