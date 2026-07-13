import { sha256HexUtf8 } from '../utils/sha256';
import type { MemoryFactContributionSourceKind } from '../services/memory/factContributionCodec';
import { recordFactWithContribution } from '../services/memory/facts/mutations';
import type { SealedFactApplicabilityProvenance } from '../services/memory/facts/applicabilityProvenance';
import type { RecordFactInput, RecordFactResult } from '../services/memory/facts/types';
import { requireExactMemoryProvenanceId } from '../services/memory/memoryProvenanceIdentity';

export const ACCEPTANCE_FACT_PRODUCER_IDS = {
  goalTaskUnification: 'acceptance_goal_task_v1',
  memoryCorrection: 'acceptance_memory_correction_v1',
  memoryHybridAblation: 'acceptance_memory_hybrid_v1',
} as const;

type AcceptanceFactProducerId =
  (typeof ACCEPTANCE_FACT_PRODUCER_IDS)[keyof typeof ACCEPTANCE_FACT_PRODUCER_IDS];

type AcceptanceFactInput = Omit<
  RecordFactInput,
  'now' | 'sourceMessageId' | 'sourceRunId' | 'sourceTurnId'
> & { now: number };

export interface AcceptanceFactContributionIdentity {
  producerId: AcceptanceFactProducerId;
  fixtureId: string;
  eventKey: string;
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string | null;
  sourceKind: MemoryFactContributionSourceKind;
  sourceId: string;
}

function buildProducerEventId(identity: AcceptanceFactContributionIdentity): string {
  const fixtureId = requireExactMemoryProvenanceId(
    identity.fixtureId,
    'memory_acceptance_fixture_id_invalid',
  );
  const eventKey = requireExactMemoryProvenanceId(
    identity.eventKey,
    'memory_acceptance_fixture_event_key_invalid',
  );
  return `acceptance_fact_event_v1_${sha256HexUtf8(
    JSON.stringify([
      'acceptance-fact-event-v1',
      identity.producerId,
      fixtureId,
      eventKey,
      identity.memoryConversationId,
      identity.sourceThreadId,
      identity.taskId,
      identity.sourceKind,
      identity.sourceId,
    ]),
  )}`;
}

function sourceField(
  identity: AcceptanceFactContributionIdentity,
): Pick<RecordFactInput, 'sourceMessageId' | 'sourceRunId' | 'sourceTurnId'> {
  return {
    sourceMessageId: identity.sourceKind === 'message' ? identity.sourceId : null,
    sourceRunId: identity.sourceKind === 'run' ? identity.sourceId : null,
    sourceTurnId: identity.sourceKind === 'turn' ? identity.sourceId : null,
  };
}

/** Persist one synthetic fixture fact with an exact, replay-stable causal source. */
export function recordAcceptanceFixtureFact(
  input: AcceptanceFactInput,
  applicability: SealedFactApplicabilityProvenance,
  identity: AcceptanceFactContributionIdentity,
): RecordFactResult {
  return recordFactWithContribution({ ...input, ...sourceField(identity) }, applicability, {
    memoryConversationId: identity.memoryConversationId,
    sourceThreadId: identity.sourceThreadId,
    taskId: identity.taskId,
    producer: {
      producerId: identity.producerId,
      producerEventId: buildProducerEventId(identity),
    },
    sourceAliases: [{ sourceKind: identity.sourceKind, sourceId: identity.sourceId }],
  });
}
