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

export function isExactMemoryRememberRequestEvidence(
  value: unknown,
): value is MemoryRememberRequestEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const evidence = value as Partial<MemoryRememberRequestEvidence>;
  const keys = Object.keys(value).sort().join(',');
  if (
    keys !== 'memoryConversationId,sourceThreadId,taskId,userMessageId,userMessageText' &&
    keys !==
      'memoryConversationId,priorUserMessageId,sourceThreadId,taskId,userMessageId,userMessageText'
  ) {
    return false;
  }
  return (
    isExactMemoryScopeId(evidence.memoryConversationId) &&
    isExactMemoryScopeId(evidence.sourceThreadId) &&
    (evidence.taskId === null || isExactMemoryScopeId(evidence.taskId)) &&
    isExactMemoryProvenanceId(evidence.userMessageId) &&
    typeof evidence.userMessageText === 'string' &&
    (evidence.priorUserMessageId === undefined ||
      isExactMemoryProvenanceId(evidence.priorUserMessageId))
  );
}
