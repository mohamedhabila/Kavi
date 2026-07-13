import type { Conversation, SemanticMemoryHandoff } from '../../types/conversation';
import { isExactDurableScopeId } from '../../utils/durableScopeIdentity';
import { findLastClosedTurn } from './closedTurn';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { canWriteLongTermMemory } from './policy';

export const SEMANTIC_MEMORY_HANDOFF_VERSION = 1 as const;

export function normalizeSemanticMemoryHandoff(value: unknown): SemanticMemoryHandoff | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Partial<SemanticMemoryHandoff>;
  if (
    candidate.version !== SEMANTIC_MEMORY_HANDOFF_VERSION ||
    !isExactDurableScopeId(candidate.memoryConversationId) ||
    !isExactDurableScopeId(candidate.sourceThreadId) ||
    !isExactMemoryProvenanceId(candidate.sourceEndMessageId)
  ) {
    return undefined;
  }
  return {
    version: SEMANTIC_MEMORY_HANDOFF_VERSION,
    memoryConversationId: candidate.memoryConversationId,
    sourceThreadId: candidate.sourceThreadId,
    sourceEndMessageId: candidate.sourceEndMessageId,
  };
}

export function semanticMemoryHandoffsEqual(
  left: SemanticMemoryHandoff | undefined,
  right: SemanticMemoryHandoff,
): boolean {
  return (
    left?.version === right.version &&
    left.memoryConversationId === right.memoryConversationId &&
    left.sourceThreadId === right.sourceThreadId &&
    left.sourceEndMessageId === right.sourceEndMessageId
  );
}

/**
 * Capture one conversation boundary using its exact workspace and producing-thread identities.
 * Persona changes deliberately retain this barrier because global facts cross personas, while
 * persona-scoped facts remain protected by the normal recall access policy.
 */
export function captureSemanticMemoryHandoff(
  conversation: Conversation | undefined,
): SemanticMemoryHandoff | undefined {
  if (!canWriteLongTermMemory() || !conversation || !isExactDurableScopeId(conversation.id)) {
    return undefined;
  }
  const pendingHandoff = normalizeSemanticMemoryHandoff(conversation.semanticMemoryHandoff);
  if (pendingHandoff) return pendingHandoff;

  const memoryConversationId = conversation.isSideThread
    ? conversation.parentConversationId
    : conversation.id;
  if (!isExactDurableScopeId(memoryConversationId)) return undefined;

  const ownedAssistantMessageId = conversation.modelProjectionOwner?.assistantMessageId;
  const ownedAssistant = ownedAssistantMessageId
    ? (conversation.messages ?? []).find((message) => message.id === ownedAssistantMessageId)
    : undefined;
  const ownerMessageIsExplicitlyClosed =
    ownedAssistant?.role === 'assistant' &&
    ownedAssistant.assistantMetadata?.kind === 'final' &&
    ownedAssistant.assistantMetadata.completionStatus === 'complete';
  const closedTurnMessages =
    ownedAssistantMessageId && !ownerMessageIsExplicitlyClosed
      ? (conversation.messages ?? []).filter((message) => message.id !== ownedAssistantMessageId)
      : (conversation.messages ?? []);
  const assistant = findLastClosedTurn(closedTurnMessages).assistant;
  if (assistant && isExactMemoryProvenanceId(assistant.id)) {
    return {
      version: SEMANTIC_MEMORY_HANDOFF_VERSION,
      memoryConversationId,
      sourceThreadId: conversation.id,
      sourceEndMessageId: assistant.id,
    };
  }
  return undefined;
}
