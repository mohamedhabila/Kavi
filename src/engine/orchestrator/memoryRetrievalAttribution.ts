import type { LivingMemoryBridgeOutput } from '../../services/memory/livingMemoryBridge';
import type { AssistantMessageMetadata } from '../../types/message';
import type { OrchestratorCallbacks } from './types';
import { isMemoryRetrievalEventId } from '../../utils/assistantMessageMetadata';

export function resolveSelectedMemoryRetrievalEventId(
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

export function createMemoryAttributedOrchestratorCallbacks(params: {
  callbacks: OrchestratorCallbacks;
  livingMemory: LivingMemoryBridgeOutput | null | undefined;
}): OrchestratorCallbacks {
  const memoryRetrievalEventId = resolveSelectedMemoryRetrievalEventId(params.livingMemory);
  if (!memoryRetrievalEventId) {
    return params.callbacks;
  }
  return {
    ...params.callbacks,
    onAssistantMessage: (content, toolCalls, providerReplay, assistantMetadata) => {
      const attributedMetadata: AssistantMessageMetadata | undefined =
        assistantMetadata?.kind === 'final'
          ? { ...assistantMetadata, memoryRetrievalEventId }
          : assistantMetadata;
      params.callbacks.onAssistantMessage(content, toolCalls, providerReplay, attributedMetadata);
    },
  };
}
