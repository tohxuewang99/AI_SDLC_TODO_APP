export function isAuthenticatorCounterValid(
  storedCounter: number | null | undefined,
  newCounter: number | null | undefined,
): boolean {
  const stored = storedCounter ?? 0;
  const next = newCounter ?? 0;
  return (stored === 0 && next === 0) || next > stored;
}
