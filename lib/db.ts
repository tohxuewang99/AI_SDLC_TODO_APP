import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Priority } from './priority';
import { generateCalendarGrid } from './calendar.ts';

export { PRIORITY_ORDER, PRIORITY_VALUES } from './priority.ts';
export type { Priority } from './priority';
import { calculateNextDueDate } from './recurrence.ts';
import { isReminderDue } from './reminders.ts';
import { getSingaporeNow } from './timezone.ts';
import { parseTemplateSubtasks } from './template-serialization.ts';
import type { ImportResult, TodoExportItem } from './todo-transfer.ts';

export { REMINDER_LABELS } from './reminders.ts';
export type { ReminderMinutes } from './reminders.ts';

export interface User {
  id: number;
  username: string;
  created_at: string;
  webauthn_user_id: string;
}

export interface Authenticator {
  id: number;
  user_id: number;
  credential_id: string;
  credential_public_key: Buffer;
  counter: number;
  created_at: string;
}

export interface Session {
  userId: number;
  username: string;
}

export type ChallengePurpose = 'registration' | 'authentication';

export interface AuthChallenge {
  username: string;
  purpose: ChallengePurpose;
  user_id: number | null;
  user_handle: string | null;
  challenge: string;
  expires_at: number;
}

export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Tag {
  id: number;
  user_id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface CreateTagInput {
  name: string;
  color?: string;
}

export interface UpdateTagInput {
  name?: string;
  color?: string;
}

export interface Todo {
  id: number;
  user_id: number;
  title: string;
  completed: boolean;
  due_date: string | null;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: number | null;
  last_notification_sent: string | null;
  created_at: string;
  updated_at: string | null;
  subtasks?: Subtask[];
  tags: Tag[];
}

export interface Subtask {
  id: number;
  todo_id: number;
  title: string;
  completed: boolean;
  position: number;
  created_at: string;
}

export interface Template {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  category: string | null;
  title_template: string;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: number | null;
  due_date_offset_minutes: number | null;
  subtasks_json: string | null;
  created_at: string;
}

export interface TemplateSubtask {
  title: string;
  position: number;
}

export interface CreateTemplateDto {
  name: string;
  description?: string;
  category?: string;
  title_template: string;
  priority: Priority;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern;
  reminder_minutes?: number;
  due_date_offset_minutes?: number;
  subtasks?: TemplateSubtask[];
}

export type CreateTemplateInput = Omit<Template, 'id' | 'user_id' | 'created_at'>;
export type UpdateTemplateInput = Partial<CreateTemplateInput>;

interface TemplateRow extends Omit<Template, 'is_recurring'> {
  is_recurring: number;
}

export interface CreateSubtaskDto {
  title: string;
}

export interface UpdateSubtaskDto {
  title?: string;
  completed?: boolean;
}

export interface CreateTodoInput {
  title: string;
  due_date?: string | null;
  priority?: Priority;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
  reminder_minutes?: number | null;
  tag_ids?: number[];
}

export interface Holiday {
  id: number;
  date: string;
  name: string;
}

export interface UpdateTodoInput extends Partial<CreateTodoInput> {
  completed?: boolean;
  last_notification_sent?: string | null;
  notification_due_date?: string;
  notification_reminder_minutes?: number;
}

export interface TodoUpdateResult {
  todo: Todo;
  nextInstance?: Todo;
}

interface TodoRow extends Omit<
  Todo,
  'completed' | 'is_recurring' | 'tags' | 'subtasks'
> {
  completed: number;
  is_recurring: number;
  created_at: string;
  updated_at: string | null;
}

interface SubtaskRow extends Omit<Subtask, 'completed'> {
  completed: 0 | 1;
}

let db: Database.Database | undefined;

export function closeDatabase(): void {
  db?.close();
  db = undefined;
}

function normalizeSqliteTimestamp(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function mapSubtask(row: SubtaskRow): Subtask {
  return {
    ...row,
    completed: row.completed === 1,
    created_at: normalizeSqliteTimestamp(row.created_at) ?? row.created_at,
  };
}

function subtasksByTodoId(todoId: number, database = getDb()): Subtask[] {
  const rows = database.prepare(
    `SELECT id, todo_id, title, completed, position, created_at
     FROM subtasks WHERE todo_id = ? ORDER BY position ASC, id ASC`,
  ).all(todoId) as SubtaskRow[];
  return rows.map(mapSubtask);
}

function mapTodo(row: TodoRow): Todo {
  return {
    ...row,
    completed: Boolean(row.completed),
    is_recurring: Boolean(row.is_recurring),
    created_at: normalizeSqliteTimestamp(row.created_at) ?? row.created_at,
    updated_at: normalizeSqliteTimestamp(row.updated_at),
    tags: [],
    subtasks: [],
  };
}

function getTodo(
  database: Database.Database,
  id: number,
  userId: number,
): Todo | undefined {
  const row = database.prepare(
    `SELECT id, user_id, title, completed, due_date, priority, is_recurring,
            recurrence_pattern, reminder_minutes, last_notification_sent,
            created_at, updated_at
     FROM todos WHERE id = ? AND user_id = ?`,
  ).get(id, userId) as TodoRow | undefined;

  if (!row) {
    return undefined;
  }

  const tags = database.prepare(
    `SELECT tags.id, tags.user_id, tags.name, tags.color, tags.created_at
     FROM tags
     JOIN todo_tags ON todo_tags.tag_id = tags.id
     WHERE todo_tags.todo_id = ? AND tags.user_id = ?
     ORDER BY tags.name COLLATE NOCASE, tags.id`,
  ).all(id, userId) as Tag[];

  return {
    ...row,
    completed: Boolean(row.completed),
    is_recurring: Boolean(row.is_recurring),
    created_at: normalizeSqliteTimestamp(row.created_at) ?? row.created_at,
    updated_at: normalizeSqliteTimestamp(row.updated_at),
    tags,
    subtasks: subtasksByTodoId(id, database),
  };
}

function setTodoTags(
  database: Database.Database,
  todoId: number,
  userId: number,
  tagIds: number[],
): void {
  const uniqueIds = [...new Set(tagIds)];
  const findTag = database.prepare('SELECT id FROM tags WHERE id = ? AND user_id = ?');
  for (const tagId of uniqueIds) {
    if (!findTag.get(tagId, userId)) {
      throw new Error('Tag not found');
    }
  }

  database.prepare('DELETE FROM todo_tags WHERE todo_id = ?').run(todoId);
  const insertLink = database.prepare(
    'INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)',
  );
  for (const tagId of uniqueIds) {
    insertLink.run(todoId, tagId);
  }
}

function getDb(): Database.Database {
  if (db) {
    return db;
  }

  const dataDirectory = path.join(process.cwd(), 'data');
  mkdirSync(dataDirectory, { recursive: true });
  const databasePath = path.join(
    dataDirectory,
    path.basename(process.env.DATABASE_PATH ?? 'todos.db'),
  );
  const connection = new Database(databasePath);
  connection.pragma('foreign_keys = ON');
  connection.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      webauthn_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS authenticators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      credential_public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_authenticators_user_id ON authenticators(user_id);

    CREATE TABLE IF NOT EXISTS auth_challenges (
      username TEXT NOT NULL COLLATE NOCASE,
      purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'authentication')),
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      user_handle TEXT,
      challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (username, purpose)
    );

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
      is_recurring INTEGER NOT NULL DEFAULT 0,
      recurrence_pattern TEXT,
      reminder_minutes INTEGER,
      last_notification_sent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
    CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);

    CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_subtasks_todo_id ON subtasks(todo_id);

    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      title_template TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      is_recurring INTEGER NOT NULL DEFAULT 0,
      recurrence_pattern TEXT,
      reminder_minutes INTEGER,
      due_date_offset_minutes INTEGER,
      subtasks_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_templates_user_id ON templates(user_id);

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#3B82F6',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);

    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

    CREATE TABLE IF NOT EXISTS auth_challenges (
      username TEXT NOT NULL COLLATE NOCASE,
      purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'authentication')),
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      user_handle TEXT,
      challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (username, purpose)
    );

    CREATE TABLE IF NOT EXISTS todo_tags (
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (todo_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_todo_tags_tag_id ON todo_tags(tag_id);
  `);

  const userColumns = connection.pragma('table_info(users)') as { name: string }[];
  if (!userColumns.some((column) => column.name === 'webauthn_user_id')) {
    connection.exec('ALTER TABLE users ADD COLUMN webauthn_user_id TEXT');
  }
  const challengeColumns = connection.pragma('table_info(auth_challenges)') as { name: string }[];
  if (!challengeColumns.some((column) => column.name === 'user_handle')) {
    connection.exec('ALTER TABLE auth_challenges ADD COLUMN user_handle TEXT');
  }
  const usersWithoutWebAuthnId = connection.prepare(
    'SELECT id FROM users WHERE webauthn_user_id IS NULL',
  ).all() as { id: number }[];
  const setWebAuthnUserId = connection.prepare(
    'UPDATE users SET webauthn_user_id = ? WHERE id = ?',
  );
  for (const user of usersWithoutWebAuthnId) {
    setWebAuthnUserId.run(randomBytes(32).toString('base64url'), user.id);
  }
  connection.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_webauthn_user_id ON users(webauthn_user_id)',
  );
  db = connection;
  return connection;
}

export const todoDB = {
  importAll(userId: number, items: TodoExportItem[]): ImportResult {
    const database = getDb();
    const run = database.transaction(() => {
      const insertTodo = database.prepare(
        `INSERT INTO todos
          (user_id, title, completed, due_date, priority, is_recurring,
           recurrence_pattern, reminder_minutes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertSubtask = database.prepare(
        'INSERT INTO subtasks (todo_id, title, completed, position) VALUES (?, ?, ?, ?)',
      );
      const insertTag = database.prepare(
        'INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)',
      );
      const linkTag = database.prepare(
        'INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      );
      const existingTags = database.prepare(
        'SELECT id, name FROM tags WHERE user_id = ? ORDER BY id',
      ).all(userId) as { id: number; name: string }[];
      const tagsByName = new Map<string, number>();
      for (const tag of existingTags) {
        const key = tag.name.toLowerCase();
        if (!tagsByName.has(key)) tagsByName.set(key, tag.id);
      }

      let tagsCreated = 0;
      let tagsReused = 0;
      for (const item of items) {
        const todoId = Number(insertTodo.run(
          userId, item.title, Number(item.completed), item.due_date, item.priority,
          Number(item.is_recurring), item.recurrence_pattern, item.reminder_minutes,
          item.created_at,
        ).lastInsertRowid);
        item.subtasks.forEach((subtask, index) => {
          insertSubtask.run(todoId, subtask.title, Number(subtask.completed), index);
        });
        for (const tag of item.tags) {
          const key = tag.name.toLowerCase();
          let tagId = tagsByName.get(key);
          if (tagId === undefined) {
            tagId = Number(insertTag.run(userId, tag.name, tag.color).lastInsertRowid);
            tagsByName.set(key, tagId);
            tagsCreated += 1;
          } else {
            tagsReused += 1;
          }
          linkTag.run(todoId, tagId);
        }
      }
      return { imported: items.length, tagsCreated, tagsReused };
    });
    return run.immediate();
  },

  findDueReminders(userId: number, now: Date): Todo[] {
    const database = getDb();
    const rows = database.prepare(
      `SELECT id FROM todos
       WHERE user_id = ? AND completed = 0 AND due_date IS NOT NULL
         AND reminder_minutes IS NOT NULL AND last_notification_sent IS NULL`,
    ).all(userId) as { id: number }[];
    return rows.flatMap(({ id }) => {
      const todo = getTodo(database, id, userId);
      return todo && isReminderDue(todo, now) ? [todo] : [];
    });
  },

  findAllByUser(userId: number, priority?: Priority): Todo[] {
    const database = getDb();
    const rows = database.prepare(
      `SELECT id, user_id, title, completed, due_date, priority, is_recurring,
              recurrence_pattern, reminder_minutes, last_notification_sent,
              created_at, updated_at
       FROM todos WHERE user_id = ?${priority === undefined ? '' : ' AND priority = ?'}
       ORDER BY created_at DESC, id DESC`,
    ).all(...(priority === undefined ? [userId] : [userId, priority])) as TodoRow[];
    const todos = rows.map(mapTodo);
    if (todos.length === 0) {
      return todos;
    }

    const parameters = priority === undefined ? [userId] : [userId, priority];
    const priorityFilter = priority === undefined ? '' : ' AND todos.priority = ?';
    const subtaskRows = database.prepare(
      `SELECT subtasks.id, subtasks.todo_id, subtasks.title, subtasks.completed,
              subtasks.position, subtasks.created_at
       FROM subtasks
       INNER JOIN todos ON todos.id = subtasks.todo_id
       WHERE todos.user_id = ?${priorityFilter}
       ORDER BY subtasks.todo_id, subtasks.position, subtasks.id`,
    ).all(...parameters) as SubtaskRow[];
    const subtasksByTodo = new Map<number, Subtask[]>();
    for (const row of subtaskRows) {
      const subtasks = subtasksByTodo.get(row.todo_id) ?? [];
      subtasks.push(mapSubtask(row));
      subtasksByTodo.set(row.todo_id, subtasks);
    }
    const tagRows = database.prepare(
      `SELECT tags.id, tags.user_id, tags.name, tags.color, tags.created_at,
              todo_tags.todo_id
       FROM todo_tags
       INNER JOIN tags ON tags.id = todo_tags.tag_id
       INNER JOIN todos ON todos.id = todo_tags.todo_id
       WHERE todos.user_id = ?${priorityFilter}
       ORDER BY todo_tags.todo_id, tags.name COLLATE NOCASE, tags.id`,
    ).all(...parameters) as (Tag & { todo_id: number })[];
    const tagsByTodo = new Map<number, Tag[]>();
    for (const row of tagRows) {
      const tags = tagsByTodo.get(row.todo_id) ?? [];
      tags.push({
        id: row.id,
        user_id: row.user_id,
        name: row.name,
        color: row.color,
        created_at: normalizeSqliteTimestamp(row.created_at) ?? row.created_at,
      });
      tagsByTodo.set(row.todo_id, tags);
    }

    return todos.map((todo) => ({
      ...todo,
      subtasks: subtasksByTodo.get(todo.id) ?? [],
      tags: tagsByTodo.get(todo.id) ?? [],
    }));
  },

  findById(id: number, userId: number): Todo | undefined {
    return getTodo(getDb(), id, userId);
  },

  create(userId: number, input: CreateTodoInput): Todo {
    const database = getDb();
    const createTodo = database.transaction(() => {
      const result = database.prepare(
        `INSERT INTO todos
          (user_id, title, due_date, priority, is_recurring, recurrence_pattern, reminder_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        input.title,
        input.due_date ?? null,
        input.priority ?? 'medium',
        input.is_recurring ? 1 : 0,
        input.is_recurring ? input.recurrence_pattern ?? null : null,
        input.reminder_minutes ?? null,
      );
      const id = Number(result.lastInsertRowid);
      if (input.tag_ids) {
        setTodoTags(database, id, userId, input.tag_ids);
      }

      const todo = getTodo(database, id, userId);
      if (!todo) {
        throw new Error('Created todo could not be read back');
      }
      return todo;
    });
    return createTodo();
  },

  updateAndMaybeRecur(
    id: number,
    userId: number,
    input: UpdateTodoInput,
  ): TodoUpdateResult | undefined {
    const database = getDb();
    const updateTodo = database.transaction(() => {
      const existing = getTodo(database, id, userId);
      if (!existing) {
        return undefined;
      }
      if (
        input.last_notification_sent != null &&
        ((input.notification_due_date !== undefined &&
          input.notification_due_date !== existing.due_date) ||
          (input.notification_reminder_minutes !== undefined &&
            input.notification_reminder_minutes !== existing.reminder_minutes))
      ) {
        throw new Error('Reminder settings changed');
      }

      const columns: string[] = [];
      const values: (string | number | null)[] = [];
      const addUpdate = (column: string, value: string | number | null) => {
        columns.push(`${column} = ?`);
        values.push(value);
      };

      if (input.title !== undefined) addUpdate('title', input.title);
      if (input.completed !== undefined) addUpdate('completed', input.completed ? 1 : 0);
      if (input.due_date !== undefined) addUpdate('due_date', input.due_date);
      if (input.priority !== undefined) addUpdate('priority', input.priority);
      if (input.is_recurring !== undefined) {
        addUpdate('is_recurring', input.is_recurring ? 1 : 0);
        if (!input.is_recurring) {
          addUpdate('recurrence_pattern', null);
        }
      }
      if (input.recurrence_pattern !== undefined && input.is_recurring !== false) {
        addUpdate('recurrence_pattern', input.recurrence_pattern);
      }
      if (input.reminder_minutes !== undefined) {
        addUpdate('reminder_minutes', input.reminder_minutes);
      }
      if (
        (input.due_date !== undefined && input.due_date !== existing.due_date) ||
        (input.reminder_minutes !== undefined &&
          input.reminder_minutes !== existing.reminder_minutes)
      ) {
        addUpdate('last_notification_sent', null);
      } else if (input.last_notification_sent !== undefined) {
        addUpdate('last_notification_sent', input.last_notification_sent);
      }

      if (columns.length > 0) {
        columns.push("updated_at = datetime('now')");
        database.prepare(
          `UPDATE todos SET ${columns.join(', ')} WHERE id = ? AND user_id = ?`,
        ).run(...values, id, userId);
      }
      if (input.tag_ids !== undefined) {
        setTodoTags(database, id, userId, input.tag_ids);
      }

      const updated = getTodo(database, id, userId);
      if (!updated) {
        throw new Error('Updated todo could not be read back');
      }

      const justCompleted = input.completed === true && !existing.completed;
      if (
        !justCompleted ||
        !updated.is_recurring ||
        !updated.recurrence_pattern ||
        !updated.due_date
      ) {
        return { todo: updated };
      }

      const nextDueDate = calculateNextDueDate(
        updated.due_date,
        updated.recurrence_pattern,
      );
      const nextResult = database.prepare(
        `INSERT INTO todos
          (user_id, title, due_date, priority, is_recurring, recurrence_pattern, reminder_minutes)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      ).run(
        userId,
        updated.title,
        nextDueDate,
        updated.priority,
        updated.recurrence_pattern,
        updated.reminder_minutes,
      );
      const nextId = Number(nextResult.lastInsertRowid);
      const nextTagIds = database.prepare(
        'SELECT tag_id FROM todo_tags WHERE todo_id = ? ORDER BY tag_id',
      ).all(id) as { tag_id: number }[];
      setTodoTags(database, nextId, userId, nextTagIds.map(({ tag_id }) => tag_id));

      const nextInstance = getTodo(database, nextId, userId);
      if (!nextInstance) {
        throw new Error('Next recurring todo could not be read back');
      }
      return { todo: updated, nextInstance };
    });

    return updateTodo.immediate();
  },

  delete(id: number, userId: number): boolean {
    const result = getDb().prepare(
      'DELETE FROM todos WHERE id = ? AND user_id = ?',
    ).run(id, userId);
    return result.changes === 1;
  },
};

