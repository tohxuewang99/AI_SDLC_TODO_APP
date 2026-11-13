import { cookies } from 'next/headers';
import type { User } from '@/lib/db';
import {
  createSessionToken,
  SESSION_DURATION_SECONDS,
  verifySessionToken,
} from '@/lib/session-token';

export const SESSION_COOKIE_NAME = 'todo_session';

export async function createSession(user: User): Promise<void> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is required to create a session');
  }

  const token = await createSessionToken(user, secret);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DURATION_SECONDS,
    expires: new Date(Date.now() + SESSION_DURATION_SECONDS * 1000),
  });
}

export async function getSession() {
  const cookieStore = await cookies();
  return verifySessionToken(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
    process.env.SESSION_SECRET,
  );
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
