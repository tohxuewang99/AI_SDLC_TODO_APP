import { expect, test, type Page } from '@playwright/test';

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
  await page.getByLabel('Username').fill(`transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page).toHaveURL('/');
}

test('downloads and restores a backup with subtasks and tags, including repeat imports', async ({ page }) => {
  await register(page);
  const tagResponse = await page.request.post('/api/tags', { data: { name: 'Work', color: '#123456' } });
  const tag = await tagResponse.json();
  const todoResponse = await page.request.post('/api/todos', {
    data: { title: 'Milk, "bread"', priority: 'high', tag_ids: [tag.id] },
  });
  const todo = await todoResponse.json();
  const child = await page.request.post(`/api/todos/${todo.id}/subtasks`, { data: { title: 'First step' } });
  expect(child.status()).toBe(201);
  await page.reload();

  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const jsonDownload = await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toMatch(/^todos-\d{4}-\d{2}-\d{2}\.json$/);
  const stream = await jsonDownload.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const backup = Buffer.concat(chunks);
  expect(JSON.parse(backup.toString()).todos[0].subtasks[0].title).toBe('First step');

  const csvDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toMatch(/^todos-\d{4}-\d{2}-\d{2}\.csv$/);
  const csvStream = await csvDownload.createReadStream();
  const csvChunks: Buffer[] = [];
  for await (const chunk of csvStream) csvChunks.push(Buffer.from(chunk));
  expect(Buffer.concat(csvChunks).toString()).toContain('"Milk, ""bread"""');

  expect((await page.request.delete(`/api/todos/${todo.id}`)).status()).toBe(200);
  await page.reload();
  const picker = page.getByLabel('Import JSON file');
  await picker.setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
  await expect(page.getByRole('status').filter({ hasText: 'Successfully imported 1 todos' })).toBeVisible();
  await expect(page.getByText('Milk, "bread"', { exact: true })).toBeVisible();
  const restored = await (await page.request.get('/api/todos')).json();
  expect(restored).toHaveLength(1);
  expect(restored[0].id).not.toBe(todo.id);
  expect(restored[0].subtasks[0]).toMatchObject({ title: 'First step', todo_id: restored[0].id });
  expect(restored[0].tags[0]).toMatchObject({ id: tag.id, name: 'Work', color: '#123456' });
  await picker.setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
  await expect.poll(async () => (await (await page.request.get('/api/todos')).json()).length).toBe(2);
});

test('shows clear errors for malformed and structurally invalid files', async ({ page }) => {
  await register(page);
  const picker = page.getByLabel('Import JSON file');
  await picker.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(page.getByRole('region', { name: 'Export and import' }).getByRole('alert')).toHaveText('Invalid JSON format');
  await picker.setInputFiles({ name: 'wrong.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1}') });
  await expect(page.getByRole('region', { name: 'Export and import' }).getByRole('alert')).toHaveText('Failed to import todos. Please check the file format.');
  expect(await (await page.request.get('/api/todos')).json()).toEqual([]);
  const malformed = await page.request.post('/api/todos/import', {
    data: Buffer.from('{broken'),
    headers: { 'Content-Type': 'application/json' },
  });
  expect(malformed.status()).toBe(400);
  expect(await malformed.json()).toEqual({ error: 'Invalid JSON format' });
});

test('imported Singapore due dates appear on the corresponding calendar day', async ({ page }) => {
  await register(page);
  const response = await page.request.post('/api/todos/import', { data: {
    version: 1,
    exported_at: '2026-03-02T10:00:00+08:00',
    todos: [{
      title: 'Imported calendar task', completed: false,
      due_date: '2026-03-01T00:30:00+08:00', priority: 'high',
      is_recurring: false, recurrence_pattern: null, reminder_minutes: null,
      created_at: '2026-01-15T12:00:00+08:00', subtasks: [], tags: [],
    }],
  } });
  expect(response.status()).toBe(200);
  await page.goto('/calendar?month=2026-03');
  await expect(page.getByRole('button', { name: '2026-03-01, 1 todos' })).toContainText('Imported calendar task');
});
