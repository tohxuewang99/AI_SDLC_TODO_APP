import { SignJWT, jwtVerify } from 'jose';
import type { Session, User } from '@/lib/db';

export const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60;

function getSigningKey(secret: string): Uint8Array {
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes');
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(user: User, secret: string): Promise<string> {
  return new SignJWT({ userId: user.id, username: user.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSigningKey(secret));
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string | undefined,
): Promise<Session | null> {
  if (!token || !secret || new TextEncoder().encode(secret).byteLength < 32) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getSigningKey(secret), {
      algorithms: ['HS256'],
    });
    if (typeof payload.userId !== 'number' || typeof payload.username !== 'string') {
      return null;
    }
    return { userId: payload.userId, username: payload.username };
  } catch {
    return null;
  }
}
