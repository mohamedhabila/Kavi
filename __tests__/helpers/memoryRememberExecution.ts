import type { MemoryRememberExecutionContext } from '../../src/services/memory/memoryTools';
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
  priorUserMessageId?: string;
  executionRunId?: string;
  toolCallId?: string;
  claimedAt?: number;
  personaId?: string;
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
      ...(input.priorUserMessageId ? { priorUserMessageId: input.priorUserMessageId } : {}),
    },
  };
}
