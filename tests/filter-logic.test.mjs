import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyFilters,
  DEFAULT_FILTER_STATE,
  hasActiveFilters,
} from '../lib/filters.ts';

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
    created_at: '2026-11-13T00:00:00.000Z',
    updated_at: null,
    subtasks: [],
    tags: [],
    ...values,
  };
}

function withFilters(values) {
  return { ...DEFAULT_FILTER_STATE, ...values };
}

test('search matches todo and subtask titles case-insensitively and ignores blank queries', () => {
  const todos = [
    todo(1, { title: 'Team meeting' }),
    todo(2, {
      title: 'Prepare notes',
      subtasks: [{
        id: 1,
        todo_id: 2,
        title: 'Review MEETING agenda',
        completed: false,
        position: 0,
      }],
    }),
    todo(3, { title: 'Unrelated work' }),
  ];

  assert.deepEqual(applyFilters(todos, withFilters({ search: ' MEETING ' })).map((item) => item.id), [1, 2]);
  assert.deepEqual(applyFilters(todos, withFilters({ search: 'agenda' })).map((item) => item.id), [2]);
  assert.deepEqual(applyFilters(todos, withFilters({ search: 'missing' })), []);
  assert.deepEqual(applyFilters(todos, withFilters({ search: '   ' })), todos);
  assert.deepEqual(applyFilters(todos, DEFAULT_FILTER_STATE), todos);
});

test('priority filters match each priority and all returns every todo', () => {
  const todos = [
    todo(1, { priority: 'high' }),
    todo(2, { priority: 'medium' }),
    todo(3, { priority: 'low' }),
  ];

  for (const priority of ['high', 'medium', 'low']) {
    assert.deepEqual(
      applyFilters(todos, withFilters({ priority })).map((item) => item.priority),
      [priority],
    );
  }
  assert.deepEqual(applyFilters(todos, withFilters({ priority: 'all' })), todos);
});

test('tag filters include matching todos, exclude untagged todos, and support all', () => {
  const todos = [
    todo(1, { tags: [{ id: 7 }] }),
    todo(2, { tags: [{ id: 8 }, { id: 7 }] }),
    todo(3),
  ];

  assert.deepEqual(applyFilters(todos, withFilters({ tagId: 7 })).map((item) => item.id), [1, 2]);
  assert.deepEqual(applyFilters(todos, withFilters({ tagId: 8 })).map((item) => item.id), [2]);
  assert.deepEqual(applyFilters(todos, withFilters({ tagId: 'all' })), todos);
});

test('completion filters select incomplete, completed, or all todos', () => {
  const todos = [
    todo(1, { completed: false }),
    todo(2, { completed: true }),
  ];

  assert.deepEqual(applyFilters(todos, withFilters({ completion: 'incomplete' })).map((item) => item.id), [1]);
  assert.deepEqual(applyFilters(todos, withFilters({ completion: 'completed' })).map((item) => item.id), [2]);
  assert.deepEqual(applyFilters(todos, withFilters({ completion: 'all' })), todos);
});

test('date filters support either bound, both bounds, no bounds, null dates, and reversed ranges', () => {
  const todos = [
    todo(1, { due_date: '2026-11-01T10:00:00+08:00' }),
    todo(2, { due_date: '2026-11-07T10:00:00+08:00' }),
    todo(3, { due_date: '2026-11-14T10:00:00+08:00' }),
    todo(4, { due_date: null }),
  ];

  assert.deepEqual(applyFilters(todos, withFilters({ dueDateFrom: '2026-11-07' })).map((item) => item.id), [2, 3]);
  assert.deepEqual(applyFilters(todos, withFilters({ dueDateTo: '2026-11-07' })).map((item) => item.id), [1, 2]);
  assert.deepEqual(
    applyFilters(todos, withFilters({ dueDateFrom: '2026-11-01', dueDateTo: '2026-11-07' }))
      .map((item) => item.id),
    [1, 2],
  );
  assert.deepEqual(applyFilters(todos, DEFAULT_FILTER_STATE), todos);
  assert.deepEqual(
    applyFilters(todos, withFilters({ dueDateFrom: '2026-11-08', dueDateTo: '2026-11-07' })),
    [],
  );
});

test('all active filters form an AND intersection in the documented order', () => {
  const todos = [
    todo(1, {
      title: 'Team launch',
      priority: 'high',
      tags: [{ id: 5 }],
      completed: false,
      due_date: '2026-11-05T10:00:00+08:00',
    }),
    todo(2, {
      title: 'Team launch',
      priority: 'medium',
      tags: [{ id: 5 }],
      completed: false,
      due_date: '2026-11-05T10:00:00+08:00',
    }),
    todo(3, {
      title: 'Team launch',
      priority: 'high',
      tags: [{ id: 6 }],
      completed: false,
      due_date: '2026-11-05T10:00:00+08:00',
    }),
    todo(4, {
      title: 'Team launch',
      priority: 'high',
      tags: [{ id: 5 }],
      completed: true,
      due_date: '2026-11-05T10:00:00+08:00',
    }),
    todo(5, {
      title: 'Team launch',
      priority: 'high',
      tags: [{ id: 5 }],
      completed: false,
      due_date: '2026-11-12T10:00:00+08:00',
    }),
    todo(6, {
      title: 'Different title',
      priority: 'high',
      tags: [{ id: 5 }],
      completed: false,
      due_date: '2026-11-05T10:00:00+08:00',
    }),
  ];

  const filters = withFilters({
    search: 'TEAM',
    priority: 'high',
    tagId: 5,
    completion: 'incomplete',
    dueDateFrom: '2026-11-01',
    dueDateTo: '2026-11-07',
  });
  assert.deepEqual(applyFilters(todos, filters).map((item) => item.id), [1]);
});

test('hasActiveFilters recognizes each dimension and ignores a whitespace-only search', () => {
  assert.equal(hasActiveFilters(DEFAULT_FILTER_STATE), false);
  assert.equal(hasActiveFilters(withFilters({ search: '   ' })), false);
  for (const filters of [
    { search: 'meeting' },
    { priority: 'high' },
    { tagId: 5 },
    { completion: 'completed' },
    { dueDateFrom: '2026-11-01' },
    { dueDateTo: '2026-11-07' },
  ]) {
    assert.equal(hasActiveFilters(withFilters(filters)), true);
  }
});

test('filters 1,000 todos within the 100 ms target', () => {
  const todos = Array.from({ length: 1_000 }, (_, index) => todo(index, {
    title: `Task ${index}`,
    priority: index % 3 === 0 ? 'high' : 'medium',
    tags: [{ id: index % 4 }],
    subtasks: [{
      id: index,
      todo_id: index,
      title: `Subtask ${index}`,
      completed: false,
      position: 0,
    }],
    due_date: '2026-11-05T10:00:00+08:00',
  }));
  const filters = withFilters({
    search: 'subtask 9',
    priority: 'high',
    tagId: 1,
    completion: 'incomplete',
    dueDateFrom: '2026-11-01',
    dueDateTo: '2026-11-07',
  });

  const start = performance.now();
  applyFilters(todos, filters);
  assert.ok(performance.now() - start < 100);
});
