import { sha256HexUtf8 } from '../../utils/sha256';
import type { AuthorizedToolEffectExecutionClaim } from '../executionJournal/authorizedToolEffectExecutionClaim';
import { requireExactMemoryProvenanceId } from './memoryProvenanceIdentity';

export const MEMORY_REMEMBER_FACT_PRODUCER_ID = 'memory_tool_v1' as const;

/** One immutable contribution event for one durably authorized tool effect. */
export function buildMemoryRememberProducerEventId(
  claim: AuthorizedToolEffectExecutionClaim,
): string {
  const executionRunId = requireExactMemoryProvenanceId(
    claim.executionRunId,
    'memory_remember_execution_run_id_invalid',
  );
  const toolCallId = requireExactMemoryProvenanceId(
    claim.toolCallId,
    'memory_remember_tool_call_id_invalid',
  );
  return `memory_tool_event_v1_${sha256HexUtf8(
    JSON.stringify(['memory-remember-fact-event-v1', executionRunId, toolCallId]),
  )}`;
}
