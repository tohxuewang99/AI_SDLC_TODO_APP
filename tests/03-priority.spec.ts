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
  return `priority-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
  await page.goto('/login');
  await page.getByLabel('Username').fill(uniqueUsername());
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page).toHaveURL('/');
}

async function pendingTitles(page: Page): Promise<string[]> {
  return page.getByRole('region', { name: 'Pending todos' })
    .getByRole('listitem')
    .evaluateAll((items) => items.map(
      (item) => item.querySelector('p')?.textContent?.trim() ?? '',
    ));
}

function contrastRatio(foreground: string, background: string): number {
  function luminance(color: string): number {
    const channels = color.match(/\d+/g)?.slice(0, 3).map(Number);
    if (!channels || channels.length !== 3) {
      throw new Error(`Unexpected computed color: ${color}`);
    }
    const [red, green, blue] = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }

  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test.beforeEach(async ({ page }) => {
  await addVirtualAuthenticator(page);
});

test('shows priority badges in the specified palette with AA text contrast in light and dark modes', async ({ page }) => {
  await register(page);
  await createTodo(page, { title: 'High task', priority: 'high' });
  await createTodo(page, { title: 'Medium task', priority: 'medium' });
  await createTodo(page, { title: 'Low task', priority: 'low' });
  const todos = await (await page.request.get('/api/todos')).json();
  const high = todos.find((todo: { title: string }) => todo.title === 'High task');
  await page.request.put(`/api/todos/${high.id}`, {
    data: { due_date: '2020-01-01T10:00' },
  });
  await page.getByLabel('Mark "Medium task" as complete').click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Overdue (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Completed (1)' })).toBeVisible();

  const badges = [
    { label: 'High priority', light: 'rgb(239, 68, 68)', dark: 'rgb(248, 113, 113)' },
    { label: 'Medium priority', light: 'rgb(245, 158, 11)', dark: 'rgb(251, 191, 36)' },
    { label: 'Low priority', light: 'rgb(59, 130, 246)', dark: 'rgb(96, 165, 250)' },
  ];

  for (const badge of badges) {
    const locator = page.getByLabel(badge.label);
    await expect(locator).toBeVisible();
    await expect(locator).toContainText(badge.label.split(' ')[0]);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(locator).toHaveCSS('border-top-color', badge.light);
    const lightContrast = await locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor };
    });
    expect(contrastRatio(lightContrast.color, lightContrast.background)).toBeGreaterThanOrEqual(4.5);

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(locator).toHaveCSS('border-top-color', badge.dark);
    const darkContrast = await locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor };
    });
    expect(contrastRatio(darkContrast.color, darkContrast.background)).toBeGreaterThanOrEqual(4.5);
  }
});

test('sorts priorities and immediately reorders an edited todo', async ({ page }) => {
  await register(page);
  const dueDate = toSingaporeDateTimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000));
  await createTodo(page, { title: 'Low task', priority: 'low', dueDate });
  await createTodo(page, { title: 'Medium task', priority: 'medium', dueDate });
  await createTodo(page, { title: 'High task', priority: 'high', dueDate });

  await expect.poll(() => pendingTitles(page)).toEqual(['High task', 'Medium task', 'Low task']);
  await page.getByRole('button', { name: 'Edit' }).nth(2).click();
  await page.getByLabel('Edit priority').selectOption('high');
  await page.getByRole('button', { name: 'Update' }).click();
  await expect.poll(async () => {
    const titles = await pendingTitles(page);
    return titles.slice(0, 2).sort().join(',') === 'High task,Low task'
      && titles[2] === 'Medium task';
  }).toBe(true);
});

test('filters by priority and restores all todos when cleared', async ({ page }) => {
  await register(page);
  await createTodo(page, { title: 'High task', priority: 'high' });
  await createTodo(page, { title: 'Medium task', priority: 'medium' });
  await createTodo(page, { title: 'Low task', priority: 'low' });

  const filter = page.getByLabel('Priority filter');
  await filter.selectOption('high');
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
  await expect(page.getByText('High task')).toBeVisible();
  await expect(page.getByText('Medium task')).toHaveCount(0);
  await expect(page.getByText('Low task')).toHaveCount(0);

  const filteredResponse = await page.request.get('/api/todos?priority=high');
  expect((await filteredResponse.json()).map((todo: { title: string }) => todo.title))
    .toEqual(['High task']);

  await filter.selectOption('all');
  await expect(page.getByRole('heading', { name: 'Pending (3)' })).toBeVisible();
  await expect(page.getByText('High task')).toBeVisible();
  await expect(page.getByText('Medium task')).toBeVisible();
  await expect(page.getByText('Low task')).toBeVisible();
});

test('rejects invalid priorities without changing stored todos', async ({ page }) => {
  await register(page);
  await createTodo(page, { title: 'Keep low', priority: 'low' });
  const response = await page.request.get('/api/todos');
  const [existing] = await response.json();

  const invalidCreate = await page.request.post('/api/todos', {
    data: { title: 'Invalid create', priority: 'urgent' },
  });
  expect(invalidCreate.status()).toBe(400);
  expect(await invalidCreate.json()).toEqual({
    error: "Invalid priority: urgent. Must be 'high', 'medium', or 'low'.",
  });

  const nullCreate = await page.request.post('/api/todos', {
    data: { title: 'Default medium', priority: null },
  });
  expect(nullCreate.status()).toBe(201);
  expect(await nullCreate.json()).toMatchObject({ title: 'Default medium', priority: 'medium' });

  const invalidUpdate = await page.request.put(`/api/todos/${existing.id}`, {
    data: { priority: 'urgent' },
  });
  expect(invalidUpdate.status()).toBe(400);
  expect(await invalidUpdate.json()).toEqual({
    error: "Invalid priority: urgent. Must be 'high', 'medium', or 'low'.",
  });

  const invalidNullUpdate = await page.request.put(`/api/todos/${existing.id}`, {
    data: { priority: null },
  });
  expect(invalidNullUpdate.status()).toBe(400);
  expect(await invalidNullUpdate.json()).toEqual({
    error: "Invalid priority: null. Must be 'high', 'medium', or 'low'.",
  });

  const todos = await (await page.request.get('/api/todos')).json();
  expect(todos).toHaveLength(2);
  expect(todos.find((todo: { id: number }) => todo.id === existing.id))
    .toMatchObject({ id: existing.id, priority: 'low' });
  expect((await page.request.get('/api/todos?priority=urgent')).status()).toBe(400);
});
