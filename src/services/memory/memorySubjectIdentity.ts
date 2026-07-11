export const CANONICAL_SELF_MEMORY_SUBJECT = 'user' as const;

export function normalizeMemorySubject(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

/**
 * Collapse every normalized case variant of the code-owned self label to one
 * identity before classification, resolution, or persistence.
 */
export function canonicalizeMemorySubject(value: string): string {
  const normalized = normalizeMemorySubject(value);
  return normalized.toLocaleLowerCase() === CANONICAL_SELF_MEMORY_SUBJECT
    ? CANONICAL_SELF_MEMORY_SUBJECT
    : normalized;
}

export function isCanonicalSelfMemorySubject(value: string): boolean {
  return value === CANONICAL_SELF_MEMORY_SUBJECT;
}
