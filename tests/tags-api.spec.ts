import Database from 'better-sqlite3';
import { expect, test, type CDPSession, type Page } from '@playwright/test';

const virtualAuthenticatorOptions = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

function uniqueUsername(): string {
  return `tags-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

async function createTodo(page: Page, title: string): Promise<number> {
  const response = await page.request.post('/api/todos', { data: { title } });
  expect(response.status()).toBe(201);
  return (await response.json()).id as number;
}

test.beforeEach(async ({ page }) => {
  await addVirtualAuthenticator(page);
});

test('tag endpoints require an authenticated session', async ({ request }) => {
  const [list, create, update, remove, attach, detach] = await Promise.all([
    request.get('/api/tags'),
    request.post('/api/tags', { data: { name: 'Work' } }),
    request.put('/api/tags/1', { data: { name: 'Work' } }),
    request.delete('/api/tags/1'),
    request.post('/api/todos/1/tags', { data: { tag_id: 1 } }),
    request.delete('/api/todos/1/tags', { data: { tag_id: 1 } }),
  ]);
  expect([
    list.status(),
    create.status(),
    update.status(),
    remove.status(),
    attach.status(),
    detach.status(),
  ]).toEqual([401, 401, 401, 401, 401, 401]);
});

test('creates, updates, attaches, detaches, and cascades user tags', async ({ page }) => {
  await register(page);
  const todoId = await createTodo(page, 'Plan launch');

  const emptyName = await page.request.post('/api/tags', { data: { name: '   ' } });
  expect(emptyName.status()).toBe(400);
  const invalidColor = await page.request.post('/api/tags', {
    data: { name: 'Invalid', color: 'blue' },
  });
  expect(invalidColor.status()).toBe(400);
  const nullColor = await page.request.post('/api/tags', {
    data: { name: 'Invalid', color: null },
  });
  expect(nullColor.status()).toBe(400);

  const createWork = await page.request.post('/api/tags', {
    data: { name: '  Work  ' },
  });
  expect(createWork.status()).toBe(201);
  const work = await createWork.json();
  expect(work).toMatchObject({ name: 'Work', color: '#3B82F6' });
  const duplicate = await page.request.post('/api/tags', {
    data: { name: 'Work' },
  });
  expect(duplicate.status()).toBe(409);

  const createUrgent = await page.request.post('/api/tags', {
    data: { name: 'Urgent', color: '#FF0000' },
  });
  expect(createUrgent.status()).toBe(201);
  const urgent = await createUrgent.json();

  const [attachWork, attachAgain, attachUrgent] = await Promise.all([
    page.request.post(`/api/todos/${todoId}/tags`, { data: { tag_id: work.id } }),
    page.request.post(`/api/todos/${todoId}/tags`, { data: { tag_id: work.id } }),
    page.request.post(`/api/todos/${todoId}/tags`, { data: { tag_id: urgent.id } }),
  ]);
  expect([
    attachWork.status(),
    attachAgain.status(),
    attachUrgent.status(),
  ]).toEqual([200, 200, 200]);
  expect(await attachAgain.json()).toEqual({ success: true });

  const detail = await page.request.get(`/api/todos/${todoId}`);
  const todo = await detail.json();
  expect(todo.tags).toEqual([
    expect.objectContaining({ id: urgent.id, name: 'Urgent', color: '#FF0000' }),
    expect.objectContaining({ id: work.id, name: 'Work', color: '#3B82F6' }),
  ]);
  const tagList = await page.request.get('/api/tags');
  expect((await tagList.json()).map((tag: { name: string }) => tag.name))
    .toEqual(['Urgent', 'Work']);

  const update = await page.request.put(`/api/tags/${work.id}`, {
    data: { name: '  Team  ', color: '#00AA33' },
  });
  expect(update.status()).toBe(200);
  expect(await update.json()).toMatchObject({ id: work.id, name: 'Team', color: '#00AA33' });
  const duplicateUpdate = await page.request.put(`/api/tags/${work.id}`, {
    data: { name: 'Urgent' },
  });
  expect(duplicateUpdate.status()).toBe(409);
  const emptyUpdate = await page.request.put(`/api/tags/${work.id}`, { data: {} });
  expect(emptyUpdate.status()).toBe(400);

  const currentTodo = await page.request.get(`/api/todos/${todoId}`);
  expect((await currentTodo.json()).tags).toEqual([
    expect.objectContaining({ id: work.id, name: 'Team', color: '#00AA33' }),
    expect.objectContaining({ id: urgent.id, name: 'Urgent' }),
  ]);

  const [detach, detachAgain] = await Promise.all([
    page.request.delete(`/api/todos/${todoId}/tags`, { data: { tag_id: urgent.id } }),
    page.request.delete(`/api/todos/${todoId}/tags`, { data: { tag_id: urgent.id } }),
  ]);
  expect([detach.status(), detachAgain.status()]).toEqual([200, 200]);
  const afterDetach = await page.request.get(`/api/todos/${todoId}`);
  expect((await afterDetach.json()).tags.map((tag: { id: number }) => tag.id))
    .toEqual([work.id]);

  const secondTodoId = await createTodo(page, 'Prepare campaign');
  await page.request.post(`/api/todos/${secondTodoId}/tags`, {
    data: { tag_id: work.id },
  });
  const deleteTag = await page.request.delete(`/api/tags/${work.id}`);
  expect(deleteTag.status()).toBe(200);
  const todos = await page.request.get('/api/todos');
  expect((await todos.json()).map((item: { tags: unknown[] }) => item.tags)).toEqual([[], []]);

  const todoCascadeTagResponse = await page.request.post('/api/tags', {
    data: { name: 'Temporary' },
  });
  const todoCascadeTag = await todoCascadeTagResponse.json();
  const todoCascadeId = await createTodo(page, 'Delete with tag');
  await page.request.post(`/api/todos/${todoCascadeId}/tags`, {
    data: { tag_id: todoCascadeTag.id },
  });
  const deleteTodo = await page.request.delete(`/api/todos/${todoCascadeId}`);
  expect(deleteTodo.status()).toBe(200);

  const database = new Database('data/auth-e2e.db', { readonly: true });
  try {
    const remaining = database.prepare(
      'SELECT COUNT(*) AS count FROM todo_tags WHERE tag_id = ?',
    ).get(work.id) as { count: number };
    expect(remaining.count).toBe(0);
    const todoAssociations = database.prepare(
      'SELECT COUNT(*) AS count FROM todo_tags WHERE todo_id = ?',
    ).get(todoCascadeId) as { count: number };
    expect(todoAssociations.count).toBe(0);
  } finally {
    database.close();
  }
});

test('isolates tags by user and rejects foreign associations', async ({ page }) => {
  await register(page);
  const firstTodoId = await createTodo(page, 'First user todo');
  const firstTagResponse = await page.request.post('/api/tags', {
    data: { name: 'Shared name' },
  });
  const firstTag = await firstTagResponse.json();
  expect(firstTagResponse.status()).toBe(201);

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL('/login');
  await register(page);
  const secondTodoId = await createTodo(page, 'Second user todo');

  const tags = await page.request.get('/api/tags');
  expect(await tags.json()).toEqual([]);
  const secondTagResponse = await page.request.post('/api/tags', {
    data: { name: 'Shared name' },
  });
  expect(secondTagResponse.status()).toBe(201);
  const secondTag = await secondTagResponse.json();

  const [foreignUpdate, foreignDelete, foreignTagAttach, foreignTodoAttach] = await Promise.all([
    page.request.put(`/api/tags/${firstTag.id}`, { data: { name: 'Stolen' } }),
    page.request.delete(`/api/tags/${firstTag.id}`),
    page.request.post(`/api/todos/${secondTodoId}/tags`, {
      data: { tag_id: firstTag.id },
    }),
    page.request.post(`/api/todos/${firstTodoId}/tags`, {
      data: { tag_id: secondTag.id },
    }),
  ]);
  expect([
    foreignUpdate.status(),
    foreignDelete.status(),
    foreignTagAttach.status(),
    foreignTodoAttach.status(),
  ]).toEqual([404, 404, 404, 404]);

  const invalidTagId = await page.request.post(`/api/todos/${secondTodoId}/tags`, {
    data: { tag_id: '1' },
  });
  expect(invalidTagId.status()).toBe(400);
});
