import { performance } from 'node:perf_hooks';
import { expect, test, type Page } from '@playwright/test';
import type { Todo } from '../lib/db';

async function register(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
  await page.goto('/login');
  await page.getByLabel('Username').fill(`backup-qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page).toHaveURL('/');
}

function item(title = 'Historical imported task') {
  return {
    title,
    completed: false,
    due_date: '2026-03-01T00:30:00+08:00',
    priority: 'high',
    is_recurring: true,
    recurrence_pattern: 'monthly',
    reminder_minutes: 15,
    created_at: '2026-01-15T12:00:00+08:00',
    subtasks: [
      { title: 'First child', completed: true, position: 8 },
      { title: 'Second child', completed: false, position: 8 },
    ],
    tags: [{ name: 'work', color: '#FF0000' }, { name: 'New tag', color: '#123456' }],
  };
}

function envelope(todos = [item()]) {
  return { version: 1, exported_at: '2026-03-02T10:00:00+08:00', todos };
}

async function todos(page: Page): Promise<Todo[]> {
  const response = await page.request.get('/api/todos');
  expect(response.status()).toBe(200);
  return response.json();
}

test('backup endpoints check authentication before parsing input', async ({ request }) => {
  const exported = await request.get('/api/todos/export?format=json');
  const csv = await request.get('/api/todos/export?format=csv');
  const imported = await request.post('/api/todos/import', {
    data: Buffer.from('{broken'),
    headers: { 'Content-Type': 'application/json' },
  });
  for (const response of [exported, csv, imported]) {
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: 'Not authenticated' });
  }
});

test('invalid documents leave todos and tags unchanged, while an empty backup succeeds', async ({ page }) => {
  await register(page);
  const malformed = await page.request.post('/api/todos/import', {
    data: Buffer.from('{broken'),
    headers: { 'Content-Type': 'application/json' },
  });
  expect(malformed.status()).toBe(400);
  expect(await malformed.json()).toEqual({ error: 'Invalid JSON format' });

  const invalidDocuments = [
    { version: 2, exported_at: '2026-03-02', todos: [] },
    { version: 1, exported_at: '2026-03-02' },
    envelope([item('Valid first item'), { ...item('Invalid second'), priority: 'urgent' }]),
    envelope([{ ...item(), reminder_minutes: 17 }]),
    envelope([{ ...item(), recurrence_pattern: 'hourly' }]),
    { ...envelope(), todos: [{ ...item(), completed: 'false' }] },
  ];
  for (const document of invalidDocuments) {
    const response = await page.request.post('/api/todos/import', { data: document });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Failed to import todos. Please check the file format.',
    });
    expect(await todos(page)).toEqual([]);
    const tags = await page.request.get('/api/tags');
    expect(await tags.json()).toEqual([]);
  }
  const empty = await page.request.post('/api/todos/import', { data: envelope([]) });
  expect(empty.status()).toBe(200);
  expect(await empty.json()).toMatchObject({ imported: 0 });
});

test('restores historical dates and relationships, reuses tag color, duplicates todos and integrates with calendar', async ({ page }) => {
  await register(page);
  const existingTag = await page.request.post('/api/tags', {
    data: { name: 'Work', color: '#00AA00' },
  });
  expect(existingTag.status()).toBe(201);
  const work = await existingTag.json();
  const payload = envelope();
  const first = await page.request.post('/api/todos/import', { data: payload });
  expect(first.status()).toBe(200);
  expect(await first.json()).toMatchObject({ imported: 1, tagsCreated: 1, tagsReused: 1 });
  const [restored] = await todos(page);
  expect(restored).toMatchObject({
    title: payload.todos[0].title, completed: false, priority: 'high',
    is_recurring: true, recurrence_pattern: 'monthly', reminder_minutes: 15,
    last_notification_sent: null,
  });
  expect(Date.parse(restored.due_date!)).toBe(Date.parse(payload.todos[0].due_date));
  expect(restored.subtasks).toMatchObject([
    { title: 'First child', completed: true, position: 0, todo_id: restored.id },
    { title: 'Second child', completed: false, position: 1, todo_id: restored.id },
  ]);
  expect(restored.tags).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: work.id, name: 'Work', color: '#00AA00' }),
    expect.objectContaining({ name: 'New tag', color: '#123456' }),
  ]));

  const second = await page.request.post('/api/todos/import', { data: payload });
  expect(second.status()).toBe(200);
  const repeated = await todos(page);
  expect(repeated).toHaveLength(2);
  expect(new Set(repeated.map(todo => todo.id)).size).toBe(2);
  expect(new Set(repeated.flatMap(todo => todo.subtasks!.map(child => child.id))).size).toBe(4);
  expect(await (await page.request.get('/api/tags')).json()).toHaveLength(2);

  await page.goto('/calendar?month=2026-03');
  const calendar = page.getByRole('table', { name: 'Calendar days' });
  await expect(calendar).toHaveAttribute('aria-busy', 'false');
  const day = page.locator('[data-date="2026-03-01"]');
  await expect(day.getByTitle(`${payload.todos[0].title} (high priority)`, { exact: true })).toHaveCount(2);
});

test('export is account-scoped and portable to another account with fresh relationship IDs', async ({ page, browser }) => {
  await register(page);
  expect((await page.request.post('/api/todos/import', { data: envelope() })).status()).toBe(200);
  const original = (await todos(page))[0];
  const response = await page.request.get('/api/todos/export?format=json');
  expect(response.status()).toBe(200);
  const backup = await response.json();
  expect(backup).toMatchObject({ version: 1, todos: [{ title: original.title }] });
  expect(backup.todos).toHaveLength(1);
  for (const key of ['id', 'user_id', 'updated_at', 'last_notification_sent']) {
    expect(backup.todos[0]).not.toHaveProperty(key);
  }
  expect(backup.todos[0].subtasks[0]).not.toHaveProperty('id');
  expect(backup.todos[0].subtasks[0]).not.toHaveProperty('todo_id');
  expect(Object.keys(backup.todos[0].tags[0]).sort()).toEqual(['color', 'name']);

  const otherContext = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
  try {
    const other = await otherContext.newPage();
    await register(other);
    expect((await other.request.get(`/api/todos/${original.id}`)).status()).toBe(404);
    const emptyExport = await other.request.get('/api/todos/export?format=json');
    expect((await emptyExport.json()).todos).toEqual([]);
    expect((await other.request.post('/api/todos/import', { data: backup })).status()).toBe(200);
    const [copy] = await todos(other);
    expect(copy.id).not.toBe(original.id);
    expect(copy.user_id).not.toBe(original.user_id);
    expect(copy.subtasks!.map(child => child.id)).not.toEqual(original.subtasks!.map(child => child.id));
    expect(copy.tags!.every(tag => !original.tags!.some(source => source.id === tag.id))).toBe(true);
    expect(await todos(page)).toHaveLength(1);
    expect((await other.request.get(`/api/todos/${original.id}`)).status()).toBe(404);
  } finally {
    await otherContext.close();
  }
});

test('imports 500 complete todo relationships within five seconds', async ({ page }) => {
  await register(page);
  const payload = envelope(Array.from({ length: 500 }, (_, index) => item(`Bulk ${index}`)));
  const start = performance.now();
  const response = await page.request.post('/api/todos/import', { data: payload });
  const elapsed = performance.now() - start;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ imported: 500 });
  expect(elapsed).toBeLessThan(5_000);
  const restored = await todos(page);
  expect(restored).toHaveLength(500);
  expect(restored.every(todo => todo.subtasks?.length === 2 && todo.tags?.length === 2)).toBe(true);
  expect(new Set(restored.flatMap(todo => todo.subtasks!.map(child => child.id))).size).toBe(1_000);
  expect(await (await page.request.get('/api/tags')).json()).toHaveLength(2);
});
