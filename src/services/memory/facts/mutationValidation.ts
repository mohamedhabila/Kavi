import { isMemoryFactScope, type MemoryFactScope } from './types';

export function requireFactMutationTimestamp(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(code);
  return value as number;
}

export function requireFactMutationScope(value: unknown): MemoryFactScope {
  if (!isMemoryFactScope(value)) throw new Error('memory_fact_scope_invalid');
  return value;
}
