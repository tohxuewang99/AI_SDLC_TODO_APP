import {
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { NextResponse, type NextRequest } from 'next/server';
import { authenticatorDB, challengeStore, userDB } from '@/lib/db';
import { createSession, getSession } from '@/lib/auth';
import {
  getWebAuthnConfig,
  normalizeUsername,
} from '@/lib/webauthn-config';
import {
  isRegistrationResponse,
  isSqliteConstraintError,
  readJsonObject,
  reportServerError,
} from '@/lib/webauthn-validation';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);
    const username = normalizeUsername(body?.username);
    if (!username || !isRegistrationResponse(body?.response)) {
      return NextResponse.json(
        { error: 'A valid username and passkey response are required.' },
        { status: 400 },
      );
    }

    const challenge = challengeStore.consume(username, 'registration');
    if (!challenge) {
      return NextResponse.json(
        { error: 'Registration challenge expired or was already used.' },
        { status: 401 },
      );
    }

    const { rpID, rpOrigin } = getWebAuthnConfig();
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: rpOrigin,
        expectedRPID: rpID,
      });
    } catch {
      return NextResponse.json({ error: 'Passkey verification failed.' }, { status: 401 });
    }

    if (!verification.verified) {
      return NextResponse.json({ error: 'Passkey verification failed.' }, { status: 401 });
    }

    const credential = verification.registrationInfo.credential;
    const credentialId = isoBase64URL.fromBuffer(
      isoBase64URL.toBuffer(credential.id),
    );
    const publicKey = Buffer.from(credential.publicKey);
    const counter = credential.counter ?? 0;
    let user;

    if (challenge.user_id !== null) {
      const session = await getSession();
      if (!session || session.userId !== challenge.user_id) {
        return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
      }
      user = userDB.findById(challenge.user_id);
      if (!user) {
        return NextResponse.json({ error: 'Account no longer exists.' }, { status: 401 });
      }
      if (user.webauthn_user_id !== challenge.user_handle) {
        return NextResponse.json(
          { error: 'Passkey registration challenge is invalid.' },
          { status: 401 },
        );
      }
      authenticatorDB.add(user.id, credentialId, publicKey, counter);
    } else {
      if (userDB.findByUsername(username)) {
        return NextResponse.json({ error: 'Username already taken.' }, { status: 409 });
      }
      if (!challenge.user_handle) {
        return NextResponse.json(
          { error: 'Passkey registration challenge is invalid.' },
          { status: 401 },
        );
      }
      user = userDB.createWithAuthenticator(
        username,
        challenge.user_handle,
        credentialId,
        publicKey,
        counter,
      );
    }

    await createSession(user);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isSqliteConstraintError(error)) {
      return NextResponse.json(
        { error: 'Username or passkey is already registered.' },
        { status: 409 },
      );
    }
    return reportServerError('register-verify', error);
  }
}
