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
  await page.getByRole('button', { name: 'Add', exact: true }).click();
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
  if (method === 'button') {
    await todo.getByRole('button', { name: 'Add subtask' }).click();
  } else {
    await input.press('Enter');
  }
  await expect(input).toHaveValue('');
}
