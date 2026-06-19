export function normalizeMessageContent(value: unknown): string | any[] {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return '';
  }
  return String(value);
}

export function stringifyContentValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return '';
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
