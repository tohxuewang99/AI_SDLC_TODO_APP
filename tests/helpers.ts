import type { Page } from '@playwright/test';

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
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}
