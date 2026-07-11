import { getEntityById } from './entities';
import type { MemoryFact } from './facts/types';
import type { SerializedMemoryFact } from './memoryToolResultTypes';

export function serializeMemoryFact(fact: MemoryFact): SerializedMemoryFact {
  const subject = getEntityById(fact.subjectId)?.canonicalName ?? fact.subjectId;
  return {
    id: fact.id,
    subject,
    subjectId: fact.subjectId,
    predicate: fact.predicate,
    value: fact.objectText,
    confidence: fact.confidence,
    pinned: fact.pinned,
    validAt: fact.validAt,
    invalidAt: fact.invalidAt,
    createdAt: fact.createdAt,
    updatedAt: fact.updatedAt,
    deletedAt: fact.deletedAt,
    scope: fact.scope,
    personaId: fact.personaId,
    originConversationId: fact.originConversationId,
    originThreadId: fact.originThreadId,
    originTaskId: fact.originTaskId,
    sourceMessageId: fact.sourceMessageId,
    sourceTurnId: fact.sourceTurnId,
    sourceSummary: fact.sourceSummary,
    importance: fact.importance,
    accessCount: fact.accessCount,
    lastRecalledAt: fact.lastRecalledAt,
    lastAccessedAt: fact.lastAccessedAt,
    decayPolicy: fact.decayPolicy,
  };
}
