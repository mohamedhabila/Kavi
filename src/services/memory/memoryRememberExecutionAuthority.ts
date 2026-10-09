import type { AuthorizedToolEffectExecutionClaim } from '../executionJournal/authorizedToolEffectExecutionClaim';
import { isCodeOwnedExecutionRunId } from '../executionJournal/executionRunEffectBarrier';
import type { MemoryRememberRequestEvidence } from './memoryRememberPersistence';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { isExactMemoryScopeId } from './memoryScopeIdentity';

export function isExactMemoryRememberExecutionClaim(
  value: unknown,
): value is AuthorizedToolEffectExecutionClaim {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const claim = value as Partial<AuthorizedToolEffectExecutionClaim>;
  return (
    Object.keys(value).sort().join(',') === 'claimedAt,executionRunId,toolCallId' &&
    isCodeOwnedExecutionRunId(claim.executionRunId) &&
    isExactMemoryProvenanceId(claim.executionRunId) &&
    isExactMemoryProvenanceId(claim.toolCallId) &&
    Number.isSafeInteger(claim.claimedAt) &&
    claim.claimedAt! >= 0
  );
}

function isExactUserStatement(value: unknown): value is { id: string; text: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const statement = value as { id?: unknown; text?: unknown };
  return (
    Object.keys(value).sort().join(',') === 'id,text' &&
    isExactMemoryProvenanceId(statement.id) &&
    typeof statement.text === 'string'
  );
}

export function isExactMemoryRememberRequestEvidence(
  value: unknown,
): value is MemoryRememberRequestEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const evidence = value as Partial<MemoryRememberRequestEvidence>;
  const keys = Object.keys(value)
    .filter((key) => key !== 'earlierUserMessages')
    .sort()
    .join(',');
  if (keys !== 'memoryConversationId,sourceThreadId,taskId,userMessageId,userMessageText') {
    return false;
  }
  return (
    isExactMemoryScopeId(evidence.memoryConversationId) &&
    isExactMemoryScopeId(evidence.sourceThreadId) &&
    (evidence.taskId === null || isExactMemoryScopeId(evidence.taskId)) &&
    isExactMemoryProvenanceId(evidence.userMessageId) &&
    typeof evidence.userMessageText === 'string' &&
    (evidence.earlierUserMessages === undefined ||
      (Array.isArray(evidence.earlierUserMessages) &&
        evidence.earlierUserMessages.every(isExactUserStatement)))
  );
}

/**
 * The user messages a memory write may quote, most recent first: the current message,
 * then the turn's earlier ones (its request and any earlier steers).
 */
export function listMemoryRememberUserStatements(
  evidence: MemoryRememberRequestEvidence,
): ReadonlyArray<Readonly<{ id: string; text: string }>> {
  return [
    { id: evidence.userMessageId, text: evidence.userMessageText },
    ...[...(evidence.earlierUserMessages ?? [])].reverse(),
  ];
}
