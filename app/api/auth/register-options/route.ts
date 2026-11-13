import {
  generateRegistrationOptions,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { authenticatorDB, challengeStore, userDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  getWebAuthnConfig,
  normalizeUsername,
} from '@/lib/webauthn-config';
import {
  readJsonObject,
  reportServerError,
} from '@/lib/webauthn-validation';

const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);
    const username = normalizeUsername(body?.username);
    if (!username) {
      return NextResponse.json({ error: 'Enter a valid username.' }, { status: 400 });
    }

    const existingUser = userDB.findByUsername(username);
    let userId: number | null = null;
    let userHandle: string;
    if (existingUser) {
      const session = await getSession();
      if (!session || session.userId !== existingUser.id) {
        return NextResponse.json(
          { error: 'Username already taken.' },
          { status: 409 },
        );
      }
      userId = existingUser.id;
      userHandle = existingUser.webauthn_user_id;
    } else {
      userHandle = isoBase64URL.fromBuffer(randomBytes(32));
    }

    const { rpName, rpID } = getWebAuthnConfig();
    const registeredAuthenticators = userId === null
      ? []
      : authenticatorDB.findByUserId(userId);
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: username,
      userID: isoBase64URL.toBuffer(userHandle),
      attestationType: 'none',
      excludeCredentials: registeredAuthenticators.map((authenticator) => ({
        id: authenticator.credential_id,
      })),
    });

    challengeStore.save(
      username,
      'registration',
      options.challenge,
      userId,
      userHandle,
      CHALLENGE_LIFETIME_MS,
    );
    return NextResponse.json(options);
  } catch (error) {
    return reportServerError('register-options', error);
  }
}
