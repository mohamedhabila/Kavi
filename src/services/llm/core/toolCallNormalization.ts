export function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function stableJsonishKey(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return String(value);
  }
}

export function stableToolCallKey(args: {
  id?: unknown;
  name?: unknown;
  input?: unknown;
  idPrefix?: string;
}): string {
  const id = readTrimmedString(args.id);
  if (id) {
    return `${args.idPrefix ?? 'id'}:${id}`;
  }

  const name = typeof args.name === 'string' ? args.name : '';
  return `${name}::${stableJsonishKey(args.input)}`;
}

export function dedupeByStableKey<T>(
  items: ReadonlyArray<T>,
  getKey: (item: T) => string | undefined,
  shouldReplace?: (existing: T, incoming: T) => boolean,
): T[] {
  const deduped: T[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    const key = getKey(item);
    if (!key) {
      deduped.push(item);
      continue;
    }

    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, deduped.length);
      deduped.push(item);
      continue;
    }

    if (shouldReplace?.(deduped[existingIndex], item)) {
      deduped[existingIndex] = item;
    }
  }

  return deduped;
}

export function collectIds<T>(
  items: Iterable<T>,
  readId: (item: T) => string | undefined,
): Set<string> {
  const ids = new Set<string>();

  for (const item of items) {
    const id = readId(item);
    if (id) {
      ids.add(id);
    }
  }

  return ids;
}

export function allIdsPresent(required: ReadonlySet<string>, actual: ReadonlySet<string>): boolean {
  return Array.from(required).every((id) => actual.has(id));
}
