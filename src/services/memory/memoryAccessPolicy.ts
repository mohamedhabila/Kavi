export const MEMORY_RETRIEVAL_STRATEGIES = ['production', 'lexical_only'] as const;
export type MemoryRetrievalStrategy = (typeof MEMORY_RETRIEVAL_STRATEGIES)[number];

export const MEMORY_CONTEXT_STRATEGIES = ['production', 'full_context'] as const;
export type MemoryContextStrategy = (typeof MEMORY_CONTEXT_STRATEGIES)[number];

export function resolveMemoryRetrievalStrategy(value: unknown): MemoryRetrievalStrategy {
  if (value === undefined || value === 'production') return 'production';
  if (value === 'lexical_only') return value;
  throw new Error('Unsupported memory retrieval strategy.');
}

export function resolveMemoryContextStrategy(value: unknown): MemoryContextStrategy {
  if (value === undefined || value === 'production') return 'production';
  if (value === 'full_context') return value;
  throw new Error('Unsupported memory context strategy.');
}
