import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Priority } from './priority';

export { PRIORITY_ORDER, PRIORITY_VALUES } from './priority';
export type { Priority } from './priority';

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

export type ChallengePurpose = 'registration' | 'authentication';

export interface AuthChallenge {
  username: string;
  purpose: ChallengePurpose;
  user_id: number | null;
  user_handle: string | null;
  challenge: string;
  expires_at: number;
}

export interface Todo {
  id: number;
  user_id: number;
  title: string;
  completed: boolean;
  due_date: string | null;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: string | null;
  reminder_minutes: number | null;
  last_notification_sent: string | null;
  created_at: string;
  updated_at: string | null;
  subtasks?: Subtask[];
  tags?: Tag[];
}

export interface Subtask {
  id: number;
  todo_id: number;
  title: string;
  completed: boolean;
  position: number;
  created_at: string;
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
}

export interface UpdateTodoInput {
  title?: string;
  due_date?: string | null;
  priority?: Priority;
  completed?: boolean;
}

let db: Database.Database | undefined;

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

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#3B82F6',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);

    CREATE TABLE IF NOT EXISTS todo_tags (
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (todo_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_todo_tags_tag_id ON todo_tags(tag_id);

    CREATE TABLE IF NOT EXISTS auth_challenges (
      username TEXT NOT NULL COLLATE NOCASE,
      purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'authentication')),
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      user_handle TEXT,
      challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (username, purpose)
    );
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

interface TodoRow extends Omit<
  Todo,
  'completed' | 'is_recurring' | 'created_at' | 'updated_at' | 'subtasks' | 'tags'
> {
  completed: 0 | 1;
  is_recurring: 0 | 1;
  created_at: string;
  updated_at: string | null;
}

interface SubtaskRow extends Omit<Subtask, 'completed'> {
  completed: 0 | 1;
}

type TagRow = Tag;

