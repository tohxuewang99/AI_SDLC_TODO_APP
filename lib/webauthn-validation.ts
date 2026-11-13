import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isRecord } from '@/lib/webauthn-config';

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

export function isRegistrationResponse(
  value: unknown,
): value is RegistrationResponseJSON {
  if (!isRecord(value) || !isRecord(value.response)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.rawId === 'string' &&
    value.id === value.rawId &&
    value.type === 'public-key' &&
    typeof value.response.clientDataJSON === 'string' &&
    typeof value.response.attestationObject === 'string'
  );
}

export function isAuthenticationResponse(
  value: unknown,
): value is AuthenticationResponseJSON {
  if (!isRecord(value) || !isRecord(value.response)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.rawId === 'string' &&
    value.id === value.rawId &&
    value.type === 'public-key' &&
    typeof value.response.clientDataJSON === 'string' &&
    typeof value.response.authenticatorData === 'string' &&
    typeof value.response.signature === 'string'
  );
}

export function reportServerError(context: string, error: unknown): Response {
  console.error(`[${context}]`, error);
  return Response.json({ error: 'Internal server error' }, { status: 500 });
}

export function isSqliteConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_CONSTRAINT')
  );
}
