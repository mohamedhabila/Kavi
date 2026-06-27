export function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasCompactValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

export function compactJsonFields(
  value: Record<string, unknown>,
  fields: ReadonlyArray<string>,
): string {
  const compact: Record<string, unknown> = {};
  for (const field of fields) {
    const entry = value[field];
    if (hasCompactValue(entry)) compact[field] = entry;
  }
  return JSON.stringify(Object.keys(compact).length > 0 ? compact : value);
}

export function collectJsonStrings(
  value: unknown,
  output: string[],
  depth = 0,
  maxDepth = 4,
): void {
  if (depth > maxDepth) return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) output.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectJsonStrings(entry, output, depth + 1, maxDepth);
    return;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectJsonStrings(entry, output, depth + 1, maxDepth);
    }
  }
}
