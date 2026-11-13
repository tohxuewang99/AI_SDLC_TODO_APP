export function parseSubtaskId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function normalizeSubtaskTitle(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const title = value.trim();
  return title.length > 0 ? title : null;
}
