import type { LivingMemoryBridgeOutput } from '../../services/memory/livingMemoryBridge';
import type { AssistantMessageMetadata } from '../../types/message';
import { isMemoryRetrievalEventId } from '../../utils/assistantMessageMetadata';

export function resolveModelTurnMemoryRetrievalEventId(
  livingMemory: LivingMemoryBridgeOutput | null | undefined,
): string | undefined {
  if (
    !livingMemory ||
    livingMemory.recalledFactCount + livingMemory.recalledEpisodeCount <= 0 ||
    livingMemory.retrievalEvent?.status !== 'recorded' ||
    !isMemoryRetrievalEventId(livingMemory.retrievalEvent.eventId)
  ) {
    return undefined;
  }
  return livingMemory.retrievalEvent.eventId;
}

export function attachModelTurnMemoryAttribution(
  metadata: AssistantMessageMetadata,
  memoryRetrievalEventId: string | undefined,
): AssistantMessageMetadata {
  return metadata.kind === 'final' && memoryRetrievalEventId
    ? { ...metadata, memoryRetrievalEventId }
    : metadata;
}
