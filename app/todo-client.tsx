'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type {
  CreateTodoInput,
  RecurrencePattern,
  Todo,
  TodoUpdateResult,
  UpdateTodoInput,
} from '@/lib/db';
import {
  formatSingaporeDateTime,
  getSingaporeNow,
  isDueDateAtLeastOneMinuteAway,
  parseSingaporeDateTime,
  toSingaporeDateTimeLocal,
  toSingaporeIsoString,
} from '@/lib/timezone';
import { sectionTodos } from '@/lib/todo-logic';

const PRIORITY_BADGE_STYLES: Record<Todo['priority'], string> = {
  high: 'border-[#EF4444] bg-red-100 text-red-800 dark:border-[#F87171] dark:bg-red-950 dark:text-[#F87171]',
  medium: 'border-[#F59E0B] bg-yellow-100 text-yellow-800 dark:border-[#FBBF24] dark:bg-yellow-950 dark:text-[#FBBF24]',
  low: 'border-[#3B82F6] bg-blue-100 text-blue-800 dark:border-[#60A5FA] dark:bg-blue-950 dark:text-[#60A5FA]',
};

interface TodoClientProps {
  initialTodos: Todo[];
  userId: number;
  initialNow: string;
}

interface ApiError {
  error?: string;
}

interface EditValues {
  title: string;
  dueDate: string;
  priority: Todo['priority'];
  isRecurring: boolean;
  recurrencePattern: RecurrencePattern;
}

