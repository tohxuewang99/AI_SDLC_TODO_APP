import { expect, test, type Page } from '@playwright/test';

const virtualAuthenticatorOptions = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

async function register(page: Page, setupAuthenticator = true): Promise<void> {
  if (setupAuthenticator) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: virtualAuthenticatorOptions,
    });
  }
  const username = `templates-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page).toHaveURL('/');
}

test('template endpoints require authentication', async ({ request }) => {
  const responses = await Promise.all([
    request.get('/api/templates'),
    request.post('/api/templates', { data: {} }),
    request.put('/api/templates/1', { data: {} }),
    request.delete('/api/templates/1'),
    request.post('/api/templates/1/use'),
  ]);
  expect(responses.map((response) => response.status())).toEqual([401, 401, 401, 401, 401]);
});

test('rejects missing required fields and a recurring template without an offset', async ({ page }) => {
  await register(page);
  const responses = await Promise.all([
    page.request.post('/api/templates', {
      data: { name: ' ', title_template: 'A task', priority: 'medium' },
    }),
    page.request.post('/api/templates', {
      data: { name: 'Template', title_template: ' ', priority: 'medium' },
    }),
    page.request.post('/api/templates', {
      data: {
        name: 'Recurring',
        title_template: 'A task',
        priority: 'medium',
        is_recurring: true,
        recurrence_pattern: 'daily',
      },
    }),
  ]);
  expect(responses.map((response) => response.status())).toEqual([400, 400, 400]);
});

test('using a snapshot preserves fields and independent unchecked subtasks after deletion', async ({ page }) => {
  await register(page);
  const create = await page.request.post('/api/templates', {
    data: {
      name: 'Weekly review',
      description: 'A repeatable checklist',
      category: 'Custom / retired category',
      title_template: 'Review project',
      priority: 'high',
      is_recurring: true,
      recurrence_pattern: 'weekly',
      reminder_minutes: 15,
      due_date_offset_minutes: 120,
      subtasks: [
        { title: 'Review notes', position: 0 },
        { title: 'Plan next week', position: 1 },
      ],
    },
  });
  expect(create.status()).toBe(201);
  const template = await create.json();
  expect(template.category).toBe('Custom / retired category');

  const before = Date.now();
  const use = await page.request.post(`/api/templates/${template.id}/use`);
  const after = Date.now();
  expect(use.status()).toBe(201);
  const todo = await use.json();
  expect(todo).toMatchObject({
    title: 'Review project',
    priority: 'high',
    is_recurring: true,
    recurrence_pattern: 'weekly',
    reminder_minutes: 15,
  });
  const due = Date.parse(todo.due_date);
  expect(due).toBeGreaterThanOrEqual(before + 120 * 60_000);
  expect(due).toBeLessThanOrEqual(after + 120 * 60_000);
  expect(todo.subtasks.map(({ title, position, completed }: {
    title: string; position: number; completed: boolean;
  }) => ({ title, position, completed }))).toEqual([
    { title: 'Review notes', position: 0, completed: false },
    { title: 'Plan next week', position: 1, completed: false },
  ]);
  expect((await page.request.delete(`/api/templates/${template.id}`)).ok()).toBeTruthy();
  expect((await page.request.post(`/api/templates/${template.id}/use`)).status()).toBe(404);
  const detail = await page.request.get(`/api/todos/${todo.id}`);
  expect(detail.status()).toBe(200);
  expect(await detail.json()).toMatchObject({
    id: todo.id,
    title: 'Review project',
    tags: [],
    subtasks: [
      { title: 'Review notes', position: 0, completed: false },
      { title: 'Plan next week', position: 1, completed: false },
    ],
  });
});

test('permits duplicate names and arbitrary categories, with null offset and no subtasks', async ({ page }) => {
  await register(page);
  const draft = {
    name: 'Duplicate',
    category: 'A free-text category',
    title_template: 'No deadline',
    priority: 'medium',
  };
  const first = await page.request.post('/api/templates', { data: draft });
  const second = await page.request.post('/api/templates', { data: draft });
  expect([first.status(), second.status()]).toEqual([201, 201]);
  const firstTemplate = await first.json();
  const secondTemplate = await second.json();
  expect(firstTemplate.id).not.toBe(secondTemplate.id);
  const list = await page.request.get('/api/templates');
  expect((await list.json()).filter((item: { name: string }) => item.name === draft.name))
    .toHaveLength(2);
  const use = await page.request.post(`/api/templates/${firstTemplate.id}/use`);
  expect(use.status()).toBe(201);
  expect(await use.json()).toMatchObject({ title: draft.title_template, due_date: null, subtasks: [] });
});

test('lists more than 50 templates and recreates a checklist with more than 20 subtasks', async ({ page }) => {
  test.setTimeout(60_000);
  await register(page);
  const subtasks = Array.from({ length: 21 }, (_, position) => ({
    title: `Checklist item ${position + 1}`,
    position,
  }));
  const ids: number[] = [];
  for (let index = 0; index < 51; index += 1) {
    const response = await page.request.post('/api/templates', {
      data: {
        name: `Library template ${index}`,
        title_template: `Library task ${index}`,
        priority: 'medium',
        subtasks,
      },
    });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).id);
  }
  const response = await page.request.get('/api/templates');
  expect(response.status()).toBe(200);
  const listed = await response.json() as { id: number }[];
  expect(listed.map((item) => item.id).sort((a, b) => a - b))
    .toEqual(ids.sort((a, b) => a - b));
  const use = await page.request.post(`/api/templates/${ids[0]}/use`);
  expect(use.status()).toBe(201);
  const todo = await use.json();
  expect(todo.subtasks.map(({ title, position, completed }: {
    title: string; position: number; completed: boolean;
  }) => ({ title, position, completed }))).toEqual(
    subtasks.map((subtask) => ({ ...subtask, completed: false })),
  );
});

test('templates are inaccessible to other users', async ({ page }) => {
  await register(page);
  const create = await page.request.post('/api/templates', {
    data: { name: 'Private', title_template: 'Private task', priority: 'low' },
  });
  expect(create.status()).toBe(201);
  const template = await create.json();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL('/login');
  await register(page, false);

  const list = await page.request.get('/api/templates');
  expect((await list.json()).some((item: { id: number }) => item.id === template.id)).toBe(false);
  const responses = await Promise.all([
    page.request.post(`/api/templates/${template.id}/use`),
    page.request.put(`/api/templates/${template.id}`, { data: { name: 'Changed' } }),
    page.request.delete(`/api/templates/${template.id}`),
  ]);
  expect(responses.map((response) => response.status())).toEqual([404, 404, 404]);
});

test('saves a template and uses it from both picker and manager before deleting it', async ({ page }) => {
  await register(page);
  await page.getByLabel('Title').fill('Review project');
  await page.getByLabel('Priority', { exact: true }).selectOption('high');
  const singaporeDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Singapore',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(Date.now() + 3 * 60 * 60_000)).replace(' ', 'T');
  await page.getByLabel('Due date', { exact: true }).fill(singaporeDate);
  await page.getByLabel('Repeat', { exact: true }).check();
  await page.getByLabel('Recurrence pattern').selectOption('weekly');
  await page.getByLabel('Reminder', { exact: true }).selectOption('15');
  await page.getByRole('button', { name: 'Save as Template' }).click();
  const save = page.getByRole('dialog', { name: 'Save as Template' });
  await save.getByLabel('Template name').fill('Project checklist');
  await save.getByLabel('Template description').fill('Weekly preparation');
  await save.getByLabel('Template category').fill('Custom');
  await save.getByLabel('Due date offset in minutes').fill('120');
  await save.getByLabel('Template subtasks').fill('Review notes\nPlan next week');
  const savedResponse = page.waitForResponse((response) => (
    response.url().endsWith('/api/templates') && response.request().method() === 'POST'
  ));
  await save.getByRole('button', { name: 'Save Template', exact: true }).click();
  expect((await savedResponse).status()).toBe(201);
  await expect(save).toHaveCount(0);
  const picker = page.getByLabel('Use Template', { exact: true });
  await expect(picker.locator('option', { hasText: 'Project checklist (Custom)' })).toHaveCount(1);

  const quickResponse = page.waitForResponse((response) => (
    /\/api\/templates\/\d+\/use$/.test(response.url()) && response.request().method() === 'POST'
  ));
  await picker.selectOption({ label: 'Project checklist (Custom)' });
  const quick = await quickResponse;
  expect(quick.status()).toBe(201);
  const first = await quick.json();
  expect(first).toMatchObject({
    title: 'Review project', priority: 'high', is_recurring: true,
    recurrence_pattern: 'weekly', reminder_minutes: 15,
    subtasks: [
      { title: 'Review notes', position: 0, completed: false },
      { title: 'Plan next week', position: 1, completed: false },
    ],
  });
  await expect(page.getByText('Review project', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Templates', exact: false }).click();
  const manager = page.getByRole('dialog', { name: 'Template Manager' });
  const card = manager.getByRole('listitem').filter({ hasText: 'Project checklist' });
  await expect(card).toContainText('Custom');
  await expect(card).toContainText('high priority');
  await expect(card).toContainText('weekly');
  await expect(card).toContainText('15m');
  const managerResponse = page.waitForResponse((response) => (
    /\/api\/templates\/\d+\/use$/.test(response.url()) && response.request().method() === 'POST'
  ));
  await card.getByRole('button', { name: 'Use', exact: true }).click();
  expect((await managerResponse).status()).toBe(201);
  await expect(manager).toHaveCount(0);
  await expect(page.getByText('Review project', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Templates', exact: false }).click();
  page.once('dialog', (dialog) => dialog.accept());
  const deleteResponse = page.waitForResponse((response) => (
    /\/api\/templates\/\d+$/.test(response.url()) && response.request().method() === 'DELETE'
  ));
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  expect((await deleteResponse).status()).toBe(200);
  await expect(card).toHaveCount(0);
  await manager.getByRole('button', { name: 'Close' }).click();
  await expect(picker.locator('option', { hasText: 'Project checklist' })).toHaveCount(0);
  await expect(page.getByText('Review project', { exact: true })).toHaveCount(2);
  expect((await page.request.get(`/api/todos/${first.id}`)).status()).toBe(200);
});

test('manager remains usable with 51 templates containing 21 subtasks on a narrow screen', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 375, height: 667 });
  await register(page);
  const subtasks = Array.from({ length: 21 }, (_, position) => ({
    title: `Checklist item ${position + 1}`, position,
  }));
  for (let index = 0; index < 51; index += 1) {
    const response = await page.request.post('/api/templates', {
      data: { name: `Library ${index}`, title_template: `Task ${index}`, priority: 'medium', subtasks },
    });
    expect(response.status()).toBe(201);
  }
  await page.reload();
  await page.getByRole('button', { name: 'Templates', exact: false }).click();
  const manager = page.getByRole('dialog', { name: 'Template Manager' });
  await expect(manager.getByRole('listitem')).toHaveCount(51);
  const dimensions = await manager.evaluate((dialog) => {
    const panel = dialog.firstElementChild as HTMLElement;
    return {
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight,
      scrollWidth: panel.scrollWidth,
      clientWidth: panel.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  await manager.getByRole('button', { name: 'Close' }).scrollIntoViewIfNeeded();
  await manager.getByRole('button', { name: 'Close' }).click();
  await expect(manager).toHaveCount(0);
});
