export function sanitizeNonNegativeNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function truncateText(value: string | undefined, maxChars: number): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function normalizeText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function keepAnchoredTail<T>(items: T[] | undefined, maxItems: number): T[] | undefined {
  if (!items?.length) {
    return undefined;
  }

  if (items.length <= maxItems) {
    return [...items];
  }

  return [items[0], ...items.slice(-(maxItems - 1))];
}

export function isPlainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function clonePlainRecord(value: unknown): Record<string, any> | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value)) as Record<string, any>;
}

export function clonePlainRecordArray(value: unknown): Record<string, any>[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sanitized = value
    .filter((entry): entry is Record<string, any> => isPlainRecord(entry))
    .map((entry) => clonePlainRecord(entry) as Record<string, any>);

  return sanitized.length > 0 ? sanitized : undefined;
}
