import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateCalendarGrid,
  groupCalendarTodos,
  monthKey,
  moveMonth,
  parseMonthParam,
} from '../lib/calendar.ts';
import {
  formatSingaporeDate,
  singaporeCalendarDate,
} from '../lib/timezone.ts';
import { SINGAPORE_HOLIDAYS } from '../lib/holidays.ts';

const boundary = new Date('2026-02-28T16:30:00Z');

test('calendar grids always have 42 unique consecutive Sun-Sat cells', () => {
  for (const [year, month, days, first, last] of [
    [2026, 2, 28, '2026-02-01', '2026-03-14'],
    [2028, 2, 29, '2028-01-30', '2028-03-11'],
    [2026, 3, 31, '2026-03-01', '2026-04-11'],
    [2026, 8, 31, '2026-07-26', '2026-09-05'],
    [2026, 12, 31, '2026-11-29', '2027-01-09'],
  ]) {
    const grid = generateCalendarGrid(year, month, boundary);
    assert.equal(grid.length, 42);
    assert.equal(new Set(grid.map((day) => day.date)).size, 42);
    assert.equal(grid.filter((day) => day.isCurrentMonth).length, days);
    assert.equal(grid[0].date, first);
    assert.equal(grid[41].date, last);
    for (const [index, day] of grid.entries()) {
      assert.equal(day.isWeekend, index % 7 === 0 || index % 7 === 6);
      if (index) {
        assert.equal(Date.parse(`${day.date}T12:00+08:00`)
          - Date.parse(`${grid[index - 1].date}T12:00+08:00`), 86_400_000);
      }
    }
  }
  assert.ok(generateCalendarGrid(2028, 2).find((day) => day.date === '2028-02-29')?.isCurrentMonth);
  assert.throws(() => generateCalendarGrid(2026, 0), RangeError);
  assert.throws(() => generateCalendarGrid(2026, 13), RangeError);
  assert.throws(() => generateCalendarGrid(NaN, 1), RangeError);
  assert.throws(() => generateCalendarGrid(2026, 1.5), RangeError);
});

test('today and past flags use Singapore date even when UTC is yesterday', () => {
  const grid = generateCalendarGrid(2026, 3, boundary);
  assert.equal(formatSingaporeDate(boundary, 'yyyy-MM-dd'), '2026-03-01');
  assert.deepEqual(grid.filter((day) => day.isToday).map((day) => day.date), ['2026-03-01']);
  assert.equal(grid[0].isPast, false);
  assert.equal(generateCalendarGrid(2026, 2, boundary).find((day) => day.date === '2026-02-28').isPast, true);
  assert.equal(generateCalendarGrid(2028, 2, boundary).some((day) => day.isToday), false);
  assert.equal(formatSingaporeDate(singaporeCalendarDate(99, 2, 1), 'yyyy-MM-dd'), '0099-02-01');
});

test('month parsing rejects malformed/out-of-range input and navigation crosses years', () => {
  for (const input of [null, '', 'abc', '2026-13', '2026-00', '2026-2', '0000-01']) {
    assert.deepEqual(parseMonthParam(input, boundary), { year: 2026, month: 3 });
  }
  assert.deepEqual(parseMonthParam('2028-02', boundary), { year: 2028, month: 2 });
  assert.deepEqual(moveMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(moveMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  assert.deepEqual(moveMonth({ year: 2026, month: 6 }, -7), { year: 2025, month: 11 });
  assert.equal(monthKey({ year: 99, month: 2 }), '0099-02');
});

test('todo grouping handles local/offset/UTC due dates, completed items and priority order', () => {
  const todos = [
    { id: 1, due_date: '2026-03-01T00:30', priority: 'low', completed: true },
    { id: 2, due_date: '2026-02-28T16:30:00Z', priority: 'high' },
    { id: 3, due_date: '2026-02-28T23:30:00-01:00', priority: 'medium' },
    { id: 4, due_date: null, priority: 'high' },
    { id: 5, due_date: '2026-03-01T10:00:00+08:00', priority: 'high' },
    { id: 6, due_date: '2026-03-02T10:00:00+08:00', priority: 'low' },
    { id: 7, due_date: '2026-03-01T10:00:00+08:00', priority: 'high' },
  ];
  const grouped = groupCalendarTodos(todos);
  assert.deepEqual(grouped.get('2026-03-01').map((todo) => todo.id), [2, 5, 7, 3, 1]);
  assert.equal(grouped.get('2026-03-01').at(-1).completed, true);
  assert.deepEqual(grouped.get('2026-03-02').map((todo) => todo.id), [6]);
  assert.equal(grouped.size, 2);
  assert.throws(() => groupCalendarTodos([{ id: 8, due_date: 'not-a-date' }]), /invalid due date/);
});

test('holiday seed dates are unique, valid and cover 2025 through 2027', () => {
  assert.equal(new Set(SINGAPORE_HOLIDAYS.map((day) => day.date)).size, SINGAPORE_HOLIDAYS.length);
  assert.deepEqual([...new Set(SINGAPORE_HOLIDAYS.map((day) => day.date.slice(0, 4)))], ['2025', '2026', '2027']);
  for (const holiday of SINGAPORE_HOLIDAYS) {
    const [year, month, day] = holiday.date.split('-').map(Number);
    assert.equal(formatSingaporeDate(singaporeCalendarDate(year, month, day), 'yyyy-MM-dd'), holiday.date);
    assert.ok(holiday.name);
  }
});
