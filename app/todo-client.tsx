'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CreateTodoInput, Subtask, Todo, UpdateTodoInput } from '@/lib/db';
import {
  formatSingaporeDateTime,
  getSingaporeNow,
  isDueDateAtLeastOneMinuteAway,
  parseSingaporeDateTime,
  toSingaporeDateTimeLocal,
  toSingaporeIsoString,
} from '@/lib/timezone';
import { calculateProgress } from '@/lib/subtask-logic';
import { sectionTodos } from '@/lib/todo-logic';

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
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
}: {
  title: string;
  todos: Todo[];
  onToggle: (todo: Todo, completed: boolean) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onAddSubtask: (todoId: number, title: string) => Promise<void>;
  onToggleSubtask: (todoId: number, subtask: Subtask, completed: boolean) => void;
  onDeleteSubtask: (todoId: number, subtask: Subtask) => Promise<void>;
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
              <div className="min-w-0 flex-1">
                <p className={`break-words font-medium ${todo.completed ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                  {todo.title}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-slate-500">
                  <span className="capitalize">{todo.priority} priority</span>
                  {todo.due_date && <span>Due {formatSingaporeDateTime(todo.due_date)}</span>}
                </div>
                <SubtaskList
                  onAdd={(subtaskTitle) => onAddSubtask(todo.id, subtaskTitle)}
                  onDelete={(subtask) => onDeleteSubtask(todo.id, subtask)}
                  onToggle={(subtask, completed) => onToggleSubtask(todo.id, subtask, completed)}
                  subtasks={todo.subtasks ?? []}
                  todoId={todo.id}
                  todoTitle={todo.title}
                />
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
          </li>
        ))}
      </ul>
    </section>
  );
}

function SubtaskList({
  todoId,
  todoTitle,
  subtasks,
  onAdd,
  onToggle,
  onDelete,
}: {
  todoId: number;
  todoTitle: string;
  subtasks: Subtask[];
  onAdd: (title: string) => Promise<void>;
  onToggle: (subtask: Subtask, completed: boolean) => void;
  onDelete: (subtask: Subtask) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(() => new Set());
  const progress = calculateProgress(subtasks);
  const listId = `subtasks-${todoId}`;

  async function addSubtask() {
    const trimmedTitle = newTitle.trim();
    if (!trimmedTitle || adding) {
      return;
    }

    setAdding(true);
    try {
      await onAdd(trimmedTitle);
      setNewTitle('');
    } catch {
      // The parent displays the request error and the title remains available for retry.
    } finally {
      setAdding(false);
    }
  }

  async function deleteSubtask(subtask: Subtask) {
    setDeletingIds((current) => new Set(current).add(subtask.id));
    try {
      await onDelete(subtask);
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(subtask.id);
        return next;
      });
    }
  }

  return (
    <div className="mt-3">
      <button
        aria-controls={listId}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Hide' : 'Show'} subtasks for ${todoTitle}`}
        className="text-sm font-medium text-slate-600 hover:text-slate-900"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        {expanded ? '▼' : '▶'} Subtasks
      </button>

      {progress.total > 0 && (
        <div className="mt-2" aria-label={`Subtask progress for ${todoTitle}`}>
          <div className="mb-1 flex justify-between text-xs text-slate-500">
            <span>{progress.completed}/{progress.total} subtasks</span>
            <span>{progress.percent}%</span>
          </div>
          <div
            aria-label={`Subtask progress for ${todoTitle}`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progress.percent}
            aria-valuetext={`${progress.completed}/${progress.total} subtasks (${progress.percent}%)`}
            className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
          >
            <div
              className={`h-full transition-all duration-200 ${progress.percent === 100 ? 'bg-green-600' : 'bg-blue-600'}`}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      {expanded && (
        <div className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3" id={listId}>
          {subtasks.map((subtask) => (
            <div className="flex items-center gap-2" key={subtask.id}>
              <input
                aria-label={`Mark "${subtask.title}" as ${subtask.completed ? 'incomplete' : 'complete'}`}
                checked={subtask.completed}
                className="h-4 w-4 rounded border-slate-300"
                onChange={(event) => onToggle(subtask, event.target.checked)}
                type="checkbox"
              />
              <span className={`min-w-0 flex-1 break-words text-sm ${subtask.completed ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                {subtask.title}
              </span>
              <button
                aria-label={`Delete subtask "${subtask.title}"`}
                className="rounded px-2 py-1 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                disabled={deletingIds.has(subtask.id)}
                onClick={() => deleteSubtask(subtask)}
                type="button"
              >
                {deletingIds.has(subtask.id) ? 'Deleting…' : '×'}
              </button>
            </div>
          ))}
          <form
            className="flex gap-2 pt-1"
            onSubmit={(event) => {
              event.preventDefault();
              void addSubtask();
            }}
          >
            <input
              aria-label={`New subtask for ${todoTitle}`}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              onChange={(event) => setNewTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void addSubtask();
                }
              }}
              placeholder="Add subtask..."
              value={newTitle}
            />
            <button
              aria-label="Add subtask"
              className="rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
              disabled={!newTitle.trim() || adding}
              type="submit"
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function TodoClient({ initialTodos, userId, initialNow }: TodoClientProps) {
  const [todos, setTodos] = useState(initialTodos);
  const [now, setNow] = useState(() => new Date(initialNow));
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Todo['priority']>('medium');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [editValues, setEditValues] = useState<EditValues | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const nextOptimisticId = useRef(0);
  const nextOptimisticSubtaskId = useRef(0);
  const subtaskMutationVersions = useRef(new Map<number, number>());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(getSingaporeNow()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const sections = sectionTodos(todos, now);

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
    };
    setTodos((current) => [...current, optimisticTodo]);
    setTitle('');
    setDueDate('');
    setPriority('medium');

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
    }
  }

  async function toggleTodo(todo: Todo, completed: boolean) {
    setError(null);
    setTodos((current) => current.map((item) => (
      item.id === todo.id ? { ...item, completed } : item
    )));
    try {
      const updated = await requestJson<Todo>(`/api/todos/${todo.id}`, 'PUT', { completed });
      setTodos((current) => current.map((item) => (item.id === todo.id ? updated : item)));
    } catch (requestError) {
      setTodos((current) => current.map((item) => (item.id === todo.id ? todo : item)));
      setError(requestError instanceof Error ? requestError.message : 'Could not update todo. Please try again.');
    }
  }

  async function deleteTodo(todo: Todo) {
    setError(null);
    setTodos((current) => current.filter((item) => item.id !== todo.id));
    try {
      await requestJson<{ success: boolean }>(`/api/todos/${todo.id}`, 'DELETE');
    } catch (requestError) {
      setTodos((current) => [...current, todo]);
      setError(requestError instanceof Error ? requestError.message : 'Could not delete todo. Please try again.');
    }
  }

  async function addSubtask(todoId: number, subtaskTitle: string) {
    setError(null);
    const optimisticId = -Date.now() - nextOptimisticSubtaskId.current;
    nextOptimisticSubtaskId.current += 1;
    const optimisticSubtask: Subtask = {
      id: optimisticId,
      todo_id: todoId,
      title: subtaskTitle,
      completed: false,
      position: Math.max(-1, ...(todos.find((todo) => todo.id === todoId)?.subtasks ?? [])
        .map((subtask) => subtask.position)) + 1,
      created_at: new Date().toISOString(),
    };
    setTodos((current) => current.map((todo) => (
      todo.id === todoId
        ? { ...todo, subtasks: [...(todo.subtasks ?? []), optimisticSubtask] }
        : todo
    )));

    try {
      const saved = await requestJson<Subtask>(
        `/api/todos/${todoId}/subtasks`,
        'POST',
        { title: subtaskTitle },
      );
      setTodos((current) => current.map((todo) => (
        todo.id === todoId
          ? {
            ...todo,
            subtasks: (todo.subtasks ?? []).map((subtask) => (
              subtask.id === optimisticId ? saved : subtask
            )),
          }
          : todo
      )));
    } catch (requestError) {
      setTodos((current) => current.map((todo) => (
        todo.id === todoId
          ? { ...todo, subtasks: (todo.subtasks ?? []).filter((subtask) => subtask.id !== optimisticId) }
          : todo
      )));
      setError(requestError instanceof Error ? requestError.message : 'Could not add subtask. Please try again.');
      throw requestError;
    }
  }

  async function toggleSubtask(todoId: number, subtask: Subtask, completed: boolean) {
    setError(null);
    const version = (subtaskMutationVersions.current.get(subtask.id) ?? 0) + 1;
    subtaskMutationVersions.current.set(subtask.id, version);
    setTodos((current) => current.map((todo) => (
      todo.id === todoId
        ? {
          ...todo,
          subtasks: (todo.subtasks ?? []).map((item) => (
            item.id === subtask.id ? { ...item, completed } : item
          )),
        }
        : todo
    )));

    try {
      const updated = await requestJson<Subtask>(
        `/api/subtasks/${subtask.id}`,
        'PUT',
        { completed },
      );
      if (subtaskMutationVersions.current.get(subtask.id) === version) {
        setTodos((current) => current.map((todo) => (
          todo.id === todoId
            ? {
              ...todo,
              subtasks: (todo.subtasks ?? []).map((item) => (
                item.id === subtask.id ? updated : item
              )),
            }
            : todo
        )));
      }
    } catch (requestError) {
      if (subtaskMutationVersions.current.get(subtask.id) === version) {
        setTodos((current) => current.map((todo) => (
          todo.id === todoId
            ? {
              ...todo,
              subtasks: (todo.subtasks ?? []).map((item) => (
                item.id === subtask.id ? { ...item, completed: subtask.completed } : item
              )),
            }
            : todo
        )));
        setError(requestError instanceof Error ? requestError.message : 'Could not update subtask. Please try again.');
      }
    }
  }

  async function deleteSubtask(todoId: number, subtask: Subtask) {
    setError(null);
    const version = (subtaskMutationVersions.current.get(subtask.id) ?? 0) + 1;
    subtaskMutationVersions.current.set(subtask.id, version);
    setTodos((current) => current.map((todo) => (
      todo.id === todoId
        ? { ...todo, subtasks: (todo.subtasks ?? []).filter((item) => item.id !== subtask.id) }
        : todo
    )));

    try {
      await requestJson<{ success: boolean }>(`/api/subtasks/${subtask.id}`, 'DELETE');
    } catch (requestError) {
      if (subtaskMutationVersions.current.get(subtask.id) === version) {
        setTodos((current) => current.map((todo) => (
          todo.id === todoId
            ? {
              ...todo,
              subtasks: [...(todo.subtasks ?? []), subtask]
                .sort((left, right) => left.position - right.position || left.id - right.id),
            }
            : todo
        )));
        setError(requestError instanceof Error ? requestError.message : 'Could not delete subtask. Please try again.');
      }
    }
  }

  function openEdit(todo: Todo) {
    setError(null);
    setEditingTodo(todo);
    setEditValues({
      title: todo.title,
      dueDate: todo.due_date ? toSingaporeDateTimeLocal(todo.due_date) : '',
      priority: todo.priority,
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
      const updated = await requestJson<Todo>(
        `/api/todos/${editingTodo.id}`,
        'PUT',
        updates,
      );
      setTodos((current) => current.map((todo) => (
        todo.id === editingTodo.id ? updated : todo
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

      <TodoSection
        title="Overdue"
        todos={sections.overdue}
        onToggle={toggleTodo}
        onEdit={openEdit}
        onDelete={deleteTodo}
        onAddSubtask={addSubtask}
        onToggleSubtask={toggleSubtask}
        onDeleteSubtask={deleteSubtask}
      />
      <TodoSection
        title="Pending"
        todos={sections.pending}
        onToggle={toggleTodo}
        onEdit={openEdit}
        onDelete={deleteTodo}
        onAddSubtask={addSubtask}
        onToggleSubtask={toggleSubtask}
        onDeleteSubtask={deleteSubtask}
      />
      <TodoSection
        title="Completed"
        todos={sections.completed}
        onToggle={toggleTodo}
        onEdit={openEdit}
        onDelete={deleteTodo}
        onAddSubtask={addSubtask}
        onToggleSubtask={toggleSubtask}
        onDeleteSubtask={deleteSubtask}
      />
      {todos.length === 0 && (
        <p className="mt-8 text-center text-sm text-slate-500">No todos yet. Add one above.</p>
      )}

      {editingTodo && editValues && (
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
      )}
    </div>
  );
}
