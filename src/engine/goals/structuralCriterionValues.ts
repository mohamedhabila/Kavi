function readJsonFieldAtPathSegments(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.').filter(Boolean)) {
    if (current == null) {
      return undefined;
    }
    if (Array.isArray(current)) {
      if (segment === 'length') {
        return current.length;
      }
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function readJsonFieldAtPath(value: unknown, path: string): unknown {
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    return undefined;
  }

  const direct = readJsonFieldAtPathSegments(value, normalizedPath);
  if (direct !== undefined) {
    return direct;
  }

  if (Array.isArray(value) && value.length > 0 && !/^\d+(\.|$)/.test(normalizedPath)) {
    return readJsonFieldAtPathSegments(value, `0.${normalizedPath}`);
  }

  return undefined;
}

export function structuralValuesMatch(actual: unknown, expected: string): boolean {
  if (typeof actual === 'boolean') {
    return String(actual) === expected;
  }
  if (typeof actual === 'number') {
    return String(actual) === expected;
  }
  return String(actual ?? '') === expected;
}

export function extractJsonPayloadFromEvidenceEntry(entry: string): unknown | undefined {
  const colonIndex = entry.indexOf(':');
  if (colonIndex < 0) {
    return undefined;
  }
  const payload = entry.slice(colonIndex + 1).trim();
  if (!payload.startsWith('{') && !payload.startsWith('[')) {
    return undefined;
  }
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}