import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTagColor,
  normalizeTagName,
  parseTagId,
  parseTagRouteId,
} from '../lib/tag-validation.ts';

test('normalizes tag names and rejects missing or whitespace-only values', () => {
  assert.equal(normalizeTagName('  Work  '), 'Work');
  assert.equal(normalizeTagName('   '), null);
  assert.equal(normalizeTagName(null), null);
});

test('accepts only six-digit hex colors', () => {
  assert.equal(isTagColor('#3B82F6'), true);
  assert.equal(isTagColor('#aBcD09'), true);
  assert.equal(isTagColor('blue'), false);
  assert.equal(isTagColor('#fff'), false);
  assert.equal(isTagColor(null), false);
});

test('parses only positive safe integer tag IDs', () => {
  assert.equal(parseTagId(12), 12);
  assert.equal(parseTagId('12'), null);
  assert.equal(parseTagId(0), null);
  assert.equal(parseTagId(-1), null);
  assert.equal(parseTagId(1.5), null);
  assert.equal(parseTagId(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(parseTagRouteId('12'), 12);
  assert.equal(parseTagRouteId('01'), null);
  assert.equal(parseTagRouteId('1.5'), null);
});
