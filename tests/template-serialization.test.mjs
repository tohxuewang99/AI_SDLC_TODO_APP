import assert from 'node:assert/strict';
import test from 'node:test';
import { mock } from 'node:test';
import {
  parseTemplateSubtasks,
  serializeTemplateSubtasks,
} from '../lib/template-serialization.ts';

test('template snapshots preserve titles and list order without instance state', () => {
  const subtasks = Array.from({ length: 100 }, (_, position) => ({
    title: `Checklist ${position} "quoted" \n \u65e5`,
    position,
    completed: true,
    id: position + 1,
  }));
  const json = serializeTemplateSubtasks(subtasks);
  assert.deepEqual(parseTemplateSubtasks(json), subtasks.map(({ title, position }) => ({
    title, position,
  })));
  assert.deepEqual(parseTemplateSubtasks(serializeTemplateSubtasks([
    { title: 'First', position: 99 }, { title: 'Second', position: 3 },
  ])), [{ title: 'First', position: 0 }, { title: 'Second', position: 1 }]);
  assert.equal(serializeTemplateSubtasks([]), null);
  assert.deepEqual(parseTemplateSubtasks(null), []);
});

test('corrupt JSON and invalid snapshot shapes recover with a diagnostic', () => {
  const warning = mock.method(console, 'warn', () => {});
  try {
    for (const json of [
      '{broken', 'null', '{}', 'true', '[null]',
      '[{"title":"Missing position"}]',
      '[{"title":"Bad position","position":-1}]',
      '[{"title":" ","position":0}]',
    ]) {
      assert.deepEqual(parseTemplateSubtasks(json), []);
    }
    assert.equal(warning.mock.callCount(), 8);
  } finally {
    warning.mock.restore();
  }
});
