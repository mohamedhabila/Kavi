import {
  attachModelTurnMemoryAttribution,
  resolveModelTurnMemoryRetrievalEventId,
} from '../../src/engine/graph/modelTurnMemoryAttribution';
import type { LivingMemoryBridgeOutput } from '../../src/services/memory/livingMemoryBridge';
import { buildAssistantMessageMetadata } from '../../src/utils/assistantMessageMetadata';

function makeLivingMemory(
  overrides: Partial<LivingMemoryBridgeOutput> = {},
): LivingMemoryBridgeOutput {
  return {
    sections: [],
    cacheableSignature: 'signature',
    focusBlockText: '',
    openThreadLabels: [],
    recalledFactCount: 1,
    recalledEpisodeCount: 0,
    applicabilityPolicy: {
      policyVersion: 1,
      enabled: true,
      consideredFactCount: 1,
      promptVisibleFactCount: 1,
      promptBudgetDroppedFactCount: 0,
      actionCounts: { use: 1, clarify: 0, verify: 0, silent: 0 },
      reasonCounts: {},
    },
    retrievalEvent: {
      status: 'recorded',
      code: 'recorded',
      eventId: 'retrieval_event_m123_1_abc',
    },
    ...overrides,
  };
}

describe('model-turn memory retrieval attribution', () => {
  it('attributes only final messages to the exact selected-memory event', () => {
    const eventId = resolveModelTurnMemoryRetrievalEventId(makeLivingMemory());

    expect(
      attachModelTurnMemoryAttribution(buildAssistantMessageMetadata('intermediate'), eventId),
    ).not.toHaveProperty('memoryRetrievalEventId');
    expect(
      attachModelTurnMemoryAttribution(buildAssistantMessageMetadata('final'), eventId),
    ).toEqual(
      expect.objectContaining({
        kind: 'final',
        memoryRetrievalEventId: 'retrieval_event_m123_1_abc',
      }),
    );
  });

  it.each([
    makeLivingMemory({ recalledFactCount: 0, recalledEpisodeCount: 0 }),
    makeLivingMemory({ retrievalEvent: { status: 'failed', code: 'storage_error' } }),
    makeLivingMemory({
      retrievalEvent: { status: 'recorded', code: 'recorded', eventId: 'not-an-event' },
    }),
  ])('does not expose feedback attribution without a valid selected-memory event', (memory) => {
    expect(resolveModelTurnMemoryRetrievalEventId(memory)).toBeUndefined();
  });

  it('keeps the event used by the completed model turn when the session refreshes before delivery', () => {
    let admittedMemory = makeLivingMemory({
      retrievalEvent: {
        status: 'recorded',
        code: 'recorded',
        eventId: 'retrieval_event_initial_1',
      },
    });
    const completedTurnEventId = resolveModelTurnMemoryRetrievalEventId(admittedMemory);
    admittedMemory = makeLivingMemory({
      retrievalEvent: {
        status: 'recorded',
        code: 'recorded',
        eventId: 'retrieval_event_refreshed_2',
      },
    });

    const metadata = attachModelTurnMemoryAttribution(
      buildAssistantMessageMetadata('final'),
      completedTurnEventId,
    );

    expect(resolveModelTurnMemoryRetrievalEventId(admittedMemory)).toBe(
      'retrieval_event_refreshed_2',
    );
    expect(metadata.memoryRetrievalEventId).toBe('retrieval_event_initial_1');
  });
});
