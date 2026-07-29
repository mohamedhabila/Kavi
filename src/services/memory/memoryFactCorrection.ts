import { replaceCurrentFactWithContribution } from './facts/exactReplacement';
import { RestrictedMemoryFactPersistenceError } from './facts/errors';
import { closedMemoryFactClass } from './facts/applicabilityProvenance';
import { getFactById } from './facts/queries';
import type { MemoryFact } from './facts/types';
import { serializeMemoryFact } from './memoryFactSerialization';
import type { SerializedMemoryFact } from './memoryToolResultTypes';
import { codeOwnedMemorySensitivityDeclaration } from './memorySensitivityPolicy';
import { canWriteLongTermMemory } from './policy';
import { ensureFactSchema } from './schema';
import { newId } from './schemaValues';

export const MAX_MANAGED_MEMORY_FACT_VALUE_LENGTH = 2_000;

export interface MemoryFactCorrectionArgs {
  factId: string;
  value: string;
}

export type MemoryFactCorrectionResult =
  | {
      ok: true;
      status: 'corrected' | 'unchanged';
      fact: SerializedMemoryFact;
      supersededFactId: string | null;
    }
  | {
      status: 'rejected' | 'failed_unknown';
      ok: false;
      code:
        | 'invalid_args'
        | 'not_found'
        | 'memory_disabled'
        | 'conflict'
        | 'restricted'
        | 'internal';
      error: string;
    };

function correctionError(
  code: Exclude<MemoryFactCorrectionResult, { ok: true }>['code'],
  error: string,
): MemoryFactCorrectionResult {
  return {
    status: code === 'internal' ? 'failed_unknown' : 'rejected',
    ok: false,
    code,
    error,
  };
}

function exactCorrectionArgs(args: MemoryFactCorrectionArgs): {
  factId: string;
  value: string;
} | null {
  if (
    !args ||
    typeof args !== 'object' ||
    Object.keys(args).some((key) => key !== 'factId' && key !== 'value')
  ) {
    return null;
  }
  const factId = typeof args.factId === 'string' ? args.factId.trim() : '';
  const value = typeof args.value === 'string' ? args.value.trim() : '';
  if (
    !factId ||
    factId.length > 64 ||
    !value ||
    value.length > MAX_MANAGED_MEMORY_FACT_VALUE_LENGTH
  ) {
    return null;
  }
  return { factId, value };
}

function replacementInput(fact: MemoryFact, value: string, eventId: string, now: number) {
  return {
    expectedCurrentFactId: fact.id,
    subjectId: fact.subjectId,
    predicate: fact.predicate,
    objectText: value,
    objectEntityId: value === fact.objectText ? fact.objectEntityId : null,
    attributes: fact.attributes,
    confidence: fact.confidence,
    sourceMessageId: null,
    sourceRunId: null,
    scope: fact.scope,
    originConversationId: fact.originConversationId,
    originThreadId: fact.originThreadId,
    originTaskId: fact.originTaskId,
    sourceTurnId: eventId,
    sourceSummary: null,
    importance: fact.importance,
    decayPolicy: fact.decayPolicy,
    expiresAt: fact.expiresAt,
    pinned: fact.pinned,
    sourceActorId: null,
    retrievability: fact.retrievability,
    stability: fact.stability,
    decayRate: fact.decayRate,
    reviewState: 'verified' as const,
    sensitivityFloor: fact.sensitivity,
    memoryKind: fact.memoryKind,
    now,
  };
}

function correctionContributionContext(fact: MemoryFact, eventId: string) {
  const memoryConversationId = fact.originConversationId ?? 'memory-management';
  return {
    memoryConversationId,
    sourceThreadId: fact.originThreadId ?? memoryConversationId,
    taskId: fact.scope === 'session' ? fact.originTaskId : null,
    producer: {
      producerId: 'memory_management_correction',
      producerEventId: eventId,
    },
    sourceAliases: [{ sourceKind: 'turn' as const, sourceId: eventId }],
  };
}

/** Explicit whole-vault UI correction; never expose this boundary to provider tool execution. */
export function correctMemoryFactForManagement(
  args: MemoryFactCorrectionArgs,
): MemoryFactCorrectionResult {
  const parsed = exactCorrectionArgs(args);
  if (!parsed) {
    return correctionError(
      'invalid_args',
      `factId and a value of at most ${MAX_MANAGED_MEMORY_FACT_VALUE_LENGTH} characters are required.`,
    );
  }
  if (!canWriteLongTermMemory()) {
    return correctionError('memory_disabled', 'Long-term memory is disabled.');
  }

  try {
    ensureFactSchema();
    const current = getFactById(parsed.factId);
    const now = Date.now();
    if (
      !current ||
      current.invalidAt !== null ||
      current.deletedAt !== null ||
      (current.expiresAt !== null && current.expiresAt <= now)
    ) {
      return correctionError('not_found', 'The remembered fact is no longer current.');
    }
    if (current.memoryKind !== 'semantic_fact') {
      return correctionError('invalid_args', 'Only remembered facts can be corrected.');
    }

    const eventId = newId('memory_correction');
    const result = replaceCurrentFactWithContribution(
      replacementInput(current, parsed.value, eventId, now),
      {
        factClass: closedMemoryFactClass(current.factClass) ?? 'unknown',
        sourceAuthority: 'grounded_user',
        ...(current.scope === 'persona' && current.personaId
          ? { personaId: current.personaId }
          : {}),
      },
      correctionContributionContext(current, eventId),
      codeOwnedMemorySensitivityDeclaration(current.sensitivity),
    );
    if (result.status === 'conflict') {
      return correctionError('conflict', 'The remembered fact changed before it could be saved.');
    }
    return {
      ok: true,
      status: result.status === 'duplicate' ? 'unchanged' : 'corrected',
      fact: serializeMemoryFact(result.fact),
      supersededFactId: result.superseded[0]?.id ?? null,
    };
  } catch (cause) {
    if (cause instanceof RestrictedMemoryFactPersistenceError) {
      return correctionError('restricted', 'This value cannot be stored in long-term memory.');
    }
    return correctionError('internal', 'Memory correction failed.');
  }
}
