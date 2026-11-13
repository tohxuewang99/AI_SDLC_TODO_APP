import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isDueDateAtLeastOneMinuteAway,
  parseSingaporeDateTime,
} from '../lib/timezone.ts';
import { sectionTodos, sortTodos } from '../lib/todo-logic.ts';
import { normalizeTodoTitle } from '../lib/todo-validation.ts';

const now = new Date('2026-11-13T06:00:00.000Z');

function todo(id, values = {}) {
  return {
    id,
    user_id: 1,
    title: `Todo ${id}`,
    completed: false,
    due_date: null,
    priority: 'medium',
    is_recurring: false,
    recurrence_pattern: null,
    reminder_minutes: null,
    last_notification_sent: null,
    created_at: `2026-11-13T05:${String(id).padStart(2, '0')}:00.000Z`,
    updated_at: null,
    ...values,
  };
}

test('sorts todos by priority, due date, then newest creation time', () => {
  const todos = [
    todo(1, { priority: 'medium', due_date: '2026-11-13T09:00:00+08:00' }),
    todo(2, { priority: 'high', due_date: '2026-11-13T11:00:00+08:00' }),
    todo(3, { priority: 'medium', due_date: '2026-11-13T08:00:00+08:00' }),
    todo(4, { priority: 'medium', due_date: '2026-11-13T08:00:00+08:00', created_at: '2026-11-13T06:00:00Z' }),
    todo(5, { priority: 'low' }),
  ];

  assert.deepEqual(sortTodos(todos).map((item) => item.id), [2, 4, 3, 1, 5]);
});

test('sections todos at the due-time boundary and sorts completed newest first', () => {
  const boundary = todo(1, { due_date: now.toISOString() });
  const overdue = todo(2, { due_date: '2026-11-13T05:59:59.999Z' });
  const completed = todo(3, {
    completed: true,
    due_date: '2026-11-13T05:00:00.000Z',
    updated_at: '2026-11-13T06:30:00.000Z',
  });
  const sections = sectionTodos([boundary, overdue, completed, todo(4)], now);

  assert.deepEqual(sections.overdue.map((item) => item.id), [2]);
  assert.deepEqual(sections.pending.map((item) => item.id), [1, 4]);
  assert.deepEqual(sections.completed.map((item) => item.id), [3]);
});

test('validates Singapore local dates and the inclusive one-minute minimum', () => {
  const nowAtMinute = new Date('2026-11-13T06:00:00.000Z');
  const atBoundary = parseSingaporeDateTime('2026-11-13T14:01');
  const justBefore = parseSingaporeDateTime('2026-11-13T14:00:59');

  assert.ok(atBoundary);
  assert.ok(justBefore);
  assert.equal(atBoundary?.toISOString(), '2026-11-13T06:01:00.000Z');
  assert.equal(isDueDateAtLeastOneMinuteAway(atBoundary, nowAtMinute), true);
  assert.equal(isDueDateAtLeastOneMinuteAway(justBefore, nowAtMinute), false);
  assert.equal(parseSingaporeDateTime('2026-02-30T14:01'), null);
  assert.equal(parseSingaporeDateTime('not-a-date'), null);
});

test('trims todo titles and rejects missing or whitespace-only titles', () => {
  assert.equal(normalizeTodoTitle('  Write tests  '), 'Write tests');
  assert.equal(normalizeTodoTitle('   '), null);
  assert.equal(normalizeTodoTitle(undefined), null);
});
