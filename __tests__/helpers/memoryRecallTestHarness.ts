import { recallScoredFactsForQuery, type ScoredFact } from '../../src/services/memory/factRecall';
import type { RecallFactsOptions } from '../../src/services/memory/factRecallTypes';
import { recordFactWithApplicability } from '../../src/services/memory/facts/mutations';
import type { MemoryFactScope, RecordFactInput } from '../../src/services/memory/facts/types';
import { resolveLocalMemoryAccessScope } from '../../src/services/memory/memoryScopeStore';
import type { MemoryAccessScopeIdentity } from '../../src/services/memory/memoryScopeIdentity';

type RecallTestFactInput = Omit<RecordFactInput, 'scope'> & { scope?: MemoryFactScope };
type RecallTestOptions = Omit<RecallFactsOptions, 'memoryScope' | 'useIntent'>;
type RecallTestScope = Partial<Omit<MemoryAccessScopeIdentity, 'memoryOwnerId'>>;

export function recordRecallTestFact(input: RecallTestFactInput) {
  return recordFactWithApplicability(
    { ...input, scope: input.scope ?? 'global' },
    { factClass: 'workflow', sourceAuthority: 'tool_observed' },
  );
}

export function recallScoredTestFacts(
  query: string,
  options: RecallTestOptions = {},
  scopeOverride: RecallTestScope = {},
): Promise<ScoredFact[]> {
  const memoryConversationId = scopeOverride.memoryConversationId ?? 'recall-test-root';
  return recallScoredFactsForQuery(query, {
    ...options,
    memoryScope: resolveLocalMemoryAccessScope({
      memoryConversationId,
      sourceThreadId: scopeOverride.sourceThreadId ?? memoryConversationId,
      personaId: scopeOverride.personaId ?? 'default',
      taskId: scopeOverride.taskId ?? null,
    }),
    useIntent: 'automatic_prompt',
  });
}