export const tagDB = {
  findAllByUser(userId: number): Tag[] {
    return getDb().prepare(
      `SELECT id, user_id, name, color, created_at
       FROM tags WHERE user_id = ? ORDER BY name COLLATE NOCASE, id`,
    ).all(userId) as Tag[];
  },

  findById(id: number, userId: number): Tag | undefined {
    return getDb().prepare(
      `SELECT id, user_id, name, color, created_at
       FROM tags WHERE id = ? AND user_id = ?`,
    ).get(id, userId) as Tag | undefined;
  },

  create(userId: number, name: string, color = '#3B82F6'): Tag {
    const database = getDb();
    const result = database.prepare(
      'INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)',
    ).run(userId, name, color);
    const tag = database.prepare(
      'SELECT id, user_id, name, color, created_at FROM tags WHERE id = ?',
    ).get(Number(result.lastInsertRowid)) as Tag | undefined;
    if (!tag) {
      throw new Error('Created tag could not be read back');
    }
    return tag;
  },

  update(id: number, userId: number, input: UpdateTagInput): Tag | undefined {
    const columns: { [K in keyof UpdateTagInput]: string } = {
      name: 'name',
      color: 'color',
    };
    const entries = Object.entries(input).filter(
      ([key, value]) => value !== undefined && Object.hasOwn(columns, key),
    ) as [keyof UpdateTagInput, UpdateTagInput[keyof UpdateTagInput]][];
    if (entries.length === 0) {
      return this.findById(id, userId);
    }

    const assignments = entries.map(([key]) => `${columns[key]} = ?`);
    const values = entries.map(([, value]) => value);
    getDb().prepare(
      `UPDATE tags SET ${assignments.join(', ')}
       WHERE id = ? AND user_id = ?`,
    ).run(...values, id, userId);
    return this.findById(id, userId);
  },

  delete(id: number, userId: number): boolean {
    return getDb().prepare(
      'DELETE FROM tags WHERE id = ? AND user_id = ?',
    ).run(id, userId).changes === 1;
  },

  attachToTodo(todoId: number, tagId: number, userId: number): boolean {
    const database = getDb();
    const attach = database.transaction(() => {
      const owned = database.prepare(
        `SELECT 1 FROM todos
         INNER JOIN tags ON tags.id = ?
         WHERE todos.id = ? AND todos.user_id = ? AND tags.user_id = ?`,
      ).get(tagId, todoId, userId, userId);
      if (!owned) {
        return false;
      }
      database.prepare(
        `INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)
         ON CONFLICT(todo_id, tag_id) DO NOTHING`,
      ).run(todoId, tagId);
      return true;
    });
    return attach();
  },

  detachFromTodo(todoId: number, tagId: number, userId: number): boolean {
    const database = getDb();
    const detach = database.transaction(() => {
      const owned = database.prepare(
        `SELECT 1 FROM todos
         INNER JOIN tags ON tags.id = ?
         WHERE todos.id = ? AND todos.user_id = ? AND tags.user_id = ?`,
      ).get(tagId, todoId, userId, userId);
      if (!owned) {
        return false;
      }
      database.prepare(
        'DELETE FROM todo_tags WHERE todo_id = ? AND tag_id = ?',
      ).run(todoId, tagId);
      return true;
    });
    return detach();
  },
};

