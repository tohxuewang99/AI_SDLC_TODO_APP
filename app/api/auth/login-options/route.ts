import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { NextResponse, type NextRequest } from 'next/server';
import { authenticatorDB, challengeStore, userDB } from '@/lib/db';
import {
  getWebAuthnConfig,
  normalizeUsername,
} from '@/lib/webauthn-config';
import {
  readJsonObject,
  reportServerError,
} from '@/lib/webauthn-validation';

const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const LOGIN_ERROR = 'Unable to start passkey login for that account.';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);
    const username = normalizeUsername(body?.username);
    if (!username) {
      return NextResponse.json({ error: LOGIN_ERROR }, { status: 400 });
    }

    const user = userDB.findByUsername(username);
    const authenticators = user ? authenticatorDB.findByUserId(user.id) : [];
    if (!user || authenticators.length === 0) {
      return NextResponse.json({ error: LOGIN_ERROR }, { status: 400 });
    }

    const { rpID } = getWebAuthnConfig();
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: authenticators.map((authenticator) => ({
        id: authenticator.credential_id,
      })),
    });
    challengeStore.save(
      user.username,
      'authentication',
      options.challenge,
      user.id,
      null,
      CHALLENGE_LIFETIME_MS,
    );
    return NextResponse.json(options);
  } catch (error) {
    return reportServerError('login-options', error);
  }
}
