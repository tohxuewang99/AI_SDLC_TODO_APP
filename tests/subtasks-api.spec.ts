import Database from 'better-sqlite3';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { createTodo } from './helpers';

const virtualAuthenticatorOptions = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

function uniqueUsername(): string {
  return `subtask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function addVirtualAuthenticator(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: virtualAuthenticatorOptions,
  });
  return cdp;
}

async function register(page: Page, username = uniqueUsername()): Promise<void> {
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
}

test.beforeEach(async ({ page }) => {
  await addVirtualAuthenticator(page);
});

test('subtask endpoints require an authenticated session', async ({ request }) => {
  const [create, update, remove] = await Promise.all([
    request.post('/api/todos/1/subtasks', { data: { title: 'Private' } }),
    request.put('/api/subtasks/1', { data: { completed: true } }),
    request.delete('/api/subtasks/1'),
  ]);
  expect([create.status(), update.status(), remove.status()]).toEqual([401, 401, 401]);
});

test('creates, orders, updates, deletes, and cascades subtasks', async ({ page }) => {
  await register(page);
  await createTodoAndWait(page, 'Prepare presentation');
  const todosResponse = await page.request.get('/api/todos');
  const [{ id: todoId, completed: parentCompleted }] = await todosResponse.json();
  expect(parentCompleted).toBe(false);

  const emptyTitle = await page.request.post(`/api/todos/${todoId}/subtasks`, {
    data: { title: '   ' },
  });
  expect(emptyTitle.status()).toBe(400);

  const createFirst = await page.request.post(`/api/todos/${todoId}/subtasks`, {
    data: { title: '  Create slides  ' },
  });
  const first = await createFirst.json();
  expect(createFirst.status()).toBe(201);
  expect(first).toMatchObject({
    todo_id: todoId,
    title: 'Create slides',
    completed: false,
    position: 0,
  });

  const createSecond = await page.request.post(`/api/todos/${todoId}/subtasks`, {
    data: { title: 'Rehearse speech' },
  });
  const second = await createSecond.json();
  expect(second.position).toBe(1);

  const update = await page.request.put(`/api/subtasks/${first.id}`, {
    data: { completed: true },
  });
  expect(update.status()).toBe(200);
  expect(await update.json()).toMatchObject({ id: first.id, completed: true });

  const detail = await page.request.get(`/api/todos/${todoId}`);
  const todo = await detail.json();
  expect(todo.subtasks.map((subtask: { id: number }) => subtask.id)).toEqual([
    first.id,
    second.id,
  ]);
  expect(todo.completed).toBe(false);
  expect(todo.subtasks[0].completed).toBe(true);

  const remove = await page.request.delete(`/api/subtasks/${first.id}`);
  expect(remove.status()).toBe(200);
  expect(await remove.json()).toEqual({ success: true });
  const createThird = await page.request.post(`/api/todos/${todoId}/subtasks`, {
    data: { title: 'Review slides' },
  });
  const third = await createThird.json();
  expect(third.position).toBe(2);
  const list = await page.request.get('/api/todos');
  const [todoWithSubtasks] = await list.json();
  expect(todoWithSubtasks.subtasks.map((subtask: { position: number }) => subtask.position))
    .toEqual([1, 2]);

  await page.request.delete(`/api/todos/${todoId}`);
  const database = new Database('data/auth-e2e.db', { readonly: true });
  try {
    const orphanCount = database.prepare(
      'SELECT COUNT(*) AS count FROM subtasks WHERE todo_id = ?',
    ).get(todoId) as { count: number };
    expect(orphanCount.count).toBe(0);
  } finally {
    database.close();
  }
});

test('prevents another user from creating, updating, or deleting a subtask', async ({ page }) => {
  const firstUsername = uniqueUsername();
  await register(page, firstUsername);
  await createTodoAndWait(page, 'Private parent todo');
  const todosResponse = await page.request.get('/api/todos');
  const [{ id: todoId }] = await todosResponse.json();
  const create = await page.request.post(`/api/todos/${todoId}/subtasks`, {
    data: { title: 'Private child task' },
  });
  const { id: subtaskId } = await create.json();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL('/login');
  await register(page, uniqueUsername());

  const [createOtherTodo, update, remove] = await Promise.all([
    page.request.post(`/api/todos/${todoId}/subtasks`, { data: { title: 'No access' } }),
    page.request.put(`/api/subtasks/${subtaskId}`, { data: { completed: true } }),
    page.request.delete(`/api/subtasks/${subtaskId}`),
  ]);
  expect([createOtherTodo.status(), update.status(), remove.status()]).toEqual([404, 404, 404]);
});
