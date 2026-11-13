import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { createTodo } from './helpers';
import { toSingaporeDateTimeLocal } from '../lib/timezone';

const virtualAuthenticatorOptions = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

function uniqueUsername(): string {
  return `todo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function addVirtualAuthenticator(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: virtualAuthenticatorOptions,
  });
  return cdp;
}

async function register(page: Page, username = uniqueUsername()): Promise<string> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: `Welcome, ${username}` })).toBeVisible();
  return username;
}

test.beforeEach(async ({ page }) => {
  await addVirtualAuthenticator(page);
});

test('todo API requires an authenticated session', async ({ request }) => {
  const response = await request.get('/api/todos');
  expect(response.status()).toBe(401);
});

test('creates a title-only todo with defaults in Pending', async ({ page }) => {
  await register(page);
  await createTodo(page, { title: 'Buy groceries' });

  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
  await expect(page.getByText('Buy groceries')).toBeVisible();
  await expect(page.getByLabel('Medium priority')).toBeVisible();
  const response = await page.request.get('/api/todos');
  const todos = await response.json();
  expect(todos).toHaveLength(1);
  expect(todos[0]).toMatchObject({
    title: 'Buy groceries',
    completed: false,
    due_date: null,
    priority: 'medium',
  });
});

test('creates a high-priority todo with a future Singapore due date', async ({ page }) => {
  await register(page);
  const dueDate = toSingaporeDateTimeLocal(new Date(Date.now() + 2 * 60 * 60 * 1000));
  await createTodo(page, { title: 'Prepare presentation', priority: 'high', dueDate });

  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
  await expect(page.getByLabel('High priority')).toBeVisible();
  await expect(page.getByText(/^Due \d/)).toBeVisible();
});

test('rejects empty titles and past due dates before calling the create API', async ({ page }) => {
  await register(page);
  let createRequests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/todos') && request.method() === 'POST') {
      createRequests += 1;
    }
  });

  await createTodo(page, { title: '   ' });
  await expect(page.locator('p[role="alert"]')).toHaveText('Title is required.');
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toHaveCount(0);

  const pastDate = toSingaporeDateTimeLocal(new Date(Date.now() - 60 * 60 * 1000));
  await createTodo(page, { title: 'Already late', dueDate: pastDate });
  await expect(page.locator('p[role="alert"]')).toHaveText(
    'Due date must be at least 1 minute in the future.',
  );
  expect(createRequests).toBe(0);
});

test('edits fields and re-sections an item, while cancel discards changes', async ({ page }) => {
  await register(page);
  await createTodo(page, { title: 'Plan trip' });
  let updateRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/todos/') && request.method() === 'PUT') {
      updateRequests += 1;
    }
  });

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Edit title').fill('Plan weekend trip');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Plan trip')).toBeVisible();
  await expect(page.getByText('Plan weekend trip')).toHaveCount(0);
  expect(updateRequests).toBe(0);

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Edit title').fill('Discard with Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Plan trip')).toBeVisible();
  expect(updateRequests).toBe(0);

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Edit title').fill('Discard outside');
  await page.getByRole('dialog').click({ position: { x: 1, y: 1 } });
  await expect(page.getByText('Plan trip')).toBeVisible();
  expect(updateRequests).toBe(0);

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Edit title').fill('Plan weekend trip');
  await page.getByLabel('Edit due date').fill(
    toSingaporeDateTimeLocal(new Date(Date.now() - 60 * 60 * 1000)),
  );
  await page.getByRole('button', { name: 'Update' }).click();

  await expect(page.getByRole('heading', { name: 'Overdue (1)' })).toBeVisible();
  await expect(page.getByText('Plan weekend trip')).toBeVisible();
});

test('toggles completion and deletes a todo without confirmation', async ({ page }) => {
  await register(page);
  const createResponse = page.waitForResponse((response) => (
    response.url().endsWith('/api/todos')
    && response.request().method() === 'POST'
  ));
  await createTodo(page, { title: 'Read a book' });
  await createResponse;
  await page.getByLabel('Mark "Read a book" as complete').click();

  await expect(page.getByRole('heading', { name: 'Completed (1)' })).toBeVisible();
  await page.getByLabel('Mark "Read a book" as incomplete').click();
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Read a book')).toHaveCount(0);

  const response = await page.request.get('/api/todos');
  expect(await response.json()).toHaveLength(0);
});

test('does not expose another account’s todo', async ({ page }) => {
  const firstUser = await register(page);
  await createTodo(page, { title: 'Private task' });
  const firstResponse = await page.request.get('/api/todos');
  const [{ id }] = await firstResponse.json();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL('/login');
  await register(page, uniqueUsername() + firstUser.slice(-1));
  const [getResponse, putResponse, deleteResponse] = await Promise.all([
    page.request.get(`/api/todos/${id}`),
    page.request.put(`/api/todos/${id}`, { data: { title: 'Not yours' } }),
    page.request.delete(`/api/todos/${id}`),
  ]);
  expect(getResponse.status()).toBe(404);
  expect(putResponse.status()).toBe(404);
  expect(deleteResponse.status()).toBe(404);
});

test('rolls back an optimistic delete when the API fails', async ({ page }) => {
  await register(page);
  await createTodo(page, { title: 'Keep this task' });
  await page.route('**/api/todos/*', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Server error' }),
  }));
  await page.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByText('Keep this task')).toBeVisible();
  await expect(page.locator('p[role="alert"]')).toHaveText('Server error');
});

test('rolls back optimistic create and completion changes when the API fails', async ({ page }) => {
  await register(page);
  await page.route('**/api/todos', (route) => route.request().method() === 'POST'
    ? route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Create failed' }),
    })
    : route.continue());
  await createTodo(page, { title: 'Retry this task' });

  await expect(page.getByText('Retry this task')).toHaveCount(0);
  await expect(page.getByLabel('Title')).toHaveValue('Retry this task');
  await expect(page.locator('p[role="alert"]')).toHaveText('Create failed');
  await page.unroute('**/api/todos');

  await createTodo(page, { title: 'Complete later' });
  await page.route('**/api/todos/*', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Update failed' }),
  }));
  await page.getByLabel('Mark "Complete later" as complete').click();

  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
  await expect(page.getByLabel('Mark "Complete later" as complete')).toBeVisible();
  await expect(page.locator('p[role="alert"]')).toHaveText('Update failed');
});

test('server rejects malformed and too-soon due dates', async ({ page }) => {
  await register(page);
  const responses = await page.evaluate(async () => {
    const request = (due_date: string) => fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Server validation', due_date }),
    });
    const malformed = await request('not-a-date');
    const past = await request('2020-01-01T10:00');
    return [malformed.status, past.status];
  });
  expect(responses).toEqual([400, 400]);
});
