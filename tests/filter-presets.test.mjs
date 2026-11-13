import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deletePreset,
  loadPresets,
  savePreset,
} from '../lib/filter-presets.ts';

const filters = {
  search: 'meeting',
  priority: 'high',
  tagId: 7,
  completion: 'incomplete',
  dueDateFrom: '2026-11-01',
  dueDateTo: '2026-11-07',
};

function makePreset(id = 'preset-1') {
  return {
    id,
    name: 'Morning review',
    filters,
    createdAt: '2026-11-13T09:00:00.000Z',
  };
}

function makeStorage(initialValue = null, setItem = undefined) {
  let value = initialValue;
  return {
    getItem(key) {
      assert.equal(key, 'todo-app:filter-presets');
      return value;
    },
    setItem(key, nextValue) {
      assert.equal(key, 'todo-app:filter-presets');
      if (setItem) setItem(key, nextValue);
      value = nextValue;
    },
  };
}

test('presets round-trip through storage with every filter field intact', () => {
  const storage = makeStorage();
  const preset = makePreset();

  assert.deepEqual(savePreset(preset, storage), [preset]);
  assert.deepEqual(loadPresets(storage), [preset]);
});

test('presets remain isolated between browser storage instances', () => {
  const firstBrowser = makeStorage();
  const secondBrowser = makeStorage();

  savePreset(makePreset(), firstBrowser);

  assert.deepEqual(loadPresets(firstBrowser), [makePreset()]);
  assert.deepEqual(loadPresets(secondBrowser), []);
});

test('malformed JSON and invalid preset shapes recover as an empty list', () => {
  assert.deepEqual(loadPresets(makeStorage('{')), []);
  assert.deepEqual(loadPresets(makeStorage(JSON.stringify([{ id: 'bad' }]))), []);
});

test('deleting a preset persists and returns the remaining presets', () => {
  const storage = makeStorage(JSON.stringify([makePreset(), makePreset('preset-2')]));

  assert.deepEqual(deletePreset('preset-1', storage), [makePreset('preset-2')]);
  assert.deepEqual(loadPresets(storage), [makePreset('preset-2')]);
});

test('quota failures surface the required storage-full error', () => {
  const storage = makeStorage(null, () => {
    const error = new Error('quota exceeded');
    error.name = 'QuotaExceededError';
    throw error;
  });

  assert.throws(() => savePreset(makePreset(), storage), {
    message: 'Could not save preset — storage full',
  });
});

test('storage read and non-quota write failures are not hidden by save', () => {
  const readFailure = {
    getItem() {
      throw new Error('storage denied');
    },
    setItem() {
      assert.fail('must not overwrite storage after a failed read');
    },
  };
  assert.throws(() => savePreset(makePreset(), readFailure), /storage denied/);

  const writeFailure = makeStorage(null, () => {
    throw new Error('storage denied');
  });
  assert.throws(
    () => savePreset(makePreset(), writeFailure),
    (error) => error.cause?.message === 'storage denied',
  );
});
