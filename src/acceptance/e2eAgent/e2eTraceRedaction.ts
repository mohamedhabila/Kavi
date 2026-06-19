import { createHash } from 'crypto';

export type E2ERedactedHash = {
  hash: string;
  length: number;
};

export type E2ERedactedValuePreview = {
  fieldPath: string;
  type: string;
  hash: string;
  preview?: string | number | boolean | null;
};

export type E2ERedactedStructuralString = E2ERedactedHash & {
  preview?: string;
};

export type E2ERedactedEvidencePrefixCount = {
  prefix: string;
  count: number;
};

const HASH_PREFIX = 'sha256';

export const MAX_SAFE_PREVIEW_LENGTH = 160;

const SAFE_STRING_PREVIEW_FIELD_PATHS = new Set(['status', 'code', 'errorClass']);

export function stableHash(value: string): string {
  return `${HASH_PREFIX}:${createHash('sha256').update(value).digest('hex')}`;
}

export function hashString(value: string): E2ERedactedHash {
  return {
    hash: stableHash(value),
    length: value.length,
  };
}

export function redactStructuralString(value: string): E2ERedactedStructuralString {
  const trimmed = value.trim();
  return {
    ...hashString(trimmed),
    ...(trimmed.length <= MAX_SAFE_PREVIEW_LENGTH ? { preview: trimmed } : {}),
  };
}

export function stableStringify(value: unknown): string {
  if (value === undefined) {
    return '"__undefined__"';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

function buildSchemaShape(value: unknown, depth = 0): unknown {
  if (depth >= 4) {
    return valueType(value);
  }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      item: value.length > 0 ? buildSchemaShape(value[0], depth + 1) : 'empty',
    };
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return {
      type: 'object',
      keys: Object.keys(record)
        .sort()
        .map((key) => [key, buildSchemaShape(record[key], depth + 1)]),
    };
  }
  return valueType(value);
}

export function schemaDigest(value: unknown): string {
  return stableHash(stableStringify(buildSchemaShape(value)));
}

export function readFieldPath(value: unknown, fieldPath: string): unknown {
  if (!fieldPath.trim()) {
    return undefined;
  }

  let current = value;
  for (const segment of fieldPath.split('.')) {
    if (segment === 'length' && Array.isArray(current)) {
      current = current.length;
      continue;
    }
    const arrayIndex = Number(segment);
    if (
      Array.isArray(current) &&
      Number.isInteger(arrayIndex) &&
      arrayIndex >= 0 &&
      String(arrayIndex) === segment
    ) {
      current = current[arrayIndex];
      continue;
    }
    if (current && typeof current === 'object' && segment in current) {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

export function canPreviewStringField(fieldPath: string): boolean {
  const segments = fieldPath.split('.');
  const leafField = segments[segments.length - 1] ?? fieldPath;
  return SAFE_STRING_PREVIEW_FIELD_PATHS.has(leafField);
}

export function buildValuePreview(
  fieldPath: string,
  value: unknown,
  options?: { allowStringPreview?: boolean },
): E2ERedactedValuePreview | null {
  if (value === undefined) {
    return null;
  }
  const serialized = stableStringify(value);
  const type = valueType(value);
  const preview: E2ERedactedValuePreview = {
    fieldPath,
    type,
    hash: stableHash(serialized),
  };
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    (options?.allowStringPreview === true &&
      typeof value === 'string' &&
      value.length <= MAX_SAFE_PREVIEW_LENGTH)
  ) {
    preview.preview = value;
  }
  return preview;
}

export function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(
    new Set(
      Array.from(values)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export function tailItems<T>(values: ReadonlyArray<T> | undefined, limit: number): T[] {
  const source = values ?? [];
  return source.slice(Math.max(0, source.length - limit));
}
