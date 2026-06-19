export function isPlainRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function safeJsonParse(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value ?? {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

export function tryParseJson(value: unknown): unknown | undefined {
  if (typeof value !== 'string') {
    return value === undefined ? undefined : value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
