import { sha256HexUtf8 } from '../../utils/sha256';
import { requireExactMemoryProvenanceId } from './memoryProvenanceIdentity';

export const AGENT_RUN_FACT_CONTRIBUTION_PRODUCER_ID = 'agent_run_memory_v1' as const;

/** Build one immutable causal event for a fixed record position inside an exact run bundle. */
export function buildAgentRunFactProducerEventId(input: {
  sourceRunId: string;
  recordKind: 'agent_run' | 'evidence_span';
  recordIndex: number;
}): string {
  const sourceRunId = requireExactMemoryProvenanceId(
    input.sourceRunId,
    'memory_agent_run_source_run_id_invalid',
  );
  if (input.recordKind !== 'agent_run' && input.recordKind !== 'evidence_span') {
    throw new Error('memory_agent_run_record_kind_invalid');
  }
  if (!Number.isSafeInteger(input.recordIndex) || input.recordIndex < 0) {
    throw new Error('memory_agent_run_record_index_invalid');
  }
  const identity = JSON.stringify([
    'memory-agent-run-fact-event-v1',
    AGENT_RUN_FACT_CONTRIBUTION_PRODUCER_ID,
    sourceRunId,
    input.recordKind,
    input.recordIndex,
  ]);
  return `agent_run_fact_event_v1_${sha256HexUtf8(identity)}`;
}
