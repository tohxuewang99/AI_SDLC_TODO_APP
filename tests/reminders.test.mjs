import assert from 'node:assert/strict';
import test from 'node:test';
import { isReminderDue, isReminderMinutes, REMINDER_LABELS } from '../lib/reminders.ts';
import { parseCreateTodoInput, parseUpdateTodoInput } from '../lib/todo-validation.ts';

const todo = {
  id: 1, user_id: 1, title: 'Reminder', completed: false, priority: 'medium',
  due_date: '2026-01-01T00:05', reminder_minutes: 15, last_notification_sent: null,
  is_recurring: false, recurrence_pattern: null, tags: [],
  created_at: '2025-01-01T00:00:00Z', updated_at: null,
};

test('all seven presets open at the exact Singapore reminder boundary', () => {
  assert.equal(Object.keys(REMINDER_LABELS).length, 7);
  for (const minutes of Object.keys(REMINDER_LABELS).map(Number)) {
    const scheduled = { ...todo, reminder_minutes: minutes };
    const boundary = Date.parse('2025-12-31T16:05:00Z') - minutes * 60_000;
    assert.equal(isReminderDue(scheduled, new Date(boundary - 1)), false);
    assert.equal(isReminderDue(scheduled, new Date(boundary)), true);
    assert.equal(isReminderDue(scheduled, new Date(boundary + 1)), true);
    assert.equal(isReminderDue(
      { ...scheduled, due_date: '2026-01-01T00:05:00+08:00' }, new Date(boundary),
    ), true);
    assert.equal(isReminderDue(
      { ...scheduled, due_date: '2025-12-31T16:05:00Z' }, new Date(boundary),
    ), true);
  }
});

test('reminder eligibility excludes completed, unscheduled, sent and overdue todos', () => {
  const now = new Date('2025-12-31T16:05:00Z');
  assert.equal(isReminderDue(todo, now), true);
  assert.equal(isReminderDue(todo, new Date(now.getTime() + 1)), false);
  for (const change of [
    { completed: true }, { due_date: null }, { reminder_minutes: null },
    { last_notification_sent: '2026-01-01T00:00:00Z' },
  ]) {
    assert.equal(isReminderDue({ ...todo, ...change }, now), false);
  }
  assert.throws(() => isReminderDue({ ...todo, due_date: 'invalid' }, now), /invalid due date/);
});

test('reminder validation accepts only presets and requires a due date', () => {
  for (const value of [1, 14, 0, -15, 15.5, '15', NaN, Infinity]) {
    assert.equal(isReminderMinutes(value), false);
    assert.throws(() => parseUpdateTodoInput({ reminder_minutes: value }, todo), /timing/);
  }
  assert.throws(() => parseCreateTodoInput({ title: 'No due', reminder_minutes: 15 }), /due date/);
  assert.throws(() => parseUpdateTodoInput({ reminder_minutes: 15 }, {
    ...todo, due_date: null, reminder_minutes: null,
  }), /due date/);
  assert.equal(parseUpdateTodoInput({ due_date: null }, todo).reminder_minutes, null);
  assert.equal(parseUpdateTodoInput({ reminder_minutes: null }, todo).reminder_minutes, null);
});

test('delivery stamps require a valid zoned timestamp and normalize to UTC', () => {
  assert.equal(parseUpdateTodoInput({
    last_notification_sent: '2026-01-01T00:05:00+08:00',
  }, todo).last_notification_sent, '2025-12-31T16:05:00.000Z');
  assert.equal(parseUpdateTodoInput({ last_notification_sent: null }, todo).last_notification_sent, null);
  for (const value of ['invalid', '2026-01-01T00:05', '2026-02-30T00:00:00Z', 42]) {
    assert.throws(() => parseUpdateTodoInput({ last_notification_sent: value }, todo), /timestamp/);
  }
});
