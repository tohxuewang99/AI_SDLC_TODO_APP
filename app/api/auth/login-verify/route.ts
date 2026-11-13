import {
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { NextResponse, type NextRequest } from 'next/server';
import { authenticatorDB, challengeStore, userDB } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { isAuthenticatorCounterValid } from '@/lib/auth-logic';
import {
  getWebAuthnConfig,
  normalizeUsername,
} from '@/lib/webauthn-config';
import {
  isAuthenticationResponse,
  readJsonObject,
  reportServerError,
} from '@/lib/webauthn-validation';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);
    const username = normalizeUsername(body?.username);
    if (!username || !isAuthenticationResponse(body?.response)) {
      return NextResponse.json(
        { error: 'A valid username and passkey response are required.' },
        { status: 400 },
      );
    }

    const challenge = challengeStore.consume(username, 'authentication');
    const user = userDB.findByUsername(username);
    if (!challenge || !user || challenge.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Passkey verification failed.' },
        { status: 401 },
      );
    }

    const credentialId = isoBase64URL.fromBuffer(
      isoBase64URL.toBuffer(body.response.id),
    );
    const authenticator = authenticatorDB.findByCredentialId(credentialId);
    if (!authenticator || authenticator.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Authenticator not recognized.' },
        { status: 401 },
      );
    }

    const { rpID, rpOrigin } = getWebAuthnConfig();
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: rpOrigin,
        expectedRPID: rpID,
        credential: {
          id: authenticator.credential_id,
          publicKey: new Uint8Array(authenticator.credential_public_key),
          counter: authenticator.counter ?? 0,
        },
      });
    } catch {
      return NextResponse.json(
        { error: 'Passkey verification failed.' },
        { status: 401 },
      );
    }

    const previousCounter = authenticator.counter ?? 0;
    const newCounter = verification.authenticationInfo.newCounter ?? 0;
    if (
      !verification.verified ||
      !isAuthenticatorCounterValid(previousCounter, newCounter)
    ) {
      return NextResponse.json(
        { error: 'Passkey verification failed.' },
        { status: 401 },
      );
    }

    if (!authenticatorDB.updateCounterIfUnchanged(
      authenticator.id,
      previousCounter,
      newCounter,
    )) {
      return NextResponse.json(
        { error: 'Passkey verification failed.' },
        { status: 401 },
      );
    }

    await createSession(user);
    return NextResponse.json({ success: true });
  } catch (error) {
    return reportServerError('login-verify', error);
  }
}
