const DURABLE_SCOPE_ID_PATTERN = /^[^\p{Z}\p{C}]{1,160}$/u;

/** Durable ownership keys are opaque. Normalizing them can cross an authority boundary. */
export function isExactDurableScopeId(value: unknown): value is string {
  return typeof value === 'string' && DURABLE_SCOPE_ID_PATTERN.test(value);
}

export function requireExactDurableScopeId(value: unknown, code: string): string {
  if (!isExactDurableScopeId(value)) throw new Error(code);
  return value;
}
