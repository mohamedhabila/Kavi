import { sha256HexUtf8 } from '../../../utils/sha256';
import { requireExactMemoryProvenanceId } from '../memoryProvenanceIdentity';

export const CONSOLIDATION_FACT_PRODUCER_IDS = Object.freeze({
  structuralTurn: 'turn_structural_v1',
  providerTurn: 'turn_provider_v1',
  migrationSeedProvider: 'migration_seed_provider_v1',
  threadLocalImport: 'thread_local_import_v1',
} as const);

export type ConsolidationFactProducerId =
  (typeof CONSOLIDATION_FACT_PRODUCER_IDS)[keyof typeof CONSOLIDATION_FACT_PRODUCER_IDS];

/** Build the immutable identity for one fact position in one closed assistant turn. */
export function buildConsolidationFactProducerEventId(input: {
  producerId: ConsolidationFactProducerId;
  sourceAssistantMessageId: string;
  inputIndex: number;
}): string {
  const sourceAssistantMessageId = requireExactMemoryProvenanceId(
    input.sourceAssistantMessageId,
    'memory_consolidation_source_assistant_id_invalid',
  );
  if (!Number.isSafeInteger(input.inputIndex) || input.inputIndex < 0) {
    throw new Error('memory_consolidation_fact_index_invalid');
  }
  const identity = JSON.stringify([
    'memory-consolidation-fact-event-v1',
    input.producerId,
    sourceAssistantMessageId,
    input.inputIndex,
  ]);
  return `consolidation_fact_event_v1_${sha256HexUtf8(identity)}`;
}