function normalizeSqliteTimestamp(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function mapTodo(row: TodoRow): Todo {
  return {
    ...row,
    completed: row.completed === 1,
    is_recurring: row.is_recurring === 1,
    created_at: normalizeSqliteTimestamp(row.created_at) ?? row.created_at,
    updated_at: normalizeSqliteTimestamp(row.updated_at),
  };
}

function mapSubtask(row: SubtaskRow): Subtask {
  return {
    ...row,
    completed: row.completed === 1,
    created_at: normalizeSqliteTimestamp(row.created_at) ?? row.created_at,
  };
}

function mapTag(row: TagRow): Tag {
  return {
    ...row,
    created_at: normalizeSqliteTimestamp(row.created_at) ?? row.created_at,
  };
}

function subtasksByTodoId(todoId: number): Subtask[] {
  const rows = getDb().prepare(
    `SELECT id, todo_id, title, completed, position, created_at
     FROM subtasks WHERE todo_id = ? ORDER BY position ASC, id ASC`,
  ).all(todoId) as SubtaskRow[];
  return rows.map(mapSubtask);
}

function tagsByTodoId(todoId: number): Tag[] {
  const rows = getDb().prepare(
    `SELECT tags.id, tags.user_id, tags.name, tags.color, tags.created_at
     FROM tags
     INNER JOIN todo_tags ON todo_tags.tag_id = tags.id
     WHERE todo_tags.todo_id = ?
     ORDER BY tags.name COLLATE NOCASE ASC, tags.id ASC`,
  ).all(todoId) as TagRow[];
  return rows.map(mapTag);
}

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

export const todoDB = {
  findAllByUser(userId: number, priority?: Priority): Todo[] {
    const database = getDb();
    const priorityFilter = priority === undefined ? '' : ' AND priority = ?';
    const parameters = priority === undefined ? [userId] : [userId, priority];
    const rows = database.prepare(
      `SELECT id, user_id, title, completed, due_date, priority, is_recurring,
              recurrence_pattern, reminder_minutes, last_notification_sent,
              created_at, updated_at
       FROM todos WHERE user_id = ?${priorityFilter}`,
    ).all(...parameters) as TodoRow[];
    const todos = rows.map(mapTodo);
    if (todos.length === 0) {
      return todos;
    }

    const subtaskRows = database.prepare(
      `SELECT subtasks.id, subtasks.todo_id, subtasks.title, subtasks.completed,
              subtasks.position, subtasks.created_at
       FROM subtasks
       INNER JOIN todos ON todos.id = subtasks.todo_id
       WHERE todos.user_id = ?${priorityFilter}
       ORDER BY subtasks.todo_id, subtasks.position ASC, subtasks.id ASC`,
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
       ORDER BY todo_tags.todo_id, tags.name COLLATE NOCASE ASC, tags.id ASC`,
    ).all(...parameters) as (TagRow & { todo_id: number })[];
    const tagsByTodo = new Map<number, Tag[]>();
    for (const row of tagRows) {
      const tags = tagsByTodo.get(row.todo_id) ?? [];
      tags.push(mapTag(row));
      tagsByTodo.set(row.todo_id, tags);
    }
    return todos.map((todo) => ({
      ...todo,
      subtasks: subtasksByTodo.get(todo.id) ?? [],
      tags: tagsByTodo.get(todo.id) ?? [],
    }));
  },

  findById(id: number): Todo | undefined {
    const row = getDb().prepare(
      `SELECT id, user_id, title, completed, due_date, priority, is_recurring,
              recurrence_pattern, reminder_minutes, last_notification_sent,
              created_at, updated_at
       FROM todos WHERE id = ?`,
    ).get(id) as TodoRow | undefined;
    return row
      ? {
          ...mapTodo(row),
          subtasks: subtasksByTodoId(id),
          tags: tagsByTodoId(id),
        }
      : undefined;
  },

  create(userId: number, input: CreateTodoInput): Todo {
    const result = getDb().prepare(
      `INSERT INTO todos (user_id, title, due_date, priority)
       VALUES (?, ?, ?, ?)`,
    ).run(userId, input.title, input.due_date ?? null, input.priority ?? 'medium');
    const todo = this.findById(Number(result.lastInsertRowid));
    if (!todo) {
      throw new Error('Created todo could not be read back');
    }
    return todo;
  },

  update(id: number, input: UpdateTodoInput): Todo | undefined {
    const columns: { [K in keyof UpdateTodoInput]: string } = {
      title: 'title',
      due_date: 'due_date',
      priority: 'priority',
      completed: 'completed',
    };
    const entries = Object.entries(input).filter(
      ([key, value]) => value !== undefined && Object.hasOwn(columns, key),
    ) as [keyof UpdateTodoInput, UpdateTodoInput[keyof UpdateTodoInput]][];
    if (entries.length === 0) {
      return this.findById(id);
    }

    const assignments = entries.map(([key]) => `${columns[key]} = ?`);
    const values = entries.map(([key, value]) => (
      key === 'completed' ? Number(value) : value
    ));
    getDb().prepare(
      `UPDATE todos SET ${assignments.join(', ')}, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(...values, id);
    return this.findById(id);
  },

  delete(id: number): boolean {
    return getDb().prepare('DELETE FROM todos WHERE id = ?').run(id).changes === 1;
  },
};

export const tagDB = {
  findAllByUser(userId: number): Tag[] {
    const rows = getDb().prepare(
      `SELECT id, user_id, name, color, created_at
       FROM tags WHERE user_id = ?
       ORDER BY name COLLATE NOCASE ASC, id ASC`,
    ).all(userId) as TagRow[];
    return rows.map(mapTag);
  },

  findById(id: number, userId: number): Tag | undefined {
    const row = getDb().prepare(
      `SELECT id, user_id, name, color, created_at
       FROM tags WHERE id = ? AND user_id = ?`,
    ).get(id, userId) as TagRow | undefined;
    return row ? mapTag(row) : undefined;
  },

  create(userId: number, input: CreateTagInput): Tag {
    const result = getDb().prepare(
      `INSERT INTO tags (user_id, name, color)
       VALUES (?, ?, ?)`,
    ).run(userId, input.name, input.color ?? '#3B82F6');
    const tag = this.findById(Number(result.lastInsertRowid), userId);
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

  findByTodoId(todoId: number): Tag[] {
    return tagsByTodoId(todoId);
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