function mapTemplate(row: TemplateRow): Template {
  return {
    ...row,
    is_recurring: Boolean(row.is_recurring),
    created_at: normalizeSqliteTimestamp(row.created_at) ?? row.created_at,
  };
}

export const templateDB = {
  findAllByUser(userId: number): Template[] {
    const rows = getDb().prepare(
      'SELECT * FROM templates WHERE user_id = ? ORDER BY created_at DESC, id DESC',
    ).all(userId) as TemplateRow[];
    return rows.map(mapTemplate);
  },

  findById(id: number, userId: number): Template | undefined {
    const row = getDb().prepare(
      'SELECT * FROM templates WHERE id = ? AND user_id = ?',
    ).get(id, userId) as TemplateRow | undefined;
    return row ? mapTemplate(row) : undefined;
  },

  create(userId: number, input: CreateTemplateInput): Template {
    const result = getDb().prepare(
      `INSERT INTO templates (
        user_id, name, description, category, title_template, priority,
        is_recurring, recurrence_pattern, reminder_minutes,
        due_date_offset_minutes, subtasks_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userId, input.name, input.description, input.category, input.title_template,
      input.priority, Number(input.is_recurring), input.recurrence_pattern,
      input.reminder_minutes, input.due_date_offset_minutes, input.subtasks_json,
    );
    const template = this.findById(Number(result.lastInsertRowid), userId);
    if (!template) throw new Error('Created template could not be read back');
    return template;
  },

  update(id: number, userId: number, input: UpdateTemplateInput): Template | undefined {
    const columns: (keyof CreateTemplateInput)[] = [
      'name', 'description', 'category', 'title_template', 'priority',
      'is_recurring', 'recurrence_pattern', 'reminder_minutes',
      'due_date_offset_minutes', 'subtasks_json',
    ];
    const changes = columns.filter((column) => input[column] !== undefined);
    if (changes.length > 0) {
      getDb().prepare(
        `UPDATE templates SET ${changes.map((column) => `${column} = ?`).join(', ')}
         WHERE id = ? AND user_id = ?`,
      ).run(...changes.map((column) => {
        const value = input[column];
        return typeof value === 'boolean' ? Number(value) : value;
      }), id, userId);
    }
    return this.findById(id, userId);
  },

  delete(id: number, userId: number): boolean {
    return getDb().prepare(
      'DELETE FROM templates WHERE id = ? AND user_id = ?',
    ).run(id, userId).changes === 1;
  },

  use(id: number, userId: number, now: Date = getSingaporeNow()): Todo | undefined {
    const database = getDb();
    return database.transaction(() => {
      const template = this.findById(id, userId);
      if (!template) return undefined;
      if (template.is_recurring && template.due_date_offset_minutes === null) {
        throw new Error('Recurring templates require a due date offset');
      }
      if (template.reminder_minutes !== null && template.due_date_offset_minutes === null) {
        throw new Error('Templates with reminders require a due date offset');
      }
      const dueDate = template.due_date_offset_minutes === null
        ? null
        : new Date(now.getTime() + template.due_date_offset_minutes * 60_000).toISOString();
      const todo = todoDB.create(userId, {
        title: template.title_template,
        priority: template.priority,
        due_date: dueDate,
        is_recurring: template.is_recurring,
        recurrence_pattern: template.recurrence_pattern,
        reminder_minutes: template.reminder_minutes,
      });
      const insert = database.prepare(
        'INSERT INTO subtasks (todo_id, title, position) VALUES (?, ?, ?)',
      );
      for (const subtask of parseTemplateSubtasks(template.subtasks_json)) {
        insert.run(todo.id, subtask.title, subtask.position);
      }
      const created = getTodo(database, todo.id, userId);
      if (!created) throw new Error('Created template todo could not be read back');
      return created;
    })();
  },
};

export const userDB = {
  findByUsername(username: string): User | undefined {
    return getDb().prepare(
      'SELECT id, username, created_at, webauthn_user_id FROM users WHERE username = ?',
    ).get(username) as User | undefined;
  },

  findById(id: number): User | undefined {
    return getDb().prepare(
      'SELECT id, username, created_at, webauthn_user_id FROM users WHERE id = ?',
    ).get(id) as User | undefined;
  },

  createWithAuthenticator(
    username: string,
    webauthnUserId: string,
    credentialId: string,
    credentialPublicKey: Buffer,
    counter: number,
  ): User {
    const database = getDb();
    const create = database.transaction(() => {
      const result = database.prepare(
        'INSERT INTO users (username, webauthn_user_id) VALUES (?, ?)',
      ).run(username, webauthnUserId);
      const userId = Number(result.lastInsertRowid);
      authenticatorDB.add(userId, credentialId, credentialPublicKey, counter);
      const user = userDB.findById(userId);
      if (!user) {
        throw new Error('Created user could not be read back');
      }
      return user;
    });

    return create();
  },
};

export const subtaskDB = {
  findByTodoId(todoId: number): Subtask[] {
    return subtasksByTodoId(todoId);
  },

  findById(id: number): Subtask | undefined {
    const row = getDb().prepare(
      `SELECT id, todo_id, title, completed, position, created_at
       FROM subtasks WHERE id = ?`,
    ).get(id) as SubtaskRow | undefined;
    return row ? mapSubtask(row) : undefined;
  },

  create(todoId: number, input: CreateSubtaskDto): Subtask {
    const result = getDb().prepare(
      `INSERT INTO subtasks (todo_id, title, position)
       VALUES (?, ?, (
         SELECT COALESCE(MAX(position) + 1, 0)
         FROM subtasks WHERE todo_id = ?
       ))`,
    ).run(todoId, input.title, todoId);
    const subtask = this.findById(Number(result.lastInsertRowid));
    if (!subtask) {
      throw new Error('Created subtask could not be read back');
    }
    return subtask;
  },

  update(id: number, input: UpdateSubtaskDto): Subtask | undefined {
    const columns: { [K in keyof UpdateSubtaskDto]: string } = {
      title: 'title',
      completed: 'completed',
    };
    const entries = Object.entries(input).filter(
      ([key, value]) => value !== undefined && Object.hasOwn(columns, key),
    ) as [keyof UpdateSubtaskDto, UpdateSubtaskDto[keyof UpdateSubtaskDto]][];
    if (entries.length === 0) {
      return this.findById(id);
    }

    const assignments = entries.map(([key]) => `${columns[key]} = ?`);
    const values = entries.map(([key, value]) => (
      key === 'completed' ? Number(value) : value
    ));
    getDb().prepare(
      `UPDATE subtasks SET ${assignments.join(', ')} WHERE id = ?`,
    ).run(...values, id);
    return this.findById(id);
  },

  delete(id: number): boolean {
    return getDb().prepare('DELETE FROM subtasks WHERE id = ?').run(id).changes === 1;
  },
};

export const authenticatorDB = {
  findByCredentialId(credentialId: string): Authenticator | undefined {
    return getDb().prepare(
      `SELECT id, user_id, credential_id, credential_public_key, counter, created_at
       FROM authenticators WHERE credential_id = ?`,
    ).get(credentialId) as Authenticator | undefined;
  },

  findByUserId(userId: number): Authenticator[] {
    return getDb().prepare(
      `SELECT id, user_id, credential_id, credential_public_key, counter, created_at
       FROM authenticators WHERE user_id = ? ORDER BY id`,
    ).all(userId) as Authenticator[];
  },

  add(
    userId: number,
    credentialId: string,
    credentialPublicKey: Buffer,
    counter: number,
  ): void {
    getDb().prepare(
      `INSERT INTO authenticators
        (user_id, credential_id, credential_public_key, counter)
       VALUES (?, ?, ?, ?)`,
    ).run(userId, credentialId, credentialPublicKey, counter);
  },

  updateCounterIfUnchanged(
    id: number,
    previousCounter: number,
    newCounter: number,
  ): boolean {
    const result = getDb().prepare(
      'UPDATE authenticators SET counter = ? WHERE id = ? AND counter = ?',
    ).run(newCounter, id, previousCounter);
    return result.changes === 1;
  },
};

export const holidayDB = {
  findAll(): Holiday[] {
    return getDb().prepare('SELECT id, date, name FROM holidays ORDER BY date').all() as Holiday[];
  },

  findByMonth(year: number, month: number): Holiday[] {
    const grid = generateCalendarGrid(year, month);
    return getDb().prepare(
      'SELECT id, date, name FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date',
    ).all(grid[0].date, grid[41].date) as Holiday[];
  },

  seed(holidays: ReadonlyArray<Omit<Holiday, 'id'>>): void {
    const database = getDb();
    const insert = database.prepare(
      `INSERT INTO holidays (date, name) VALUES (?, ?)
       ON CONFLICT(date) DO UPDATE SET name = excluded.name`,
    );
    database.transaction(() => {
      for (const holiday of holidays) insert.run(holiday.date, holiday.name);
    })();
  },
};

export const challengeStore = {
  save(
    username: string,
    purpose: ChallengePurpose,
    challenge: string,
    userId: number | null,
    userHandle: string | null,
    lifetimeMs: number,
  ): void {
    getDb().prepare(
      `INSERT INTO auth_challenges
        (username, purpose, challenge, user_id, user_handle, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(username, purpose) DO UPDATE SET
         challenge = excluded.challenge,
         user_id = excluded.user_id,
         user_handle = excluded.user_handle,
         expires_at = excluded.expires_at`,
    ).run(username, purpose, challenge, userId, userHandle, Date.now() + lifetimeMs);
  },

  consume(username: string, purpose: ChallengePurpose): AuthChallenge | undefined {
    const database = getDb();
    const consume = database.transaction(() => {
      const challenge = database.prepare(
        `SELECT username, purpose, user_id, user_handle, challenge, expires_at
         FROM auth_challenges WHERE username = ? AND purpose = ?`,
      ).get(username, purpose) as AuthChallenge | undefined;

      database.prepare(
        'DELETE FROM auth_challenges WHERE username = ? AND purpose = ?',
      ).run(username, purpose);

      if (!challenge || challenge.expires_at <= Date.now()) {
        return undefined;
      }
      return challenge;
    });

    return consume();
  },
};
