'use client';

import { useEffect, useImperativeHandle, useState, type FormEvent, type Ref } from 'react';
import type { CreateTemplateDto, RecurrencePattern, Template, Todo } from '@/lib/db';
import { isReminderMinutes, REMINDER_LABELS } from '@/lib/reminders';

interface TemplateDraft {
  title: string;
  priority: Todo['priority'];
  isRecurring: boolean;
  recurrencePattern: RecurrencePattern;
  reminderMinutes: number | null;
}

export interface TemplateControlsHandle {
  saveTodo: (todo: Todo) => void;
}

async function request<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'error' in result
      && typeof result.error === 'string' ? result.error : 'The request could not be completed.';
    throw new Error(message);
  }
  return result as T;
}

export default function TemplateControls({
  draft,
  onCreated,
  ref,
}: {
  draft: TemplateDraft;
  onCreated: (todo: Todo) => void;
  ref: Ref<TemplateControlsHandle>;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [dialog, setDialog] = useState<'save' | 'manager' | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [offset, setOffset] = useState('');
  const [checklist, setChecklist] = useState('');
  const [sourceSubtasks, setSourceSubtasks] = useState<string[]>([]);
  const [saveDraft, setSaveDraft] = useState<TemplateDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    saveTodo(todo) {
      const subtasks = [...(todo.subtasks ?? [])]
        .sort((a, b) => a.position - b.position || a.id - b.id)
        .map((subtask) => subtask.title);
      setSaveDraft({
        title: todo.title,
        priority: todo.priority,
        isRecurring: todo.is_recurring,
        recurrencePattern: todo.recurrence_pattern ?? 'daily',
        reminderMinutes: todo.reminder_minutes,
      });
      setSourceSubtasks(subtasks);
      setChecklist(subtasks.join('\n'));
      setName('');
      setDescription('');
      setCategory('');
      setOffset('');
      setError(null);
      setDialog('save');
    },
  }), []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadTemplates() {
      try {
        const response = await fetch('/api/templates', { signal: controller.signal });
        if (!response.ok) throw new Error('Could not load templates.');
        const data: Template[] = await response.json();
        setTemplates(data);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load templates.');
        }
      }
    }
    void loadTemplates();
    return () => controller.abort();
  }, []);

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !saveDraft) return;
    const offsetValue = offset === '' ? undefined : Number(offset);
    if (offsetValue !== undefined && (!Number.isSafeInteger(offsetValue) || offsetValue < 0)) {
      setError('Due date offset must be a non-negative whole number.');
      return;
    }
    if ((saveDraft.isRecurring || saveDraft.reminderMinutes !== null) && offsetValue === undefined) {
      setError('A due date offset is required for recurring templates and reminders.');
      return;
    }
    const payload: CreateTemplateDto = {
      name: name.trim(),
      description: description.trim() || undefined,
      category: category.trim() || undefined,
      title_template: saveDraft.title.trim(),
      priority: saveDraft.priority,
      is_recurring: saveDraft.isRecurring,
      recurrence_pattern: saveDraft.isRecurring ? saveDraft.recurrencePattern : undefined,
      reminder_minutes: saveDraft.reminderMinutes ?? undefined,
      due_date_offset_minutes: offsetValue,
      subtasks: (checklist === sourceSubtasks.join('\n') ? sourceSubtasks : checklist.split('\n'))
        .map((title) => title.trim()).filter(Boolean)
        .map((title, position) => ({ title, position })),
    };
    setBusy(true);
    setError(null);
    try {
      const saved = await request<Template>('/api/templates', 'POST', payload);
      setTemplates((current) => [...current, saved]);
      setDialog(null);
      setName('');
      setDescription('');
      setCategory('');
      setOffset('');
      setChecklist('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save template.');
    } finally {
      setBusy(false);
    }
  }

  async function createFromTemplate(id: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const todo = await request<Todo>(`/api/templates/${id}/use`, 'POST');
      onCreated(todo);
      setDialog(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not use template.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(template: Template) {
    if (busy || !window.confirm(`Delete template "${template.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await request<{ success: boolean }>(`/api/templates/${template.id}`, 'DELETE');
      setTemplates((current) => current.filter((item) => item.id !== template.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not delete template.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-slate-700">
          <span className="mb-1 block">Use Template</span>
          <select
            aria-label="Use Template"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2"
            disabled={busy || templates.length === 0}
            onChange={(event) => {
              const id = Number(event.target.value);
              event.target.value = '';
              if (id) void createFromTemplate(id);
            }}
            defaultValue=""
          >
            <option value="">Select a template</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}{template.category ? ` (${template.category})` : ''}
              </option>
            ))}
          </select>
        </label>
        {draft.title.trim() && (
          <button className="rounded-xl border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700"
            onClick={() => {
              setSaveDraft(draft);
              setSourceSubtasks([]);
              setChecklist('');
              setName('');
              setDescription('');
              setCategory('');
              setOffset('');
              setError(null);
              setDialog('save');
            }} type="button">
            💾 Save as Template
          </button>
        )}
        <button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
          onClick={() => { setError(null); setDialog('manager'); }} type="button">
          📋 Templates
        </button>
      </div>
      {error && !dialog && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      {dialog && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/40 p-4"
          role="dialog" aria-modal="true" aria-label={dialog === 'save' ? 'Save as Template' : 'Template Manager'}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            {dialog === 'save' ? (
              <form onSubmit={saveTemplate} className="space-y-4">
                <h2 className="text-xl font-semibold">Save as Template</h2>
                <label className="block text-sm">Name
                  <input aria-label="Template name" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                    value={name} onChange={(event) => setName(event.target.value)} required />
                </label>
                <label className="block text-sm">Description (optional)
                  <textarea aria-label="Template description" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                    value={description} onChange={(event) => setDescription(event.target.value)} />
                </label>
                <label className="block text-sm">Category (optional)
                  <input aria-label="Template category" list="template-categories" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                    value={category} onChange={(event) => setCategory(event.target.value)} />
                </label>
                <datalist id="template-categories">
                  {['Work', 'Personal', 'Finance', 'Health', 'Education'].map((value) => <option key={value} value={value} />)}
                </datalist>
                <label className="block text-sm">Due date offset in minutes (optional)
                  <input aria-label="Due date offset in minutes" type="number" min="0" step="1"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                    value={offset} onChange={(event) => setOffset(event.target.value)} />
                </label>
                <label className="block text-sm">Template subtasks (one per line)
                  <textarea aria-label="Template subtasks" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                    value={checklist} onChange={(event) => setChecklist(event.target.value)} />
                </label>
                {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
                <div className="flex justify-end gap-3">
                  <button disabled={busy} onClick={() => setDialog(null)} type="button">Cancel</button>
                  <button className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={busy || !name.trim()} type="submit">Save Template</button>
                </div>
              </form>
            ) : (
              <>
                <h2 className="text-xl font-semibold">Template Manager</h2>
                {templates.length === 0 && <p className="mt-4 text-sm text-slate-500">No templates yet.</p>}
                <ul className="mt-4 space-y-3">
                  {templates.map((template) => (
                    <li key={template.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="break-all">{template.name}</strong>
                        {template.category && <span className="rounded-full bg-slate-100 px-2 text-xs">{template.category}</span>}
                      </div>
                      {template.description && <p className="mt-2 break-words text-sm">{template.description}</p>}
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-indigo-100 px-2 py-1">{template.priority} priority</span>
                        {template.is_recurring && <span className="rounded-full bg-purple-100 px-2 py-1">🔄 {template.recurrence_pattern}</span>}
                        {isReminderMinutes(template.reminder_minutes) && (
                          <span className="rounded-full bg-orange-100 px-2 py-1">🔔 {REMINDER_LABELS[template.reminder_minutes]}</span>
                        )}
                      </div>
                      <div className="mt-3 flex gap-4 text-sm">
                        <button disabled={busy} onClick={() => void createFromTemplate(template.id)} type="button">Use</button>
                        <button disabled={busy} className="text-red-700" onClick={() => void deleteTemplate(template)} type="button">Delete</button>
                      </div>
                    </li>
                  ))}
                </ul>
                {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
                <button className="mt-4 rounded-xl border border-slate-300 px-4 py-2 text-sm"
                  disabled={busy} onClick={() => setDialog(null)} type="button">Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
