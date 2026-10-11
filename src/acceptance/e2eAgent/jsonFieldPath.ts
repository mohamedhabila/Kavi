// ---------------------------------------------------------------------------
// Kavi — JSON field paths for structural E2E rubrics
// ---------------------------------------------------------------------------

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
