import { expect, test, type Page } from '@playwright/test';
import { calculateNextDueDate } from '../lib/recurrence';

const virtualAuthenticatorOptions = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

function uniqueUsername(): string {
  return `recurring-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function singaporeDateTimeHoursFromNow(hours: number): string {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

async function register(page: Page, username: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: virtualAuthenticatorOptions,
  });
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page).toHaveURL('/');
}

test('calculates daily and weekly recurrence in Singapore wall time', () => {
  expect(calculateNextDueDate('2025-11-10T14:00', 'daily'))
    .toBe('2025-11-11T14:00');
  expect(calculateNextDueDate('2025-11-10T14:00', 'weekly'))
    .toBe('2025-11-17T14:00');
});

test('clamps monthly recurrence at month ends and across year boundaries', () => {
  expect(calculateNextDueDate('2025-01-31T09:00', 'monthly'))
    .toBe('2025-02-28T09:00');
  expect(calculateNextDueDate('2024-01-31T09:00', 'monthly'))
    .toBe('2024-02-29T09:00');
  expect(calculateNextDueDate('2025-12-31T09:00', 'monthly'))
    .toBe('2026-01-31T09:00');
});

test('clamps yearly leap-day recurrence and preserves seconds and Singapore offset', () => {
  expect(calculateNextDueDate('2024-02-29T09:15:32', 'yearly'))
    .toBe('2025-02-28T09:15:32');
  expect(calculateNextDueDate('2025-11-10T14:00:17+08:00', 'daily'))
    .toBe('2025-11-11T14:00:17');
});

test.describe('recurring todo API and UI', () => {
  test('creates the next daily instance only when a todo is completed', async ({ page }) => {
    await register(page, uniqueUsername());
    const title = `Daily task ${Date.now()}`;
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Due date').fill(singaporeDateTimeHoursFromNow(2));
    await page.getByLabel('Repeat').check();
    await page.getByLabel('Recurrence pattern').selectOption('daily');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    const todoItem = page.getByRole('listitem').filter({ hasText: title });
    await expect(todoItem).toHaveCount(1);
    await expect(todoItem.getByText('🔄 daily')).toBeVisible();
    await todoItem.getByRole('checkbox', { name: `Mark "${title}" as complete` }).click();
    await expect(page.getByRole('listitem').filter({ hasText: title })).toHaveCount(2);
    await expect(
      page.getByRole('checkbox', { name: `Mark "${title}" as incomplete` }),
    ).toBeVisible();
  });

  test('rejects recurring todos without a due date or a valid pattern', async ({ page }) => {
    await register(page, uniqueUsername());
    const results = await page.evaluate(async () => {
      const missingDate = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'No date', is_recurring: true, recurrence_pattern: 'daily' }),
      });
      const invalidPattern = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Bad pattern',
          due_date: new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Asia/Singapore',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).format(new Date(Date.now() + 2 * 60 * 60 * 1000)).replace(' ', 'T'),
          is_recurring: true,
          recurrence_pattern: 'fortnightly',
        }),
      });
      return {
        missingDate: { status: missingDate.status, body: await missingDate.json() },
        invalidPattern: { status: invalidPattern.status, body: await invalidPattern.json() },
      };
    });
    expect(results.missingDate.status).toBe(400);
    expect(results.missingDate.body.error).toBe('Recurring todos require a due date');
    expect(results.invalidPattern.status).toBe(400);
    expect(results.invalidPattern.body.error).toBe('Invalid recurrence pattern');
  });

  test('inherits current priority, reminder, and tags and prevents duplicate instances', async ({ page }) => {
    await register(page, uniqueUsername());
    const dueDate = singaporeDateTimeHoursFromNow(3);
    const result = await page.evaluate(async (nextDueDate) => {
      const tagResponse = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `routine-${Date.now()}` }),
      });
      const tag = await tagResponse.json();
      const todoResponse = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Tagged weekly task',
          due_date: nextDueDate,
          priority: 'high',
          is_recurring: true,
          recurrence_pattern: 'weekly',
          reminder_minutes: 60,
          tag_ids: [tag.id],
        }),
      });
      const todo = await todoResponse.json();
      const completionResponse = await fetch(`/api/todos/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: true }),
      });
      const completion = await completionResponse.json();
      const secondCompletion = await fetch(`/api/todos/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: true }),
      });
      const secondResult = await secondCompletion.json();
      const list = await fetch('/api/todos');
      return {
        tagStatus: tagResponse.status,
        todoStatus: todoResponse.status,
        completionStatus: completionResponse.status,
        completion,
        secondResult,
        todos: await list.json(),
      };
    }, dueDate);

    expect(result.tagStatus).toBe(201);
    expect(result.todoStatus).toBe(201);
    expect(result.completionStatus).toBe(200);
    expect(result.completion.nextInstance.priority).toBe('high');
    expect(result.completion.nextInstance.reminder_minutes).toBe(60);
    expect(result.completion.nextInstance.recurrence_pattern).toBe('weekly');
    expect(result.completion.nextInstance.tags).toHaveLength(1);
    expect(result.completion.nextInstance.due_date)
      .toBe(calculateNextDueDate(dueDate, 'weekly'));
    expect(result.secondResult.nextInstance).toBeUndefined();
    expect(result.todos.filter((todo: { title: string }) => todo.title === 'Tagged weekly task'))
      .toHaveLength(2);
  });

  test('disabling recurrence stops future instance creation', async ({ page }) => {
    await register(page, uniqueUsername());
    const title = `Stop repeat ${Date.now()}`;
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Due date').fill(singaporeDateTimeHoursFromNow(2));
    await page.getByLabel('Repeat').check();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const todoItem = page.getByRole('listitem').filter({ hasText: title });
    await todoItem.getByRole('button', { name: 'Edit' }).click();
    await todoItem.getByLabel('Repeat', { exact: true }).uncheck();
    await todoItem.getByRole('button', { name: 'Update' }).click();
    await todoItem.getByRole('checkbox', { name: `Mark "${title}" as complete` }).click();
    await expect(page.getByRole('listitem').filter({ hasText: title })).toHaveCount(1);
  });
});
