import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('holiday seed is repeatable and month queries include all adjacent grid days', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'todo-holiday-test-'));
  const dbUrl = new URL('../lib/db.ts', import.meta.url).href;
  const holidaysUrl = new URL('../lib/holidays.ts', import.meta.url).href;
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { holidayDB } from ${JSON.stringify(dbUrl)};
      import { SINGAPORE_HOLIDAYS } from ${JSON.stringify(holidaysUrl)};
      holidayDB.seed(SINGAPORE_HOLIDAYS);
      const original = holidayDB.findAll();
      holidayDB.seed(SINGAPORE_HOLIDAYS);
      assert.deepEqual(holidayDB.findAll(), original);
      holidayDB.seed([{date:'2027-01-09', name:'Test trailing holiday'}]);
      const december = holidayDB.findByMonth(2026, 12);
      assert.deepEqual(december.map(day => day.date), ['2026-12-25','2027-01-01','2027-01-09']);
      holidayDB.seed([{date:'2027-01-09', name:'Updated test holiday'}]);
      assert.equal(holidayDB.findAll().find(day => day.date === '2027-01-09').name, 'Updated test holiday');
      assert.equal(holidayDB.findAll().length, original.length + 1);
    `], { cwd: directory, stdio: 'pipe' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
