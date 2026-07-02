type JsonObject = Record<string, unknown>;

interface StringRef {
  get(): string;
  set(value: string): void;
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([key, entry]) => [key, cloneJsonValue(entry)]),
    );
  }
  return value;
}

function truncateString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, Math.max(0, maxChars));
  return `${value.slice(0, maxChars - 3)}...`;
}

function collectStringRefs(value: unknown, refs: StringRef[] = []): StringRef[] {
  if (Array.isArray(value)) {
    value.forEach((_, index) => {
      if (typeof value[index] === 'string') {
        refs.push({
          get: () => value[index] as string,
          set: (next) => {
            value[index] = next;
          },
        });
      } else {
        collectStringRefs(value[index], refs);
      }
    });
    return refs;
  }
  if (value && typeof value === 'object') {
    const record = value as JsonObject;
    for (const key of Object.keys(record)) {
      if (typeof record[key] === 'string') {
        refs.push({
          get: () => record[key] as string,
          set: (next) => {
            record[key] = next;
          },
        });
      } else {
        collectStringRefs(record[key], refs);
      }
    }
  }
  return refs;
}

function compactFallback(maxChars: number): string {
  const minimal = JSON.stringify({ truncated: true });
  if (minimal.length <= maxChars) return minimal;
  return '{}';
}

export function compactJson(value: unknown, maxChars: number): string {
  const limit = Math.max(2, Math.floor(maxChars));
  const compacted = cloneJsonValue(value);
  let serialized = JSON.stringify(compacted);
  if (serialized.length <= limit) return serialized;

  const refs = collectStringRefs(compacted);
  for (let attempt = 0; attempt < 128 && serialized.length > limit; attempt += 1) {
    refs.sort((left, right) => right.get().length - left.get().length);
    const ref = refs.find((entry) => entry.get().length > 0);
    if (!ref) break;
    const current = ref.get();
    const overage = serialized.length - limit;
    const shrinkBy = Math.max(overage + 16, Math.ceil(current.length * 0.25));
    const nextLength = Math.max(0, current.length - shrinkBy);
    ref.set(truncateString(current, nextLength));
    serialized = JSON.stringify(compacted);
  }

  return serialized.length <= limit ? serialized : compactFallback(limit);
}
