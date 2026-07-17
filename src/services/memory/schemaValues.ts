let idCounter = 0;

export function newId(prefix: string): string {
  idCounter = (idCounter + 1) >>> 0;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.floor(
    Math.random() * 0xffff,
  ).toString(36)}`;
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function safeParseArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function safeParseObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Escape SQL `LIKE` wildcards for use as a JSON-substring prefilter. */
export function jsonLikeEscape(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&').replace(/"/g, '\\"');
}
