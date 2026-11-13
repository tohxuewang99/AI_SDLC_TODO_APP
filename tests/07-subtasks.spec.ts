import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { addSubtask, createTodo } from './helpers';

const virtualAuthenticatorOptions = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

function uniqueUsername(): string {
  return `subtasks-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function addVirtualAuthenticator(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: virtualAuthenticatorOptions,
  });
  return cdp;
}

async function register(page: Page): Promise<void> {
  const username = uniqueUsername();
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: `Welcome, ${username}` })).toBeVisible();
}

async function createTodoAndWait(page: Page, title: string): Promise<void> {
  const responsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/todos') && response.request().method() === 'POST'
  ));
  await createTodo(page, { title });
  expect((await responsePromise).status()).toBe(201);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await addVirtualAuthenticator(page);
});

test('expands an empty checklist, rejects blank input, and keeps progress visible when collapsed', async ({ page }) => {
  await register(page);
  await createTodoAndWait(page, 'Prepare presentation');

  const todo = page.getByRole('listitem').filter({
    has: page.getByText('Prepare presentation', { exact: true }),
  });
  const expand = todo.getByRole('button', { name: 'Show subtasks for Prepare presentation' });
  await expect(expand).toBeVisible();
  await expect(todo.getByRole('progressbar')).toHaveCount(0);

  let createRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/subtasks') && request.method() === 'POST') {
      createRequests += 1;
    }
  });

  await expand.click();
  const input = todo.getByLabel('New subtask for Prepare presentation');
  await input.fill('   ');
  const addButton = todo.getByRole('button', { name: 'Add subtask' });
  await expect(addButton).toBeDisabled();
  await input.press('Enter');
  expect(createRequests).toBe(0);
  await expect(todo.getByRole('progressbar')).toHaveCount(0);

  await addSubtask(page, 'Prepare presentation', 'Create slides');
  await expect(todo.getByText('0/1 subtasks')).toBeVisible();
  await expect(todo.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await todo.getByRole('button', { name: 'Hide subtasks for Prepare presentation' }).click();
  await expect(todo.getByText('Create slides', { exact: true })).toHaveCount(0);
  await expect(todo.getByText('0/1 subtasks')).toBeVisible();
});

test('updates rounded progress for add, toggle, and delete without completing the parent', async ({ page }) => {
  await register(page);
  await createTodoAndWait(page, 'Prepare presentation');
  await addSubtask(page, 'Prepare presentation', 'Create slides');
  await addSubtask(page, 'Prepare presentation', 'Rehearse speech', 'button');
  await addSubtask(page, 'Prepare presentation', 'Review notes');

  const todo = page.getByRole('listitem').filter({
    has: page.getByText('Prepare presentation', { exact: true }),
  });
  await expect(todo.getByText('0/3 subtasks')).toBeVisible();
  const progress = todo.getByRole('progressbar');
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await expect(progress.locator('div')).toHaveClass(/bg-blue-600/);

  await todo.getByLabel('Mark "Create slides" as complete').check();
  await expect(todo.getByText('1/3 subtasks')).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuenow', '33');
  await expect(progress).toHaveAttribute('aria-valuetext', '1/3 subtasks (33%)');
  await expect(progress.locator('div')).toHaveClass(/bg-blue-600/);
  await todo.getByLabel('Mark "Rehearse speech" as complete').check();
  await expect(todo.getByText('2/3 subtasks')).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuenow', '67');
  await expect(progress).toHaveAttribute('aria-valuetext', '2/3 subtasks (67%)');
  await expect(todo.getByLabel('Mark "Prepare presentation" as complete')).not.toBeChecked();

  await todo.getByLabel('Mark "Review notes" as complete').check();
  await expect(todo.getByText('3/3 subtasks')).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuenow', '100');
  await expect(progress.locator('div')).toHaveClass(/bg-green-600/);

  await todo.getByLabel('Mark "Review notes" as incomplete').uncheck();
  await expect(todo.getByText('2/3 subtasks')).toBeVisible();
  await todo.getByRole('button', { name: 'Delete subtask "Review notes"' }).click();
  await expect(todo.getByText('2/2 subtasks')).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuenow', '100');
  await todo.getByRole('button', { name: 'Delete subtask "Create slides"' }).click();
  await todo.getByRole('button', { name: 'Delete subtask "Rehearse speech"' }).click();
  await expect(todo.getByRole('progressbar')).toHaveCount(0);
  await expect(todo.getByText('0/0 subtasks')).toHaveCount(0);
});

test('keeps the latest optimistic checkbox state when toggle responses resolve out of order', async ({ page }) => {
  await register(page);
  await createTodoAndWait(page, 'Prepare presentation');
  await addSubtask(page, 'Prepare presentation', 'Create slides');

  const todo = page.getByRole('listitem').filter({
    has: page.getByText('Prepare presentation', { exact: true }),
  });
  const subtaskId = (await (await page.request.get('/api/todos')).json())[0].subtasks[0].id as number;
  await page.route(`**/api/subtasks/${subtaskId}`, async (route) => {
    const responsePromise = route.fetch();
    const { completed } = route.request().postDataJSON() as { completed: boolean };
    if (completed) {
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
    }
    await route.fulfill({ response: await responsePromise });
  });

  const completedResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/subtasks/${subtaskId}`)
    && response.request().method() === 'PUT'
    && response.request().postDataJSON()?.completed === true
  ));
  const incompleteResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/subtasks/${subtaskId}`)
    && response.request().method() === 'PUT'
    && response.request().postDataJSON()?.completed === false
  ));
  await todo.getByLabel('Mark "Create slides" as complete').check();
  await todo.getByLabel('Mark "Create slides" as incomplete').uncheck();
  await Promise.all([completedResponse, incompleteResponse]);

  await expect(todo.getByLabel('Mark "Create slides" as complete')).not.toBeChecked();
  await expect(todo.getByText('0/1 subtasks')).toBeVisible();
  const todoResponse = await page.request.get('/api/todos');
  expect((await todoResponse.json())[0].subtasks[0].completed).toBe(false);
});

test('retains recoverable UI state and reports failed subtask mutations', async ({ page }) => {
  await register(page);
  await createTodoAndWait(page, 'Prepare presentation');
  await page.route('**/api/todos/*/subtasks', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Subtask create failed' }),
  }));
  await page.getByRole('button', { name: 'Show subtasks for Prepare presentation' }).click();
  const todo = page.getByRole('listitem').filter({
    has: page.getByText('Prepare presentation', { exact: true }),
  });
  const input = todo.getByLabel('New subtask for Prepare presentation');
  await input.fill('Create slides');
  await todo.getByRole('button', { name: 'Add subtask' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('Subtask create failed');
  await expect(input).toHaveValue('Create slides');
  await expect(todo.getByRole('progressbar')).toHaveCount(0);
  await page.unroute('**/api/todos/*/subtasks');

  await addSubtask(page, 'Prepare presentation', 'Create slides');
  const subtaskResponse = await page.request.get('/api/todos');
  const [{ subtasks }] = await subtaskResponse.json();
  const [{ id: subtaskId }] = subtasks;
  await page.route(`**/api/subtasks/${subtaskId}`, (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Subtask update failed' }),
  }));
  await todo.getByLabel('Mark "Create slides" as complete').check();
  await expect(page.locator('p[role="alert"]')).toHaveText('Subtask update failed');
  await expect(todo.getByLabel('Mark "Create slides" as complete')).not.toBeChecked();
  await expect(todo.getByText('0/1 subtasks')).toBeVisible();
  await page.unroute(`**/api/subtasks/${subtaskId}`);

  await page.route(`**/api/subtasks/${subtaskId}`, (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Subtask delete failed' }),
  }));
  await todo.getByRole('button', { name: 'Delete subtask "Create slides"' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('Subtask delete failed');
  await expect(todo.getByText('Create slides', { exact: true })).toBeVisible();
  await expect(todo.getByText('0/1 subtasks')).toBeVisible();
});

test('removes the expanded checklist when its parent todo is deleted', async ({ page }) => {
  await register(page);
  await createTodoAndWait(page, 'Prepare presentation');
  await addSubtask(page, 'Prepare presentation', 'Create slides');
  await addSubtask(page, 'Prepare presentation', 'Rehearse speech');

  const todo = page.getByRole('listitem').filter({
    has: page.getByText('Prepare presentation', { exact: true }),
  });
  const deleteResponse = page.waitForResponse((response) => (
    /\/api\/todos\/\d+$/.test(response.url())
    && response.request().method() === 'DELETE'
  ));
  await todo.getByRole('button', { name: 'Delete', exact: true }).click();
  expect((await deleteResponse).status()).toBe(200);
  await expect(page.getByText('Prepare presentation', { exact: true })).toHaveCount(0);
  const listResponse = await page.request.get('/api/todos');
  expect(await listResponse.json()).toEqual([]);
});
