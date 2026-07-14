import type {
  MemoryRememberArgs,
  MemoryRememberExecutionContext,
} from '../../src/services/memory/memoryTools';
import type { MemoryRememberSemanticEvidenceV2Input } from '../../src/services/memory/memoryRememberSemanticEvidence';
import type {
  SemanticFactAssertionClass,
  SemanticFactProposalOperation,
  SemanticFactProposalScope,
  SemanticFactSubjectRef,
} from '../../src/services/memory/semanticFactProposal';
import { sha256HexUtf8 } from '../../src/utils/sha256';

// Fixed, past test clock: deterministic authority without creating future-dated
// facts that production retrieval correctly treats as not yet valid.
const DEFAULT_MEMORY_REMEMBER_CLAIMED_AT = 1_780_000_000_000;

export function memoryRememberExecution(input: {
  memoryConversationId?: string;
  sourceThreadId?: string;
  taskId?: string | null;
  userMessageId: string;
  userMessageText: string;
  executionRunId?: string;
  toolCallId?: string;
  claimedAt?: number;
  personaId?: string;
  sourceRunId?: string | null;
}): MemoryRememberExecutionContext {
  const digest = sha256HexUtf8(
    JSON.stringify([
      'test-memory-remember-execution-v1',
      input.userMessageId,
      input.executionRunId ?? '',
      input.toolCallId ?? '',
    ]),
  );
  return {
    ...(input.personaId ? { personaId: input.personaId } : {}),
    sourceRunId: input.sourceRunId ?? null,
    executionClaim: Object.freeze({
      executionRunId: input.executionRunId ?? `test-memory-execution-${digest}`,
      toolCallId: input.toolCallId ?? `test-memory-tool-call-${digest}`,
      claimedAt: input.claimedAt ?? DEFAULT_MEMORY_REMEMBER_CLAIMED_AT,
    }),
    requestEvidence: {
      memoryConversationId: input.memoryConversationId ?? 'conversation-request',
      sourceThreadId: input.sourceThreadId ?? 'thread-request',
      taskId: input.taskId ?? null,
      userMessageId: input.userMessageId,
      userMessageText: input.userMessageText,
    },
  };
}

export function memoryRememberArgs(input: {
  userMessageText: string;
  subjectRef: SemanticFactSubjectRef;
  subjectType?: 'self' | 'person' | 'place' | 'org' | 'project' | 'thing' | 'concept' | 'event';
  predicate: string;
  value: string;
  scope?: SemanticFactProposalScope;
  operation?: SemanticFactProposalOperation;
  assertionClass?: SemanticFactAssertionClass;
  evidenceQuote?: string;
  importance?: number;
  confidence?: number;
  sensitivity?: 'normal' | 'personal' | 'sensitive' | 'restricted';
  pinned?: boolean;
}): MemoryRememberArgs {
  const evidenceQuote = input.evidenceQuote ?? input.userMessageText;
  const semanticEvidence: MemoryRememberSemanticEvidenceV2Input = {
    version: 2,
    subject_ref:
      input.subjectRef.kind === 'self'
        ? { kind: 'self' }
        : { kind: 'named', label: input.subjectRef.label },
    subject_type: input.subjectType ?? (input.subjectRef.kind === 'self' ? 'self' : 'concept'),
    predicate: input.predicate,
    value: input.value,
    scope: input.scope ?? 'global',
    importance: input.importance ?? 0.5,
    confidence: input.confidence ?? 0.9,
    operation: input.operation ?? 'record',
    assertion_class: input.assertionClass ?? 'current_direct',
    evidence_quote: evidenceQuote,
    sensitivity: input.sensitivity ?? 'normal',
  };
  return {
    semanticEvidence,
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
  };
}
