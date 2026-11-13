import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { getSingaporeNow, formatSingaporeDate, singaporeCalendarDate } from '../lib/timezone';
import { monthKey, moveMonth, parseMonthParam } from '../lib/calendar';

const authenticatorPages = new WeakSet<Page>();

async function register(page: Page) {
  if (!authenticatorPages.has(page)) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
        hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
      },
    });
    authenticatorPages.add(page);
  }
  await page.goto('/login');
  await page.getByLabel('Username').fill(`calendar-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page).toHaveURL('/');
}

async function persistedTodo(page: Page, title: string, dueDate: string | null, priority = 'medium', completed = false) {
  const created = await page.request.post('/api/todos', { data: { title, priority } });
  expect(created.status()).toBe(201);
  const todo = await created.json();
  const updated = await page.request.put(`/api/todos/${todo.id}`, { data: { due_date: dueDate, completed } });
  expect(updated.ok()).toBe(true);
  return todo;
}

async function loaded(page: Page) {
  await expect(page.getByRole('table', { name: 'Calendar days' })).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('region', { name: 'Monthly calendar' }).getByRole('alert')).toHaveCount(0);
}

test.beforeAll(() => {
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/seed-holidays.ts'], {
    env: { ...process.env, DATABASE_PATH: 'auth-e2e.db' },
  });
});

test('protects the calendar and holidays API when signed out', async ({ page }) => {
  const response = await page.request.get('/api/holidays');
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: 'Not authenticated' });
  await page.goto('/calendar');
  await expect(page).toHaveURL('/login');
});

test('opens current Singapore month, navigates year boundaries, preserves URL and falls back on invalid input', async ({ page }) => {
  await register(page);
  await page.getByRole('link', { name: 'Calendar', exact: true }).click();
  await loaded(page);
  const current = parseMonthParam(null, getSingaporeNow());
  const heading = new Intl.DateTimeFormat('en-SG', {
    month: 'long', year: 'numeric', timeZone: 'Asia/Singapore',
  }).format(singaporeCalendarDate(current.year, current.month, 1));
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(6);
  await expect(page.locator('tbody td')).toHaveCount(42);
  await expect(page.locator('th')).toHaveText(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  await expect(page.locator('[aria-current="date"]')).toHaveAttribute('data-date', formatSingaporeDate(getSingaporeNow(), 'yyyy-MM-dd'));
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page).toHaveURL(`/calendar?month=${monthKey(moveMonth(current, -1))}`);
  await loaded(page);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page).toHaveURL(`/calendar?month=${monthKey(current)}`);
  await page.goto('/calendar?month=2026-12');
  await loaded(page);
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page).toHaveURL('/calendar?month=2027-01');
  await loaded(page);
  await page.reload();
  await loaded(page);
  await expect(page.getByRole('heading', { name: 'January 2027' })).toBeVisible();
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page).toHaveURL('/calendar?month=2026-12');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page).toHaveURL(`/calendar?month=${monthKey(current)}`);
  for (const invalid of ['2026-13', 'abc', '0000-01']) {
    await page.goto(`/calendar?month=${invalid}`);
    await loaded(page);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Todo App', exact: true }).click();
  await expect(page).toHaveURL('/');
});

test('shows priority pills, completed tasks and overflow with a keyboard-accessible full day dialog', async ({ page }) => {
  await register(page);
  await persistedTodo(page, 'Calendar high', '2026-12-25T00:30', 'high');
  await persistedTodo(page, 'Calendar medium', '2026-12-24T16:45:00Z', 'medium', true);
  await persistedTodo(page, 'Calendar low', '2026-12-25T12:00+08:00', 'low');
  await persistedTodo(page, 'Calendar overflow', '2026-12-25T18:00+08:00', 'low');
  await persistedTodo(page, 'Undated task', null);
  await page.reload();
  await page.getByLabel('Priority filter').selectOption('high');
  await page.getByRole('link', { name: 'Calendar', exact: true }).click();
  await page.goto('/calendar?month=2026-12');
  await loaded(page);
  const day = page.locator('[data-date="2026-12-25"]');
  await expect(day).toContainText('Christmas Day');
  await expect(day).toContainText('Calendar high');
  await expect(day).toContainText('Calendar medium');
  await expect(day).toContainText('Calendar low');
  await expect(day).toContainText('+1 more');
  await expect(day).not.toContainText('Calendar overflow');
  await expect(page.getByText('Undated task')).toHaveCount(0);
  await expect(day.getByText('Calendar medium')).toHaveClass(/line-through/);
  await expect(day.getByText('Calendar high')).toHaveCSS('border-top-color', 'rgb(239, 68, 68)');
  await expect(day.getByText('Calendar medium')).toHaveCSS('border-top-color', 'rgb(245, 158, 11)');
  await expect(day.getByText('Calendar low')).toHaveCSS('border-top-color', 'rgb(59, 130, 246)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(day.getByText('Calendar high')).toHaveCSS('border-top-color', 'rgb(248, 113, 113)');
  await day.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Todos for 2026-12-25' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('listitem')).toHaveCount(4);
  await expect(dialog).toContainText('Christmas Day');
  await expect(dialog).toContainText('Completed');
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(day).toBeFocused();
  await day.click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.locator('[data-date="2026-12-02"]').click();
  await expect(page.getByRole('dialog')).toContainText('No todos due on this day.');
});

test('holidays API covers adjacent-month dates and rejects invalid parameters', async ({ page }) => {
  await register(page);
  const all = await page.request.get('/api/holidays');
  expect(all.ok()).toBe(true);
  expect((await all.json()).holidays.length).toBeGreaterThan(30);
  const december = await page.request.get('/api/holidays?year=2026&month=12');
  expect((await december.json()).holidays.map((holiday: { date: string }) => holiday.date))
    .toEqual(['2026-12-25', '2027-01-01']);
  for (const query of ['year=2026', 'month=12', 'year=no&month=1', 'year=2026&month=13', 'year=2026&month=0']) {
    expect((await page.request.get(`/api/holidays?${query}`)).status()).toBe(400);
  }
  await page.goto('/calendar?month=2026-12');
  await loaded(page);
  await expect(page.locator('[data-date="2027-01-01"]')).toContainText("New Year's Day");
});

test('keeps dates correct with a non-Singapore browser timezone and isolates accounts', async ({ page }) => {
  await register(page);
  await persistedTodo(page, 'Private midnight task', '2026-02-28T16:30:00Z');
  const second = await page.context().browser()!.newContext({
    baseURL: 'http://localhost:3100', timezoneId: 'America/Los_Angeles',
    storageState: await page.context().storageState(),
  });
  try {
    const otherTimezone = await second.newPage();
    await otherTimezone.goto('/calendar?month=2026-03');
    await loaded(otherTimezone);
    await expect(otherTimezone.locator('[data-date="2026-03-01"]')).toContainText('Private midnight task');
    await expect(otherTimezone.locator('[data-date="2026-02-28"]')).toHaveCount(0);
  } finally {
    await second.close();
  }
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL('/login');
  await register(page);
  await page.goto('/calendar?month=2026-03');
  await loaded(page);
  await expect(page.getByText('Private midnight task')).toHaveCount(0);
});

test('shows a clear load error and can retry without losing the viewed month', async ({ page }) => {
  await register(page);
  await page.route('**/api/holidays?**', (route) => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Test failure' }),
  }));
  await page.goto('/calendar?month=2028-02');
  await expect(page.getByRole('region', { name: 'Monthly calendar' }).getByRole('alert')).toContainText('Could not load calendar data');
  await page.unroute('**/api/holidays?**');
  await page.getByRole('button', { name: 'Retry' }).click();
  await loaded(page);
  await expect(page.getByRole('heading', { name: 'February 2028' })).toBeVisible();
  await expect(page.locator('[data-date="2028-02-29"]')).toBeVisible();
});

test('navigates with 499 todos under 200ms without layout shift and serves holidays under 100ms', async ({ page }) => {
  test.setTimeout(60_000);
  await register(page);
  for (let start = 0; start < 499; start += 10) {
    const responses = await Promise.all(Array.from({ length: Math.min(10, 499 - start) }, (_, index) => (
      page.request.post('/api/todos', {
        data: { title: `Performance todo ${start + index}`, due_date: '2030-01-31T12:00+08:00' },
      })
    )));
    for (const response of responses) expect(response.status()).toBe(201);
  }
  await page.goto('/calendar?month=2030-01');
  await loaded(page);
  await expect(page.locator('[data-date="2030-01-31"]')).toContainText('+496 more');
  const before = await page.getByRole('table').boundingBox();
  const elapsed = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const start = performance.now();
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error('Calendar navigation did not finish'));
    }, 5000);
    const observer = new MutationObserver(() => {
      if (document.querySelector('h2')?.textContent?.includes('February 2030')
        && document.querySelector('table')?.getAttribute('aria-busy') === 'false') {
        observer.disconnect();
        window.clearTimeout(timeout);
        requestAnimationFrame(() => resolve(performance.now() - start));
      }
    });
    observer.observe(document.querySelector('main')!, { subtree: true, childList: true, attributes: true });
    const next = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Next month');
    next!.click();
  }));
  expect(elapsed).toBeLessThan(200);
  const after = await page.getByRole('table').boundingBox();
  expect(after?.height).toBe(before?.height);
  await expect(page.locator('[data-date="2030-01-31"]')).toContainText('+496 more');
  const holidayMs = await page.evaluate(async () => {
    const start = performance.now();
    const response = await fetch('/api/holidays?year=2026&month=12');
    if (!response.ok) throw new Error('Holiday request failed');
    await response.json();
    return performance.now() - start;
  });
  expect(holidayMs).toBeLessThan(100);
  test.info().annotations.push({
    type: 'performance',
    description: `499 todos: navigation ${elapsed.toFixed(1)}ms; holidays ${holidayMs.toFixed(1)}ms`,
  });
});
