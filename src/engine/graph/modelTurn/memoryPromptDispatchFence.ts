import { isMemoryReadEpochCurrent } from '../../../services/memory/policy';
import { isVerifiedProcedureProjectionSnapshotDurablyCurrent } from '../../../services/memory/verifiedProcedure/observationAuthority';
import { isRestrictiveMemoryAuthoritySnapshotDurablyCurrent } from '../../../services/memory/memoryAuthority';
import { isMemoryValidityDeadlineCurrent } from '../../../services/memory/memoryValidityDeadline';
import type { Message } from '../../../types/message';
import type { PreparedAgentTurn } from '../agentTurnPreparation';
import {
  assertModelTurnMemoryPolicyBindingDurablyCurrent,
  buildModelTurnMemoryPolicyBinding,
  type ModelTurnMemoryPolicyBinding,
} from '../../authority/modelTurnMemoryPolicyBinding';

export {
  isMemoryPromptEpochExpiredError,
  MemoryPromptEpochExpiredError,
} from '../../authority/modelTurnMemoryPolicyBinding';

export function isPreparedMemoryReadCurrent(
  preparedTurn: PreparedAgentTurn,
  now = Date.now(),
): boolean {
  const fence = preparedTurn.memoryReadFence;
  return (
    !fence ||
    (isMemoryReadEpochCurrent(fence.readEpoch) &&
      isMemoryValidityDeadlineCurrent(fence.validUntil, now) &&
      isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(fence.memoryAuthoritySnapshot) &&
      (!fence.verifiedProcedureAuthoritySnapshot ||
        isVerifiedProcedureProjectionSnapshotDurablyCurrent(
          fence.verifiedProcedureAuthoritySnapshot,
        )))
  );
}

export function buildMemoryPromptDispatchGuard(
  preparedTurn: PreparedAgentTurn,
  now: () => number = Date.now,
): (() => void) | undefined {
  const fence = preparedTurn.memoryReadFence;
  if (!fence) return undefined;
  return buildModelTurnMemoryPolicyDispatchGuard(buildModelTurnMemoryPolicyBinding(fence), now);
}

export function buildModelTurnMemoryPolicyDispatchGuard(
  binding: ModelTurnMemoryPolicyBinding,
  now: () => number = Date.now,
): () => void {
  return () => assertModelTurnMemoryPolicyBindingDurablyCurrent(binding, now());
}

/**
 * Compaction summaries may have been shaped by living-memory hints or contain
 * reinjected profile sections. On opt-out, discard those synthetic system
 * messages and retain only the original conversation tail.
 */
export function removeLivingMemoryCompactionMessages(messages: ReadonlyArray<Message>): Message[] {
  return messages.filter(
    (message) => !(message.role === 'system' && message.id.startsWith('compact_')),
  );
}
