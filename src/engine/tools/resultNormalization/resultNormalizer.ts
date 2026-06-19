import { truncateText } from './transformers';

export type JsonRecord = Record<string, unknown>;

export type NormalizeResultOptions = {
  jsonParse?: boolean;
  trim?: boolean;
  fallback?: string;
  transform?: (payload: JsonRecord, raw: string) => string;
};

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function limitArray<T>(items: T[], maxItems: number): { items: T[]; omitted: number } {
  if (items.length <= maxItems) {
    return { items, omitted: 0 };
  }

  return {
    items: items.slice(0, maxItems),
    omitted: items.length - maxItems,
  };
}

export function previewUnknown(value: unknown, maxChars: number): string {
  if (typeof value === 'string') {
    return truncateText(value, maxChars);
  }

  try {
    return truncateText(JSON.stringify(value), maxChars);
  } catch {
    return truncateText(String(value), maxChars);
  }
}

export function normalizeResult(rawResult: string, options: NormalizeResultOptions): string {
  const fallback = options.fallback ?? rawResult;
  const candidate = options.trim === false ? rawResult : rawResult.trim();

  if (!options.jsonParse) {
    return options.transform ? options.transform({ value: rawResult }, rawResult) : rawResult;
  }

  if (!candidate.startsWith('{') && !candidate.startsWith('[')) {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return fallback;
  }

  if (!isRecord(parsed)) {
    return fallback;
  }

  return options.transform ? options.transform(parsed, rawResult) : JSON.stringify(parsed);
}
