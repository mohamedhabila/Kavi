const MEMORY_PROVENANCE_ID_PATTERN = /^[^\p{Z}\p{C}]{1,512}$/u;

/**
 * Provenance identifiers are opaque durable keys. Callers must never repair, trim, or
 * otherwise normalize them, because that changes which source they address.
 */
export function isExactMemoryProvenanceId(value: unknown): value is string {
  return typeof value === 'string' && MEMORY_PROVENANCE_ID_PATTERN.test(value);
}
