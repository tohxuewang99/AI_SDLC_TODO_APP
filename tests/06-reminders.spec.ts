import { test, expect, type Page } from '@playwright/test';
import type { Todo } from '../lib/db';

declare global {
  interface Window {
    reminderNotifications: { title: string; options?: NotificationOptions }[];
  }
}

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
  await page.getByLabel('Username').fill(`reminder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page).toHaveURL('/');
}

function dueInMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function create(page: Page, input: Partial<Todo> = {}): Promise<Todo> {
  const response = await page.request.post('/api/todos', {
    data: { title: 'Reminder test', due_date: dueInMinutes(5), reminder_minutes: 15, ...input },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

async function update(page: Page, id: number, input: unknown): Promise<Todo> {
  const response = await page.request.put(`/api/todos/${id}`, { data: input });
  expect(response.status()).toBe(200);
  return (await response.json()).todo;
}

async function dueTodos(page: Page): Promise<Todo[]> {
  const response = await page.request.get('/api/notifications/check');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  const body = await response.json();
  expect(body.success).toBe(true);
  return body.data;
}

async function mockNotifications(page: Page, permission: NotificationPermission = 'default') {
  await page.addInitScript((initialPermission: NotificationPermission) => {
    const notifications: { title: string; options?: NotificationOptions }[] = [];
    class MockNotification {
      static permission: NotificationPermission = initialPermission;
      static fail = false;
      static async requestPermission() {
        this.permission = 'granted';
        return this.permission;
      }
      onclick: (() => void) | null = null;
      constructor(title: string, options?: NotificationOptions) {
        if (MockNotification.fail) throw new Error('Notification display failed');
        notifications.push({ title, options });
      }
      close() {}
    }
    Object.defineProperty(window, 'Notification', { value: MockNotification, configurable: true });
    Object.defineProperty(window, 'reminderNotifications', { value: notifications });
  }, permission);
}

async function notificationCount(page: Page) {
  return page.evaluate(() => window.reminderNotifications.length);
}

test('check is authenticated, owned and excludes overdue and other ineligible todos', async ({ page, browser }) => {
  expect((await page.request.get('/api/notifications/check')).status()).toBe(401);
  await register(page);
  const eligible = await create(page);
  await create(page, { title: 'Too early', due_date: dueInMinutes(120), reminder_minutes: 15 });
  await create(page, { title: 'No reminder', reminder_minutes: null });
  await create(page, { title: 'No due date', due_date: null, reminder_minutes: null });
  const completed = await create(page, { title: 'Completed' });
  await update(page, completed.id, { completed: true });
  const sent = await create(page, { title: 'Sent' });
  await update(page, sent.id, { last_notification_sent: new Date().toISOString() });
  const late = await create(page, { title: 'Late' });
  await update(page, late.id, { due_date: '2025-01-01T00:05' });
  expect((await dueTodos(page)).map((todo) => todo.id)).toEqual([eligible.id]);

  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await register(other);
    expect(await dueTodos(other)).toEqual([]);
    expect((await other.request.put(`/api/todos/${eligible.id}`, {
      data: { last_notification_sent: new Date().toISOString() },
    })).status()).toBe(404);
  } finally {
    await otherContext.close();
  }
});

test('all presets validate, sent state resets on schedule edits, stale acknowledgements cannot suppress edits', async ({ page }) => {
  await register(page);
  for (const minutes of [15, 30, 60, 120, 1440, 2880, 10080]) {
    const todo = await create(page, { reminder_minutes: minutes });
    expect(todo.reminder_minutes).toBe(minutes);
    expect((await dueTodos(page)).some((due) => due.id === todo.id)).toBe(true);
  }
  expect((await page.request.post('/api/todos', {
    data: { title: 'Missing due', reminder_minutes: 15 },
  })).status()).toBe(400);
  expect((await page.request.post('/api/todos', {
    data: { title: 'Custom timing', due_date: dueInMinutes(5), reminder_minutes: 1 },
  })).status()).toBe(400);
  const todo = await create(page);
  const stamp = new Date().toISOString();
  expect((await update(page, todo.id, { last_notification_sent: stamp })).last_notification_sent).toBe(stamp);
  expect((await dueTodos(page)).some((due) => due.id === todo.id)).toBe(false);
  expect((await update(page, todo.id, { title: 'Rename only' })).last_notification_sent).toBe(stamp);
  expect((await update(page, todo.id, { reminder_minutes: 30 })).last_notification_sent).toBeNull();
  expect((await page.request.put(`/api/todos/${todo.id}`, {
    data: {
      last_notification_sent: stamp,
      notification_due_date: todo.due_date,
      notification_reminder_minutes: 15,
    },
  })).status()).toBe(409);
  await update(page, todo.id, { last_notification_sent: stamp });
  expect((await update(page, todo.id, { due_date: dueInMinutes(6) })).last_notification_sent).toBeNull();
  await update(page, todo.id, { last_notification_sent: stamp });
  const cleared = await update(page, todo.id, { due_date: null });
  expect(cleared.reminder_minutes).toBeNull();
  expect(cleared.last_notification_sent).toBeNull();
});

test('create and edit expose None plus seven presets, date gating and bell badges', async ({ page }) => {
  await register(page);
  const reminder = page.getByLabel('Reminder', { exact: true });
  await expect(reminder).toBeDisabled();
  await expect(reminder.locator('option')).toHaveCount(8);
  const date = await page.evaluate(() => {
    const date = new Date(Date.now() + 3_600_000);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  });
  await page.getByLabel('Title', { exact: true }).fill('UI reminder');
  await page.getByLabel('Due date', { exact: true }).fill(date);
  await expect(reminder).toBeEnabled();
  await reminder.selectOption('60');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const item = page.getByRole('listitem').filter({ hasText: 'UI reminder' });
  await expect(item.getByLabel('Reminder 1h')).toBeVisible();
  await item.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Edit reminder').selectOption('30');
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(item.getByLabel('Reminder 30m')).toBeVisible();
  await item.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Edit due date').fill('');
  await expect(page.getByLabel('Edit reminder')).toBeDisabled();
  await expect(page.getByLabel('Edit reminder')).toHaveValue('');
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(item.getByLabel('Reminder 30m')).toHaveCount(0);
});

test('permission opt-in immediately delivers and stamps, polls every 30 seconds and stops on revocation', async ({ page }) => {
  await mockNotifications(page);
  await register(page);
  const todo = await create(page);
  await page.clock.install();
  await expect(page.getByRole('button', { name: 'Enable Notifications' })).toBeVisible();
  expect(await notificationCount(page)).toBe(0);
  await page.getByRole('button', { name: 'Enable Notifications' }).click();
  await expect(page.getByRole('button', { name: 'Notifications On' })).toBeVisible();
  await expect.poll(() => notificationCount(page)).toBe(1);
  await expect.poll(async () => (await dueTodos(page)).length).toBe(0);
  const delivered = await page.evaluate(() => window.reminderNotifications[0]);
  expect(delivered.title).toBe(todo.title);
  expect(delivered.options?.tag).toBe(`todo-${todo.id}`);
  expect(delivered.options?.body).toContain('Due ');
  await create(page, { title: 'Second reminder' });
  await page.clock.fastForward(29_000);
  expect(await notificationCount(page)).toBe(1);
  await page.clock.fastForward(1_000);
  await expect.poll(() => notificationCount(page)).toBe(2);
  await page.clock.fastForward(30_000);
  expect(await notificationCount(page)).toBe(2);
  await page.evaluate(() => {
    Object.defineProperty(Notification, 'permission', { value: 'denied', writable: true });
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.getByText('Notifications are blocked.', { exact: false })).toBeVisible();
  await create(page, { title: 'Revoked reminder' });
  await page.clock.fastForward(60_000);
  expect(await notificationCount(page)).toBe(2);
});

test('failed delivery is visible and retried; failed stamp retries without redisplaying in the same tab', async ({ page }) => {
  await mockNotifications(page);
  await register(page);
  await create(page);
  await page.clock.install();
  await page.evaluate(() => { (Notification as typeof Notification & { fail: boolean }).fail = true; });
  await page.getByRole('button', { name: 'Enable Notifications' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Notification display failed');
  expect(await notificationCount(page)).toBe(0);
  expect(await dueTodos(page)).toHaveLength(1);
  await page.evaluate(() => { (Notification as typeof Notification & { fail: boolean }).fail = false; });
  let acknowledgements = 0;
  await page.route('**/api/todos/*', async (route) => {
    if (route.request().method() === 'PUT' && acknowledgements++ === 0) {
      await route.fulfill({ status: 503, json: { error: 'Temporary failure' } });
    } else {
      await route.continue();
    }
  });
  await page.clock.fastForward(30_000);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Could not save reminder delivery');
  expect(await notificationCount(page)).toBe(1);
  await page.clock.fastForward(30_000);
  await expect.poll(async () => (await dueTodos(page)).length).toBe(0);
  expect(await notificationCount(page)).toBe(1);
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('existing granted permission polls immediately without overlap and cleans up on navigation', async ({ page }) => {
  await mockNotifications(page, 'granted');
  await register(page);
  const todo = await create(page);
  let checks = 0;
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/notifications/check', async (route) => {
    checks++;
    await pending;
    await route.fulfill({ json: { success: true, data: [todo] } });
  });
  await page.reload();
  await page.clock.install();
  await expect.poll(() => checks).toBe(1);
  await expect(page.getByRole('button', { name: 'Notifications On' })).toBeVisible();
  await page.clock.fastForward(90_000);
  expect(checks).toBe(1);
  await page.goto('/calendar');
  release();
  await page.clock.fastForward(60_000);
  expect(checks).toBe(1);
  expect(await notificationCount(page)).toBe(0);
});

test('unsupported browsers disable notification opt-in without blocking todos', async ({ page }) => {
  await page.addInitScript(() => { Reflect.deleteProperty(window, 'Notification'); });
  await register(page);
  await expect(page.getByRole('button', { name: 'Notifications unavailable' })).toBeDisabled();
  await page.getByLabel('Title', { exact: true }).fill('Unsupported browser task');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Unsupported browser task' })).toBeVisible();
});

test('check failures are visible and retried at the next polling tick', async ({ page }) => {
  await mockNotifications(page, 'granted');
  await register(page);
  let checks = 0;
  await page.route('**/api/notifications/check', async (route) => {
    checks++;
    await route.fulfill(checks === 1
      ? { status: 503, json: { error: 'Unavailable' } }
      : { json: { success: true, data: [] } });
  });
  await page.clock.install();
  await page.reload();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Could not check reminders');
  await page.clock.fastForward(30_000);
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  expect(checks).toBe(2);
});
