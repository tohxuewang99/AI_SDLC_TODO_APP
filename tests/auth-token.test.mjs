import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT } from 'jose';
import { isAuthenticatorCounterValid } from '../lib/auth-logic.ts';
import {
  createSessionToken,
  verifySessionToken,
} from '../lib/session-token.ts';

const secret = 'unit-test-session-secret-with-more-than-32-bytes';
const user = {
  id: 17,
  username: 'test-user',
  created_at: '2026-01-01 00:00:00',
};

test('session tokens round-trip with a seven-day expiry', async () => {
  const token = await createSessionToken(user, secret);
  const session = await verifySessionToken(token, secret);
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  );

  assert.deepEqual(session, { userId: user.id, username: user.username });
  assert.equal(payload.exp - payload.iat, 7 * 24 * 60 * 60);
});

test('tampered session tokens fail closed', async () => {
  const token = await createSessionToken(user, secret);
  const signature = token.split('.').at(-1);
  const tampered = `${token.slice(0, -signature.length)}${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;

  assert.equal(await verifySessionToken(tampered, secret), null);
});

test('expired session tokens fail closed', async () => {
  const token = await new SignJWT({ userId: user.id, username: user.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
    .sign(new TextEncoder().encode(secret));

  assert.equal(await verifySessionToken(token, secret), null);
});

test('authenticator counters reject stale values but allow authenticators that report zero', () => {
  assert.equal(isAuthenticatorCounterValid(0, 0), true);
  assert.equal(isAuthenticatorCounterValid(4, 5), true);
  assert.equal(isAuthenticatorCounterValid(4, 4), false);
  assert.equal(isAuthenticatorCounterValid(4, 3), false);
});
