import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateProgress } from '../lib/subtask-logic.ts';

function subtasks(total, completedCount) {
  return Array.from({ length: total }, (_, index) => ({
    id: index + 1,
    todo_id: 1,
    title: `Subtask ${index + 1}`,
    completed: index < completedCount,
    position: index,
    created_at: '2026-11-13T00:00:00.000Z',
  }));
}

test('calculates empty and incomplete subtask progress', () => {
  assert.deepEqual(calculateProgress([]), { completed: 0, total: 0, percent: 0 });
  assert.deepEqual(calculateProgress(subtasks(3, 0)), { completed: 0, total: 3, percent: 0 });
});

test('calculates partial and complete progress with predictable rounding', () => {
  assert.deepEqual(calculateProgress(subtasks(7, 3)), { completed: 3, total: 7, percent: 43 });
  assert.equal(calculateProgress(subtasks(3, 1)).percent, 33);
  assert.equal(calculateProgress(subtasks(3, 2)).percent, 67);
  assert.deepEqual(calculateProgress(subtasks(4, 4)), { completed: 4, total: 4, percent: 100 });
});
