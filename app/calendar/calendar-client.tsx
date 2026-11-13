'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Holiday, Todo } from '@/lib/db';
import {
  generateCalendarGrid,
  groupCalendarTodos,
  monthKey,
  moveMonth,
  parseMonthParam,
  type CalendarMonth,
} from '@/lib/calendar';
import {
  getSingaporeNow,
  parseSingaporeDateTime,
  singaporeCalendarDate,
} from '@/lib/timezone';
import { PRIORITY_BADGE_STYLES } from '@/lib/priority-styles';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthFormatter = new Intl.DateTimeFormat('en-SG', {
  month: 'long', year: 'numeric', timeZone: 'Asia/Singapore',
});

async function loadJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) {
    throw new Error(response.status === 401
      ? 'Your session expired. Please sign in again.'
      : 'Could not load calendar data. Please try again.');
  }
  return response.json();
}

function DayTodosModal({ date, todos, holiday, onClose }: {
  date: string;
  todos: Todo[];
  holiday?: Holiday;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  function dismiss() {
    dialog.current?.close();
    onClose();
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="day-detail-title"
      className="fixed inset-0 m-auto max-h-[85vh] w-[min(90vw,36rem)] overflow-y-auto rounded-2xl bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-950/50"
      onCancel={(event) => { event.preventDefault(); dismiss(); }}
      onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          event.preventDefault();
          closeButton.current?.focus();
        }
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="day-detail-title" className="text-xl font-bold">Todos for {date}</h2>
        <button ref={closeButton} autoFocus type="button" className="rounded-lg border px-3 py-2 font-semibold" onClick={dismiss}>
          Close
        </button>
      </div>
      {holiday && <p className="mt-4 rounded-lg bg-purple-100 p-3 text-purple-900">{holiday.name}</p>}
      {todos.length === 0 ? <p className="mt-4">No todos due on this day.</p> : (
        <ul className="mt-4 space-y-3">
          {todos.map((todo) => (
            <li key={todo.id} className="rounded-lg border border-slate-200 p-3">
              <p className={`break-words font-semibold ${todo.completed ? 'line-through' : ''}`}>{todo.title}</p>
              <span className={`mt-2 inline-block rounded-full border px-2 py-1 text-xs ${PRIORITY_BADGE_STYLES[todo.priority]}`}>
                {todo.priority} priority
              </span>
              <p className="mt-1 text-sm">{todo.completed ? 'Completed' : 'Incomplete'}</p>
            </li>
          ))}
        </ul>
      )}
    </dialog>
  );
}

