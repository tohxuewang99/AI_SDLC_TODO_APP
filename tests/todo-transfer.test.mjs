import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { todoExportSchema, toCsv, toExportItem } from '../lib/todo-transfer.ts';
import { formatSingaporeDate } from '../lib/timezone.ts';

const todo = {
  id: 21, user_id: 3, title: 'Milk, "bread"\nand eggs', completed: true,
  due_date: '2020-01-01T00:30:00+08:00', priority: 'high', is_recurring: true,
  recurrence_pattern: 'daily', reminder_minutes: 15, last_notification_sent: null,
  created_at: '2020-01-01T00:00:00.000Z', updated_at: null,
  subtasks: [{ id: 4, todo_id: 21, title: 'First', completed: true, position: 4, created_at: '2020-01-01' }],
  tags: [{ id: 6, user_id: 3, name: 'Work', color: '#123456', created_at: '2020-01-01' }],
};

test('JSON schema validates the full backup and excludes database identifiers', () => {
  const item = toExportItem(todo);
  const payload = { version: 1, exported_at: '2020-01-01T00:00:00+08:00', todos: [item] };
  assert.equal(todoExportSchema.safeParse(payload).success, true);
  assert.equal('id' in item, false);
  assert.equal('id' in item.subtasks[0], false);
  assert.equal('id' in item.tags[0], false);
  assert.equal(todoExportSchema.safeParse({ ...payload, todos: [] }).success, true);
  for (const invalid of [
    { ...payload, version: 2 },
    { ...payload, todos: [{ ...item, priority: 'urgent' }] },
    { ...payload, todos: [{ ...item, reminder_minutes: 17 }] },
    { ...payload, todos: [{ ...item, recurrence_pattern: null }] },
    { ...payload, todos: [{ ...item, due_date: null }] },
    { ...payload, todos: [{ ...item, due_date: 'not a date' }] },
    { ...payload, todos: [{ ...item, subtasks: undefined }] },
  ]) assert.equal(todoExportSchema.safeParse(invalid).success, false);
});

test('CSV escapes special characters and filename date uses Singapore time', () => {
  assert.equal(
    toCsv([todo]),
    'ID,Title,Completed,Due Date,Priority,Recurring,Pattern,Reminder\r\n'
      + '21,"Milk, ""bread""\nand eggs",true,2020-01-01T00:30:00+08:00,high,true,daily,15\r\n',
  );
  assert.equal(formatSingaporeDate(new Date('2026-03-31T16:01:00Z'), 'yyyy-MM-dd'), '2026-04-01');
});

test('import remaps relationships, reuses names, scales, and rolls back on database failure', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'todo-transfer-'));
  const dbUrl = new URL('../lib/db.ts', import.meta.url).href;
  const databaseUrl = import.meta.resolve('better-sqlite3');
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import Database from ${JSON.stringify(databaseUrl)};
      import { todoDB, tagDB, userDB } from ${JSON.stringify(dbUrl)};
      const owner = userDB.createWithAuthenticator('owner', 'owner-handle', 'owner-credential', Buffer.from('a'), 0);
      const other = userDB.createWithAuthenticator('other', 'other-handle', 'other-credential', Buffer.from('b'), 0);
      const existing = tagDB.create(owner.id, 'Work', '#123456');
      tagDB.create(other.id, 'New', '#FF0000');
      const item = ${JSON.stringify(toExportItem(todo))};
      item.tags = [{name:'work',color:'#FFFFFF'}, {name:'New',color:'#00FF00'}];
      item.subtasks.push({title:'Second', completed:false, position:4});
      assert.deepEqual(todoDB.importAll(owner.id, [item]), {imported:1,tagsCreated:1,tagsReused:1});
      const imported = todoDB.findAllByUser(owner.id)[0];
      assert.notEqual(imported.id, ${todo.id});
      assert.deepEqual(imported.subtasks.map(s => [s.title,s.completed,s.position]), [['First',true,0],['Second',false,1]]);
      assert.deepEqual(imported.tags.map(t => [t.name,t.color]), [['New','#00FF00'],['Work','#123456']]);
      assert.equal(imported.tags.find(t => t.name === 'Work').id, existing.id);
      assert.equal(imported.subtasks[0].todo_id, imported.id);
      assert.equal(imported.due_date, item.due_date);
      assert.deepEqual(todoDB.importAll(owner.id, [item]), {imported:1,tagsCreated:0,tagsReused:2});
      assert.equal(todoDB.findAllByUser(owner.id).length, 2);
      assert.equal(todoDB.findAllByUser(other.id).length, 0);
      const raw = new Database('data/todos.db');
      raw.exec("CREATE TRIGGER reject_test BEFORE INSERT ON todos WHEN NEW.title = 'FAIL-TRANSACTION' BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
      raw.close();
      assert.throws(() => todoDB.importAll(owner.id, [
        {...item, tags:[{name:'Rollback',color:'#FFFFFF'}]},
        {...item, title:'FAIL-TRANSACTION'},
      ]));
      assert.equal(todoDB.findAllByUser(owner.id).length, 2);
      assert.equal(tagDB.findAllByUser(owner.id).some(t => t.name === 'Rollback'), false);
      const start = performance.now();
      assert.equal(todoDB.importAll(owner.id, Array.from({length:500}, () => item)).imported, 500);
      assert.ok(performance.now() - start < 5000, '500 todo import exceeded 5 seconds');
    `], { cwd: directory, stdio: 'pipe' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