function PriorityBadge({ priority }: { priority: Todo['priority'] }) {
  const label = priority[0].toUpperCase() + priority.slice(1);
  return (
    <span
      aria-label={`${label} priority`}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGE_STYLES[priority]}`}
    >
      {label}
    </span>
  );
}

async function requestJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = result as ApiError | null;
    throw new Error(error?.error ?? 'The request could not be completed.');
  }
  return result as T;
}

function TodoSection({
  title,
  todos,
  onToggle,
  onEdit,
  onDelete,
  editingTodo,
  editDialog,
}: {
  title: string;
  todos: Todo[];
  onToggle: (todo: Todo, completed: boolean) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  editingTodo: Todo | null;
  editDialog: ReactNode;
}) {
  if (todos.length === 0) {
    return null;
  }

  return (
    <section aria-label={`${title} todos`} className="mt-8">
      <h2 className="mb-3 text-lg font-semibold text-slate-800">
        {title} ({todos.length})
      </h2>
      <ul className="space-y-3">
        {todos.map((todo) => (
          <li
            className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center"
            key={todo.id}
          >
            <div className="flex items-start gap-3">
              <input
                aria-label={`Mark "${todo.title}" as ${todo.completed ? 'incomplete' : 'complete'}`}
                checked={todo.completed}
                className="mt-1 h-5 w-5 rounded border-slate-300"
                onChange={(event) => onToggle(todo, event.target.checked)}
                type="checkbox"
              />
              <div>
                <p className={`break-words font-medium ${todo.completed ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                  {todo.title}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                  <PriorityBadge priority={todo.priority} />
                  {todo.due_date && <span>Due {formatSingaporeDateTime(todo.due_date)}</span>}
                  {todo.is_recurring && todo.recurrence_pattern && (
                    <span className="inline-flex items-center rounded-full border border-purple-300 bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                      🔄 {todo.recurrence_pattern}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-4 pl-8 text-sm sm:pl-0">
              <button
                className="font-semibold text-indigo-700 hover:text-indigo-900"
                onClick={() => onEdit(todo)}
                type="button"
              >
                Edit
              </button>
              <button
                className="font-semibold text-red-700 hover:text-red-900"
                onClick={() => onDelete(todo)}
                type="button"
              >
                Delete
              </button>
            </div>
            {editingTodo?.id === todo.id && editDialog}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function TodoClient({ initialTodos, userId, initialNow }: TodoClientProps) {
  const [todos, setTodos] = useState(initialTodos);
  const [now, setNow] = useState(() => new Date(initialNow));
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Todo['priority']>('medium');
  const [priorityFilter, setPriorityFilter] = useState<Todo['priority'] | 'all'>('all');
  const [dueDate, setDueDate] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>('daily');
  const [error, setError] = useState<string | null>(null);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [editValues, setEditValues] = useState<EditValues | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const nextOptimisticId = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(getSingaporeNow()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredTodos = priorityFilter === 'all'
    ? todos
    : todos.filter((todo) => todo.priority === priorityFilter);
  const sections = sectionTodos(filteredTodos, now);

  async function addTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Title is required.');
      return;
    }

    const parsedDueDate = dueDate ? parseSingaporeDateTime(dueDate) : null;
    if (dueDate && (!parsedDueDate || !isDueDateAtLeastOneMinuteAway(parsedDueDate, getSingaporeNow()))) {
      setError('Due date must be at least 1 minute in the future.');
      return;
    }

    const input: CreateTodoInput = {
      title: trimmedTitle,
      priority,
      due_date: parsedDueDate ? toSingaporeIsoString(parsedDueDate) : null,
      is_recurring: isRecurring,
      recurrence_pattern: isRecurring ? recurrencePattern : null,
    };
    const optimisticId = -Date.now() - nextOptimisticId.current;
    nextOptimisticId.current += 1;
    const optimisticTodo: Todo = {
      id: optimisticId,
      user_id: userId,
      title: input.title,
      completed: false,
      due_date: input.due_date ?? null,
      priority: input.priority ?? 'medium',
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: null,
      last_notification_sent: null,
      created_at: new Date().toISOString(),
      updated_at: null,
      tags: [],
    };
    setTodos((current) => [...current, optimisticTodo]);
    setTitle('');
    setDueDate('');
    setPriority('medium');
    setIsRecurring(false);
    setRecurrencePattern('daily');

    try {
      const saved = await requestJson<Todo>('/api/todos', 'POST', input);
      setTodos((current) => current.map((todo) => (
        todo.id === optimisticId ? saved : todo
      )));
    } catch (requestError) {
      setTodos((current) => current.filter((todo) => todo.id !== optimisticId));
      setError(requestError instanceof Error ? requestError.message : 'Could not create todo. Please try again.');
      setTitle(input.title);
      setDueDate(dueDate);
      setPriority(input.priority ?? 'medium');
      setIsRecurring(input.is_recurring ?? false);
      setRecurrencePattern(input.recurrence_pattern ?? 'daily');
    }
  }

  async function toggleTodo(todo: Todo, completed: boolean) {
    setError(null);
    setTodos((current) => current.map((item) => (
      item.id === todo.id ? { ...item, completed } : item
    )));
    try {
      const result = await requestJson<TodoUpdateResult>(`/api/todos/${todo.id}`, 'PUT', { completed });
      setTodos((current) => {
        const updatedIds = new Set([result.todo.id, result.nextInstance?.id]);
        const remaining = current.filter((item) => !updatedIds.has(item.id));
        return result.nextInstance
          ? [...remaining, result.todo, result.nextInstance]
          : [...remaining, result.todo];
      });
    } catch (requestError) {
      setTodos((current) => current.map((item) => (item.id === todo.id ? todo : item)));
      setError(requestError instanceof Error ? requestError.message : 'Could not update todo. Please try again.');
    }
  }

  async function deleteTodo(todo: Todo) {
    setError(null);
    try {
      await requestJson<{ success: boolean }>(`/api/todos/${todo.id}`, 'DELETE');
      setTodos((current) => current.filter((item) => item.id !== todo.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not delete todo. Please try again.');
    }
  }

  function openEdit(todo: Todo) {
    setError(null);
    setEditingTodo(todo);
    setEditValues({
      title: todo.title,
      dueDate: todo.due_date ? toSingaporeDateTimeLocal(todo.due_date) : '',
      priority: todo.priority,
      isRecurring: todo.is_recurring,
      recurrencePattern: todo.recurrence_pattern ?? 'daily',
    });
  }

  function closeEdit() {
    if (editBusy) {
      return;
    }
    setEditingTodo(null);
    setEditValues(null);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTodo || !editValues) {
      return;
    }
    const trimmedTitle = editValues.title.trim();
    if (!trimmedTitle) {
      setError('Title cannot be empty.');
      return;
    }
    const parsedDueDate = editValues.dueDate
      ? parseSingaporeDateTime(editValues.dueDate)
      : null;
    if (editValues.dueDate && !parsedDueDate) {
      setError('Due date must be a valid date and time.');
      return;
    }

    const updates: UpdateTodoInput = {};
    if (trimmedTitle !== editingTodo.title) {
      updates.title = trimmedTitle;
    }
    const dueDateValue = parsedDueDate ? toSingaporeIsoString(parsedDueDate) : null;
    if (dueDateValue !== editingTodo.due_date) {
      updates.due_date = dueDateValue;
    }
    if (editValues.priority !== editingTodo.priority) {
      updates.priority = editValues.priority;
    }
    if (editValues.isRecurring !== editingTodo.is_recurring) {
      updates.is_recurring = editValues.isRecurring;
    }
    if (
      editValues.recurrencePattern !== editingTodo.recurrence_pattern &&
      editValues.isRecurring
    ) {
      updates.recurrence_pattern = editValues.recurrencePattern;
    }
    if (Object.keys(updates).length === 0) {
      closeEdit();
      return;
    }

    setEditBusy(true);
    setError(null);
    const optimisticTodo = { ...editingTodo, ...updates };
    setTodos((current) => current.map((todo) => (
      todo.id === editingTodo.id ? optimisticTodo : todo
    )));
    try {
      const result = await requestJson<TodoUpdateResult>(
        `/api/todos/${editingTodo.id}`,
        'PUT',
        updates,
      );
      setTodos((current) => current.map((todo) => (
        todo.id === editingTodo.id ? result.todo : todo
      )));
      setEditingTodo(null);
      setEditValues(null);
    } catch (requestError) {
      setTodos((current) => current.map((todo) => (
        todo.id === editingTodo.id ? editingTodo : todo
      )));
      setError(requestError instanceof Error ? requestError.message : 'Could not update todo. Please try again.');
    } finally {
      setEditBusy(false);
    }
  }

  useEffect(() => {
    if (!editingTodo) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !editBusy) {
        setEditingTodo(null);
        setEditValues(null);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingTodo, editBusy]);

  const editDialog = editingTodo && editValues ? (
    <div
      aria-label={`Edit ${editingTodo.title}`}
      aria-modal="true"
      className="fixed inset-0 z-10 flex items-center justify-center bg-slate-950/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeEdit();
        }
      }}
      role="dialog"
      tabIndex={-1}
    >
      <form className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onSubmit={saveEdit}>
        <h2 className="text-xl font-semibold text-slate-950">Edit todo</h2>
        <label className="mt-5 block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Title</span>
          <input
            aria-label="Edit title"
            className="w-full rounded-xl border border-slate-300 px-3 py-2"
            onChange={(event) => setEditValues({ ...editValues, title: event.target.value })}
            value={editValues.title}
          />
        </label>
        <div className="mt-4 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              aria-label="Repeat"
              checked={editValues.isRecurring}
              disabled={!editValues.dueDate}
              onChange={(event) => setEditValues({
                ...editValues,
                isRecurring: event.target.checked,
              })}
              type="checkbox"
            />
            Repeat
          </label>
          {editValues.isRecurring && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              Recurrence pattern
              <select
                aria-label="Recurrence pattern"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                onChange={(event) => setEditValues({
                  ...editValues,
                  recurrencePattern: event.target.value as RecurrencePattern,
                })}
                value={editValues.recurrencePattern}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
          )}
        </div>
        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Priority</span>
          <select
            aria-label="Edit priority"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
            onChange={(event) => setEditValues({
              ...editValues,
              priority: event.target.value as Todo['priority'],
            })}
            value={editValues.priority}
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Due date</span>
          <input
            aria-label="Edit due date"
            className="w-full rounded-xl border border-slate-300 px-3 py-2"
            onChange={(event) => setEditValues({ ...editValues, dueDate: event.target.value })}
            type="datetime-local"
            value={editValues.dueDate}
          />
        </label>
        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            disabled={editBusy}
            onClick={closeEdit}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={editBusy}
            type="submit"
          >
            {editBusy ? 'Updating…' : 'Update'}
          </button>
        </div>
      </form>
    </div>
  ) : null;

  return (
    <div className="mt-10">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-semibold text-slate-950">Add a todo</h2>
        <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={addTodo}>
          <label className="sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-slate-700">Title</span>
            <input
              aria-label="Title"
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
            {title.length > 200 && (
              <span className="mt-1 block text-sm text-amber-700">{title.length} characters (keep titles concise)</span>
            )}
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-slate-700">Priority</span>
            <select
              aria-label="Priority"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
              onChange={(event) => setPriority(event.target.value as Todo['priority'])}
              value={priority}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-slate-700">Due date</span>
            <input
              aria-label="Due date"
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              onChange={(event) => setDueDate(event.target.value)}
              type="datetime-local"
              value={dueDate}
            />
            <span className="mt-1 block text-xs text-slate-500">Singapore time (optional)</span>
          </label>
          <div className="flex flex-col justify-center gap-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                aria-label="Repeat"
                checked={isRecurring}
                disabled={!dueDate}
                onChange={(event) => setIsRecurring(event.target.checked)}
                type="checkbox"
              />
              Repeat
            </label>
            {isRecurring && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                Recurrence pattern
                <select
                  aria-label="Recurrence pattern"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                  onChange={(event) => setRecurrencePattern(event.target.value as RecurrencePattern)}
                  value={recurrencePattern}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
            )}
            {!dueDate && (
              <p className="text-xs text-slate-500">Set a due date to enable recurrence.</p>
            )}
          </div>
          <div className="sm:col-span-2">
            <button
              className="rounded-xl bg-indigo-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-800"
              type="submit"
            >
              Add
            </button>
          </div>
        </form>
      </section>

      {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}

      <label className="mt-8 flex w-fit items-center gap-3 text-sm font-medium text-slate-700">
        <span>Priority</span>
        <select
          aria-label="Priority filter"
          className="rounded-xl border border-slate-300 bg-white px-3 py-2"
          onChange={(event) => setPriorityFilter(event.target.value as Todo['priority'] | 'all')}
          value={priorityFilter}
        >
          <option value="all">All Priorities</option>
          <option value="high">High Priority</option>
          <option value="medium">Medium Priority</option>
          <option value="low">Low Priority</option>
        </select>
      </label>

      <TodoSection
        title="Overdue"
        todos={sections.overdue}
        onToggle={toggleTodo}
        onEdit={openEdit}
        onDelete={deleteTodo}
        editingTodo={editingTodo}
        editDialog={editDialog}
      />
      <TodoSection
        title="Pending"
        todos={sections.pending}
        onToggle={toggleTodo}
        onEdit={openEdit}
        onDelete={deleteTodo}
        editingTodo={editingTodo}
        editDialog={editDialog}
      />
      <TodoSection
        title="Completed"
        todos={sections.completed}
        onToggle={toggleTodo}
        onEdit={openEdit}
        onDelete={deleteTodo}
        editingTodo={editingTodo}
        editDialog={editDialog}
      />
      {todos.length === 0 && (
        <p className="mt-8 text-center text-sm text-slate-500">No todos yet. Add one above.</p>
      )}
      {todos.length > 0 && filteredTodos.length === 0 && (
        <p className="mt-8 text-center text-sm text-slate-500">No todos match this priority.</p>
      )}

    </div>
  );
}
