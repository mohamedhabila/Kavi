const MEMORY_PROVENANCE_ID_PATTERN = /^[^\p{Z}\p{C}]{1,512}$/u;

/**
 * Provenance identifiers are opaque durable keys. Callers must never repair,
 * trim, or otherwise normalize them because that can change which source a
 * withdrawal or replay fence addresses.
 */
export function isExactMemoryProvenanceId(value: unknown): value is string {
  return typeof value === 'string' && MEMORY_PROVENANCE_ID_PATTERN.test(value);
}

export function requireExactMemoryProvenanceId(value: unknown, code: string): string {
  if (!isExactMemoryProvenanceId(value)) throw new Error(code);
  return value;
}
