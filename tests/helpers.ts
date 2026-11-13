import { expect, type Page } from '@playwright/test';

export interface TodoFields {
  title: string;
  priority?: 'high' | 'medium' | 'low';
  dueDate?: string;
}

export async function createTodo(page: Page, fields: TodoFields): Promise<void> {
  await page.getByLabel('Title').fill(fields.title);
  if (fields.priority) {
    await page.getByLabel('Priority', { exact: true }).selectOption(fields.priority);
  }
  if (fields.dueDate) {
    await page.getByLabel('Due date').fill(fields.dueDate);
  }
  const responsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/todos') && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  await expect(page.getByText(fields.title, { exact: true })).toBeVisible();
}

export async function createTag(
  page: Page,
  name: string,
  color = '#3B82F6',
): Promise<number> {
  await page.getByRole('button', { name: '+ Manage Tags' }).click();
  await page.getByLabel('Tag name').fill(name);
  await page.getByLabel('Tag color hex').fill(color);
  const responsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/tags') && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Create Tag' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const tag = await response.json() as { id: number };
  await page.getByRole('button', { name: 'Close tag manager' }).click();
  return tag.id;
}

export async function addSubtask(
  page: Page,
  todoTitle: string,
  subtaskTitle: string,
  method: 'enter' | 'button' = 'enter',
): Promise<void> {
  const todo = page.getByRole('listitem').filter({
    has: page.getByText(todoTitle, { exact: true }),
  });
  const expandButton = todo.getByRole('button', { name: `Show subtasks for ${todoTitle}` });
  if (await expandButton.count() > 0) {
    await expandButton.click();
  }

  const input = todo.getByLabel(`New subtask for ${todoTitle}`);
  await input.fill(subtaskTitle);
  const responsePromise = page.waitForResponse((response) => (
    /\/api\/todos\/\d+\/subtasks$/.test(response.url())
      && response.request().method() === 'POST'
  ));
  if (method === 'button') {
    await todo.getByRole('button', { name: 'Add subtask' }).click();
  } else {
    await input.press('Enter');
  }
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  await expect(input).toHaveValue('');
}