export default function CalendarClient({ initialNow }: { initialNow: string }) {
  const searchParams = useSearchParams();
  const [now, setNow] = useState(() => {
    const parsed = parseSingaporeDateTime(initialNow);
    if (!parsed) throw new Error('Invalid calendar clock');
    return parsed;
  });
  const current = parseMonthParam(searchParams.get('month'), now);
  const { year, month } = current;
  const key = monthKey(current);
  const [data, setData] = useState<{ key: string; todos: Todo[]; holidays: Holiday[] } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selectedButton = useRef<HTMLButtonElement>(null);
  const grid = generateCalendarGrid(year, month, now);
  const loading = data?.key !== key;
  const error = failure?.key === key ? failure.message : null;
  const grouped = groupCalendarTodos(loading ? [] : data.todos);
  const holidays = new Map((loading ? [] : data.holidays).map((holiday) => [holiday.date, holiday]));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(getSingaporeNow()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const [todos, result] = await Promise.all([
          loadJson<Todo[]>('/api/todos', controller.signal),
          loadJson<{ holidays: Holiday[] }>(`/api/holidays?year=${year}&month=${month}`, controller.signal),
        ]);
        if (!controller.signal.aborted) {
          setData({ key, todos, holidays: result.holidays });
          setFailure(null);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setFailure({ key, message: error instanceof Error ? error.message : 'Could not load calendar data.' });
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [year, month, key, retry]);

  function navigate(target: CalendarMonth) {
    setSelectedDate(null);
    const url = new URL(window.location.href);
    url.searchParams.set('month', monthKey(target));
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }

  return (
    <section aria-label="Monthly calendar" className="mt-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 aria-live="polite" className="text-2xl font-bold">
          {monthFormatter.format(singaporeCalendarDate(year, month, 1))}
        </h2>
        <div className="flex gap-2">
          <button type="button" className="rounded-lg border bg-white px-3 py-2" onClick={() => navigate(moveMonth(current, -1))}>Previous month</button>
          <button type="button" className="rounded-lg border bg-white px-3 py-2" onClick={() => navigate(parseMonthParam(null, getSingaporeNow()))}>Today</button>
          <button type="button" className="rounded-lg border bg-white px-3 py-2" onClick={() => navigate(moveMonth(current, 1))}>Next month</button>
        </div>
      </div>
      <p className="mb-3 text-sm text-slate-600">Singapore time (SGT). High: red; medium: yellow; low: blue. All due-dated todos are shown.</p>
      {error ? (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-red-800">
          {error} <button type="button" className="underline" onClick={() => setRetry((value) => value + 1)}>Retry</button>
        </div>
      ) : loading && <p role="status">Loading todos and holidays...</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white">
        <table aria-label="Calendar days" aria-busy={loading && !error} className="w-full min-w-[700px] table-fixed border-collapse">
          <thead><tr>{DAYS.map((day) => <th key={day} scope="col" className="border-b border-slate-300 p-2 text-sm">{day}</th>)}</tr></thead>
          <tbody>
            {Array.from({ length: 6 }, (_, week) => (
              <tr key={week}>
                {grid.slice(week * 7, week * 7 + 7).map((day) => {
                  const todos = grouped.get(day.date) ?? [];
                  const holiday = holidays.get(day.date);
                  return (
                    <td key={day.date} className="h-40 border border-slate-200 p-0 align-top">
                      <button
                        type="button"
                        data-date={day.date}
                        aria-label={`${day.date}, ${todos.length} todos${holiday ? `, ${holiday.name}` : ''}`}
                        aria-current={day.isToday ? 'date' : undefined}
                        className={`flex h-40 w-full flex-col gap-1 overflow-hidden p-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-700 ${day.isToday ? 'bg-indigo-100 ring-2 ring-inset ring-indigo-600' : !day.isCurrentMonth ? 'bg-slate-100 text-slate-500' : day.isWeekend ? 'bg-purple-50' : 'bg-white'} ${day.isPast && day.isCurrentMonth && !day.isToday ? 'text-slate-500' : ''}`}
                        onClick={(event) => {
                          selectedButton.current = event.currentTarget;
                          setSelectedDate(day.date);
                        }}
                      >
                        <span className="text-sm font-bold">{Number(day.date.slice(-2))}{day.isToday && <span className="sr-only"> Today</span>}</span>
                        {holiday && <span title={holiday.name} className="w-full truncate rounded bg-purple-100 px-1 text-xs font-semibold text-purple-900">{holiday.name}</span>}
                        {todos.slice(0, 3).map((todo) => (
                          <span key={todo.id} title={`${todo.title} (${todo.priority} priority${todo.completed ? ', completed' : ''})`} className={`block w-full truncate rounded border px-1 text-xs ${PRIORITY_BADGE_STYLES[todo.priority]} ${todo.completed ? 'line-through' : ''}`}>
                            <span className="sr-only">{todo.priority} priority: </span>{todo.title}
                          </span>
                        ))}
                        {todos.length > 3 && <span className="text-xs font-semibold text-indigo-800">+{todos.length - 3} more</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-600">Holiday coverage: 2025–2027 when seeded. Sunday replacement holidays apply when Sunday is your rest day.</p>
      {selectedDate && (
        <DayTodosModal
          date={selectedDate}
          todos={grouped.get(selectedDate) ?? []}
          holiday={holidays.get(selectedDate)}
          onClose={() => {
            setSelectedDate(null);
            selectedButton.current?.focus();
          }}
        />
      )}
    </section>
  );
}
