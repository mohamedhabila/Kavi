import {
  CONSOLIDATOR_CURRENT_FACT_CONTEXT_LIMIT,
  type ConsolidatorCurrentFactContext,
} from '../consolidator';
import { getEntitiesByIds, type MemoryEntity } from '../entities';
import { listFactsForRecallEligibleScan } from '../facts/queries';
import type { MemoryFact } from '../facts/types';
import { resolveLocalMemoryAccessScope } from '../memoryScopeStore';

const CURRENT_FACT_CONTEXT_SCAN_LIMIT = 32;

export interface LoadConsolidationCurrentFactContextInput {
  memoryConversationId: string;
  sourceThreadId: string;
  personaId: string;
  taskId: string | null;
  now: number;
}

function currentFactIdentity(fact: MemoryFact): string {
  return JSON.stringify([fact.subjectId, fact.predicate, fact.scope]);
}

/**
 * Remove ambiguous identities before they reach the provider. Replacement
 * admission independently resolves the exact target and remains authoritative.
 */
export function selectConsolidationCurrentFactContext(
  facts: ReadonlyArray<MemoryFact>,
  entities: ReadonlyArray<MemoryEntity>,
): ConsolidatorCurrentFactContext[] {
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const identityCounts = new Map<string, number>();
  for (const fact of facts) {
    const identity = currentFactIdentity(fact);
    identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
  }

  const context: ConsolidatorCurrentFactContext[] = [];
  for (const fact of facts) {
    if (context.length >= CONSOLIDATOR_CURRENT_FACT_CONTEXT_LIMIT) break;
    if (identityCounts.get(currentFactIdentity(fact)) !== 1) continue;
    const entity = entityById.get(fact.subjectId);
    if (!entity) continue;
    context.push({
      subjectRef:
        entity.type === 'self'
          ? { kind: 'self' }
          : { kind: 'named', label: entity.canonicalName.slice(0, 80) },
      predicate: fact.predicate.slice(0, 80),
      value: fact.objectText.slice(0, 200),
      scope: fact.scope,
    });
  }
  return context;
}

export function loadConsolidationCurrentFactContext(
  input: LoadConsolidationCurrentFactContextInput,
): ConsolidatorCurrentFactContext[] {
  const memoryScope = resolveLocalMemoryAccessScope(input);
  const facts = listFactsForRecallEligibleScan({
    recallScopeIdentity: {
      ...memoryScope,
      useIntent: 'automatic_prompt',
      candidateLane: 'direct_use',
    },
    asOf: input.now,
    memoryKind: 'semantic_fact',
    limit: CURRENT_FACT_CONTEXT_SCAN_LIMIT,
  });
  const entities = getEntitiesByIds(facts.map((fact) => fact.subjectId));
  return selectConsolidationCurrentFactContext(facts, entities);
}
