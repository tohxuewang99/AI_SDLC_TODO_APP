import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { addSubtask, createTag, createTodo } from './helpers';

const virtualAuthenticatorOptions = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

function uniqueUsername(): string {
  return `filter-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function dateTimeAfter(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Singapore', hourCycle: 'h23' })
    .replace(' ', 'T')
    .slice(0, 16);
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

async function createTaggedTodo(
  page: Page,
  title: string,
  tagName: string,
  priority: 'high' | 'medium' | 'low',
  dueDate?: string,
): Promise<void> {
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Priority', { exact: true }).selectOption(priority);
  if (dueDate) await page.getByLabel('Due date').fill(dueDate);
  await page.getByRole('button', { name: `Toggle tag ${tagName}` }).click();
  const responsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/todos') && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

async function completeTodo(page: Page, title: string): Promise<void> {
  const todo = page.getByRole('listitem').filter({
    has: page.getByText(title, { exact: true }),
  });
  await todo.getByRole('checkbox').check();
}

test.beforeEach(async ({ page }) => {
  await addVirtualAuthenticator(page);
  await register(page);
});

test('searches todo and subtask titles case-insensitively, debounces, and clears immediately', async ({ page }) => {
  await createTodo(page, { title: 'Team meeting' });
  await createTodo(page, { title: 'Prepare notes' });
  await addSubtask(page, 'Prepare notes', 'Review agenda');

  await page.clock.install();
  await page.reload();
  const search = page.getByPlaceholder('Search todos and subtasks...');
  await search.fill('MEETING');
  await expect(search).toHaveValue('MEETING');
  expect(await page.getByText('Prepare notes', { exact: true }).isVisible()).toBe(true);
  await page.clock.runFor(300);
  await expect(page.getByText('Team meeting', { exact: true })).toBeVisible();
  await expect(page.getByText('Prepare notes', { exact: true })).toHaveCount(0);

  await search.fill('agenda');
  await page.clock.runFor(300);
  await expect(page.getByText('Prepare notes', { exact: true })).toBeVisible();
  await expect(page.getByText('Team meeting', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByText('Team meeting', { exact: true })).toBeVisible();
  await expect(page.getByText('Prepare notes', { exact: true })).toBeVisible();
});

test('combines priority and tag quick filters', async ({ page }) => {
  await createTag(page, 'Work');
  await createTag(page, 'Personal', '#9333EA');
  await createTaggedTodo(page, 'High Work task', 'Work', 'high');
  await createTaggedTodo(page, 'Low Work task', 'Work', 'low');
  await createTaggedTodo(page, 'High Personal task', 'Personal', 'high');

  await page.getByLabel('Priority filter').selectOption('high');
  await page.getByLabel('Tag filter').selectOption({
    label: 'Work',
  });

  await expect(page.getByText('High Work task', { exact: true })).toBeVisible();
  await expect(page.getByText('Low Work task', { exact: true })).toHaveCount(0);
  await expect(page.getByText('High Personal task', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Overdue todos' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Completed todos' })).toHaveCount(0);
});

test('advanced completion and date filters isolate matching due todos', async ({ page }) => {
  const dueWithinRange = dateTimeAfter(2);
  const dueOutsideRange = dateTimeAfter(6);
  await createTodo(page, { title: 'Completed in range', dueDate: dueWithinRange });
  await createTodo(page, { title: 'Incomplete in range', dueDate: dueWithinRange });
  await createTodo(page, { title: 'Completed outside range', dueDate: dueOutsideRange });
  await createTodo(page, { title: 'Completed without a date' });

  await completeTodo(page, 'Completed in range');
  await completeTodo(page, 'Completed outside range');
  await completeTodo(page, 'Completed without a date');

  await page.getByRole('button', { name: '▶ Advanced' }).click();
  await expect(page.getByLabel('Completion Status')).toBeVisible();
  await expect(page.getByLabel('Due Date From')).toBeVisible();
  await expect(page.getByLabel('Due Date To')).toBeVisible();
  await page.getByLabel('Completion Status').selectOption('completed');
  await page.getByLabel('Due Date From').fill(dueWithinRange.slice(0, 10));
  await page.getByLabel('Due Date To').fill(dueWithinRange.slice(0, 10));

  await expect(page.getByText('Completed in range', { exact: true })).toBeVisible();
  await expect(page.getByText('Incomplete in range', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Completed outside range', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Completed without a date', { exact: true })).toHaveCount(0);
});

test('applies all filter dimensions with AND logic and Clear All resets them together', async ({ page }) => {
  const workTagId = await createTag(page, 'Work');
  const rangeStart = dateTimeAfter(1);
  const rangeEnd = dateTimeAfter(4);
  await createTaggedTodo(page, 'Team launch match', 'Work', 'high', dateTimeAfter(2));
  await createTaggedTodo(page, 'Wrong priority', 'Work', 'low', dateTimeAfter(2));
  await createTodo(page, { title: 'Wrong tag', priority: 'high', dueDate: dateTimeAfter(2) });
  await createTaggedTodo(page, 'Wrong search', 'Work', 'high', dateTimeAfter(2));
  await createTaggedTodo(page, 'Wrong date', 'Work', 'high', dateTimeAfter(6));
  await createTaggedTodo(page, 'Wrong completion', 'Work', 'high', dateTimeAfter(2));
  await completeTodo(page, 'Wrong completion');

  await expect(page.getByRole('button', { name: 'Clear All' })).toHaveCount(0);
  await page.getByPlaceholder('Search todos and subtasks...').fill('Team launch');
  await expect(page.getByText('Team launch match', { exact: true })).toBeVisible();
  await page.waitForTimeout(350);
  await page.getByLabel('Priority filter').selectOption('high');
  await page.getByLabel('Tag filter').selectOption(String(workTagId));
  await page.getByRole('button', { name: '▶ Advanced' }).click();
  await page.getByLabel('Completion Status').selectOption('incomplete');
  await page.getByLabel('Due Date From').fill(rangeStart.slice(0, 10));
  await page.getByLabel('Due Date To').fill(rangeEnd.slice(0, 10));

  await expect(page.getByRole('button', { name: 'Clear All' })).toBeVisible();
  await expect(page.getByText('Team launch match', { exact: true })).toBeVisible();
  for (const title of [
    'Wrong priority',
    'Wrong tag',
    'Wrong search',
    'Wrong date',
    'Wrong completion',
  ]) {
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  }

  await page.getByRole('button', { name: 'Clear All' }).click();
  for (const title of [
    'Team launch match',
    'Wrong priority',
    'Wrong tag',
    'Wrong search',
    'Wrong date',
    'Wrong completion',
  ]) {
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Clear All' })).toHaveCount(0);
});

test('saves, reapplies after reload, and deletes a filter preset', async ({ page }) => {
  await createTodo(page, { title: 'Morning planning', priority: 'high' });
  await createTodo(page, { title: 'Evening planning', priority: 'low' });
  await page.getByPlaceholder('Search todos and subtasks...').fill('Morning');
  await page.waitForTimeout(350);
  await page.getByLabel('Priority filter').selectOption('high');

  await page.getByRole('button', { name: '💾 Save Filter' }).click();
  const dialog = page.getByRole('dialog', { name: /save filter/i });
  await expect(dialog.getByText(/Search: "Morning" · Priority: High/)).toBeVisible();
  await dialog.getByLabel('Preset name').fill('Morning high priority');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: '▶ Advanced' }).click();
  await expect(page.getByRole('button', { name: 'Morning high priority', exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText('Morning planning', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '▶ Advanced' }).click();
  await page.getByRole('button', { name: 'Morning high priority', exact: true }).click();
  await expect(page.getByPlaceholder('Search todos and subtasks...')).toHaveValue('Morning');
  await expect(page.getByLabel('Priority filter')).toHaveValue('high');
  await expect(page.getByText('Morning planning', { exact: true })).toBeVisible();
  await expect(page.getByText('Evening planning', { exact: true })).toHaveCount(0);

  await page.getByPlaceholder('Search todos and subtasks...').fill('Evening');
  await page.waitForTimeout(350);
  await page.getByLabel('Priority filter').selectOption('low');
  await page.getByRole('button', { name: 'Morning high priority', exact: true }).click();
  await expect(page.getByPlaceholder('Search todos and subtasks...')).toHaveValue('Morning');
  await expect(page.getByLabel('Priority filter')).toHaveValue('high');
  await page.waitForTimeout(350);
  await expect(page.getByText('Morning planning', { exact: true })).toBeVisible();
  await expect(page.getByText('Evening planning', { exact: true })).toHaveCount(0);

  page.once('dialog', (confirmation) => confirmation.accept());
  await page.getByRole('button', { name: 'Delete preset Morning high priority' }).click();
  await expect(page.getByRole('button', { name: 'Morning high priority', exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '▶ Advanced' }).click();
  await expect(page.getByRole('button', { name: 'Morning high priority', exact: true })).toHaveCount(0);
});

test('distinguishes no todos from no matching todos', async ({ page }) => {
  await expect(page.getByText(/no todos yet/i)).toBeVisible();

  await createTodo(page, { title: 'Existing task' });
  await page.getByPlaceholder('Search todos and subtasks...').fill('not found');
  await page.waitForTimeout(350);
  await expect(page.getByText(/no todos match your filters/i)).toBeVisible();
  await expect(page.getByText(/no todos yet/i)).toHaveCount(0);
});
