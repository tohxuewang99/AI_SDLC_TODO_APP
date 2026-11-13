import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import { closeDatabase, templateDB, todoDB, userDB, type CreateTemplateInput } from '../lib/db';
import { serializeTemplateSubtasks } from '../lib/template-serialization';

test('template snapshots persist with ownership, atomic use, and deletion isolation', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'todo-template-persistence-'));
  const previousDirectory = process.cwd();
  const previousDatabasePath = process.env.DATABASE_PATH;
  let connection: Database.Database | undefined;
  process.chdir(directory);
  process.env.DATABASE_PATH = 'templates-test.db';
  try {
    const owner = userDB.createWithAuthenticator(
      'template-owner', 'owner-handle', 'owner-credential', Buffer.from('key'), 0,
    );
    const other = userDB.createWithAuthenticator(
      'template-other', 'other-handle', 'other-credential', Buffer.from('key'), 0,
    );
    const subtasks = Array.from({ length: 100 }, (_, position) => ({
      title: `Checklist ${position}`, position,
    }));
    const input: CreateTemplateInput = {
      name: 'Weekly review', description: null, category: 'Work',
      title_template: 'Review', priority: 'high', is_recurring: true,
      recurrence_pattern: 'weekly', reminder_minutes: 15,
      due_date_offset_minutes: 60,
      subtasks_json: serializeTemplateSubtasks(subtasks),
    };
    const template = templateDB.create(owner.id, input);
    const duplicate = templateDB.create(owner.id, input);
    expect(duplicate.id).not.toBe(template.id);
    expect(templateDB.findAllByUser(owner.id)).toHaveLength(2);
    expect(templateDB.findAllByUser(other.id)).toEqual([]);
    expect(templateDB.findById(template.id, other.id)).toBeUndefined();
    expect(templateDB.update(template.id, other.id, { name: 'Stolen' })).toBeUndefined();
    expect(templateDB.delete(template.id, other.id)).toBe(false);
    expect(templateDB.use(template.id, other.id)).toBeUndefined();

    connection = new Database(path.join(directory, 'data', 'templates-test.db'));
    const persisted = connection.prepare(
      'SELECT subtasks_json, is_recurring FROM templates WHERE id = ?',
    ).get(template.id);
    expect(persisted).toEqual({ subtasks_json: input.subtasks_json, is_recurring: 1 });
    const now = new Date('2026-11-13T23:30:00+08:00');
    const todo = templateDB.use(template.id, owner.id, now)!;
    expect(todo.due_date).toBe('2026-11-13T16:30:00.000Z');
    expect(todo.is_recurring).toBe(true);
    expect(todo.reminder_minutes).toBe(15);
    expect(todo.tags).toEqual([]);
    expect(todo.subtasks?.map(({ title, position, completed }) => ({
      title, position, completed,
    }))).toEqual(subtasks.map((subtask) => ({ ...subtask, completed: false })));

    templateDB.update(template.id, owner.id, {
      name: 'Changed', category: null, subtasks_json: null,
    });
    expect(templateDB.findById(template.id, owner.id)?.category).toBeNull();
    expect(todoDB.findById(todo.id, owner.id)?.subtasks).toHaveLength(100);
    expect(templateDB.use(template.id, owner.id, now)?.subtasks).toEqual([]);
    expect(templateDB.delete(template.id, owner.id)).toBe(true);
    expect(templateDB.use(template.id, owner.id, now)).toBeUndefined();
    expect(todoDB.findById(todo.id, owner.id)?.subtasks).toHaveLength(100);

    const noDate = templateDB.create(owner.id, {
      ...input, is_recurring: false, recurrence_pattern: null,
      reminder_minutes: null, due_date_offset_minutes: null, subtasks_json: null,
    });
    expect(templateDB.use(noDate.id, owner.id, now)?.due_date).toBeNull();
    templateDB.update(noDate.id, owner.id, { due_date_offset_minutes: 0 });
    expect(templateDB.use(noDate.id, owner.id, now)?.due_date).toBe(now.toISOString());
    connection.prepare('UPDATE templates SET subtasks_json = ? WHERE id = ?')
      .run('{malformed', noDate.id);
    expect(templateDB.use(noDate.id, owner.id, now)?.subtasks).toEqual([]);
    templateDB.update(noDate.id, owner.id, { due_date_offset_minutes: null });
    templateDB.update(noDate.id, owner.id, { is_recurring: true });
    expect(() => templateDB.use(noDate.id, owner.id, now)).toThrow(/offset/);

    const failing = templateDB.create(owner.id, {
      ...input,
      subtasks_json: serializeTemplateSubtasks([
        { title: 'Insert first', position: 0 }, { title: 'Reject second', position: 1 },
      ]),
    });
    connection.exec(`
      CREATE TRIGGER reject_template_subtask BEFORE INSERT ON subtasks
      WHEN NEW.title = 'Reject second'
      BEGIN SELECT RAISE(ABORT, 'Injected subtask failure'); END;
    `);
    const before = todoDB.findAllByUser(owner.id).length;
    expect(() => templateDB.use(failing.id, owner.id, now)).toThrow(/Injected/);
    expect(todoDB.findAllByUser(owner.id)).toHaveLength(before);
    expect(connection.prepare(
      "SELECT count(*) AS count FROM subtasks WHERE title = 'Insert first'",
    ).get()).toEqual({ count: 0 });
  } finally {
    connection?.close();
    closeDatabase();
    process.chdir(previousDirectory);
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    rmSync(directory, { recursive: true, force: true });
  }
});
