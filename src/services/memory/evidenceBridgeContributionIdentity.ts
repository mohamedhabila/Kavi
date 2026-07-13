import { sha256HexUtf8 } from '../../utils/sha256';
import { requireExactMemoryProvenanceId } from './memoryProvenanceIdentity';

export const GRAPH_EVIDENCE_FACT_PRODUCER_ID = 'graph_evidence_v1' as const;

/** Identify one immutable graph-evidence item inside one closed assistant turn. */
export function buildGraphEvidenceFactProducerEventId(input: {
  sourceTurnId: string;
  evidenceEntryId: string;
  inputIndex: number;
}): string {
  const sourceTurnId = requireExactMemoryProvenanceId(
    input.sourceTurnId,
    'memory_graph_evidence_source_turn_id_invalid',
  );
  const evidenceEntryId = requireExactMemoryProvenanceId(
    input.evidenceEntryId,
    'memory_graph_evidence_entry_id_invalid',
  );
  if (!Number.isSafeInteger(input.inputIndex) || input.inputIndex < 0) {
    throw new Error('memory_graph_evidence_index_invalid');
  }
  return `graph_evidence_fact_event_v1_${sha256HexUtf8(
    JSON.stringify([
      'memory-graph-evidence-fact-event-v1',
      sourceTurnId,
      evidenceEntryId,
      input.inputIndex,
    ]),
  )}`;
}
