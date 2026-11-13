export interface WebAuthnConfig {
  rpName: string;
  rpID: string;
  rpOrigin: string;
}

export function getWebAuthnConfig(): WebAuthnConfig {
  const { RP_NAME, RP_ID, RP_ORIGIN } = process.env;
  if (!RP_NAME?.trim() || !RP_ID?.trim() || !RP_ORIGIN?.trim()) {
    throw new Error('RP_NAME, RP_ID, and RP_ORIGIN must be configured');
  }
  return {
    rpName: RP_NAME.trim(),
    rpID: RP_ID.trim(),
    rpOrigin: RP_ORIGIN.trim(),
  };
}

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const username = value.trim();
  if (
    username.length < 1 ||
    username.length > 64 ||
    /[\u0000-\u001f\u007f]/.test(username)
  ) {
    return null;
  }
  return username;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
