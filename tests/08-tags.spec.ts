import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { createTag } from './helpers';

const virtualAuthenticatorOptions = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

function uniqueUsername(): string {
  return `tag-ui-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

test.beforeEach(async ({ page }) => {
  await addVirtualAuthenticator(page);
});

test('creates colored tags and reports duplicate names', async ({ page }) => {
  await register(page);
  await page.getByRole('button', { name: '+ Manage Tags' }).click();
  await page.getByLabel('Tag name').fill('Work');
  await page.getByLabel('Tag color hex').fill('#AABBCC');

  const createResponse = page.waitForResponse((response) => (
    response.url().endsWith('/api/tags') && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Create Tag' }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page.getByRole('dialog', { name: 'Manage Tags' }).getByText('Work', { exact: true }))
    .toBeVisible();

  await page.getByLabel('Tag name').fill('Work');
  await page.getByRole('button', { name: 'Create Tag' }).click();
  await expect(page.getByRole('dialog', { name: 'Manage Tags' }).getByRole('alert'))
    .toHaveText('A tag with this name already exists');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tag manager' }).click();
  await expect(page.getByRole('button', { name: 'Toggle tag Work' })).toBeVisible();
});

test('selects multiple tags on create and edit, and renders updated tag data', async ({ page }) => {
  await register(page);
  await createTag(page, 'Work', '#2563EB');
  await createTag(page, 'Urgent', '#DC2626');

  await page.getByLabel('Title').fill('Prepare release');
  await page.getByRole('button', { name: 'Toggle tag Work' }).click();
  await page.getByRole('button', { name: 'Toggle tag Urgent' }).click();
  const addResponse = page.waitForResponse((response) => (
    response.url().endsWith('/api/todos') && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  expect((await addResponse).status()).toBe(201);

  const todo = page.getByRole('listitem').filter({
    has: page.getByText('Prepare release', { exact: true }),
  });
  await expect(todo.getByRole('button', { name: 'Filter by tag Work' })).toBeVisible();
  await expect(todo.getByRole('button', { name: 'Filter by tag Urgent' })).toBeVisible();
  expect((await (await page.request.get('/api/todos')).json())[0].tags).toHaveLength(2);

  await todo.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Toggle tag Urgent' }).click();
  await page.getByLabel('Edit title').fill('Prepare product release');
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByText('Prepare product release', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter by tag Work' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter by tag Urgent' })).toHaveCount(0);

  await page.getByRole('button', { name: '+ Manage Tags' }).click();
  await page.getByRole('dialog', { name: 'Manage Tags' })
    .getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByLabel('Edit tag name').fill('Team');
  await page.getByLabel('Edit tag color hex').fill('#16A34A');
  const updateResponse = page.waitForResponse((response) => (
    /\/api\/tags\/\d+$/.test(response.url()) && response.request().method() === 'PUT'
  ));
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  expect((await updateResponse).status()).toBe(200);
  await page.getByRole('button', { name: 'Close tag manager' }).click();
  await expect(page.getByRole('button', { name: 'Filter by tag Team' })).toBeVisible();
  expect((await (await page.request.get('/api/todos')).json())[0].tags[0])
    .toMatchObject({ name: 'Team', color: '#16A34A' });
});

test('filters by dropdown or card pill, clears with All Tags, and resets after deleting the active tag', async ({ page }) => {
  await register(page);
  await createTag(page, 'Work');
  await createTag(page, 'Personal', '#9333EA');

  await page.getByLabel('Title').fill('Work todo');
  await page.getByRole('button', { name: 'Toggle tag Work' }).click();
  const firstTodoResponse = page.waitForResponse((response) => (
    response.url().endsWith('/api/todos') && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  expect((await firstTodoResponse).status()).toBe(201);
  await expect(page.getByText('Work todo', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter by tag Work' })).toBeVisible();

  await page.getByLabel('Title').fill('Personal todo');
  await page.getByRole('button', { name: 'Toggle tag Personal' }).click();
  const secondTodoResponse = page.waitForResponse((response) => (
    response.url().endsWith('/api/todos') && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  expect((await secondTodoResponse).status()).toBe(201);
  await expect(page.getByRole('button', { name: 'Filter by tag Personal' })).toBeVisible();

  const tagFilter = page.getByLabel('Tag filter');
  await tagFilter.selectOption({ label: 'Work' });
  await expect(page.getByText('Work todo', { exact: true })).toBeVisible();
  await expect(page.getByText('Personal todo', { exact: true })).toHaveCount(0);

  await tagFilter.selectOption('all');
  await expect(page.getByText('Personal todo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Filter by tag Personal' }).click();
  await expect(tagFilter).toHaveValue(
    await tagFilter.locator('option', { hasText: 'Personal' }).getAttribute('value') ?? '',
  );
  await expect(page.getByText('Work todo', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '+ Manage Tags' }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage Tags' });
  const personalTag = dialog.getByRole('listitem').filter({ has: page.getByText('Personal', { exact: true }) });
  page.once('dialog', (confirmation) => confirmation.accept());
  await personalTag.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: 'Close tag manager' })).toBeVisible();
  await expect(tagFilter).toHaveValue('all');
  await page.getByRole('button', { name: 'Close tag manager' }).click();
  await expect(page.getByText('Work todo', { exact: true })).toBeVisible();
  await expect(page.getByText('Personal todo', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter by tag Personal' })).toHaveCount(0);
});
