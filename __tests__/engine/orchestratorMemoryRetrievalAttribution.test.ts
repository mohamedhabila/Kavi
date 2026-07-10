import { createMemoryAttributedOrchestratorCallbacks } from '../../src/engine/orchestrator/memoryRetrievalAttribution';
import type { OrchestratorCallbacks } from '../../src/engine/orchestrator/types';
import type { LivingMemoryBridgeOutput } from '../../src/services/memory/livingMemoryBridge';
import { buildAssistantMessageMetadata } from '../../src/utils/assistantMessageMetadata';

function makeCallbacks(): OrchestratorCallbacks {
  return {
    onStateChange: jest.fn(),
    onToken: jest.fn(),
    onToolCallStart: jest.fn(),
    onToolCallComplete: jest.fn(),
    onAssistantMessage: jest.fn(),
    onToolMessage: jest.fn(),
    onError: jest.fn(),
    onDone: jest.fn(),
  };
}

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

describe('memory retrieval attribution', () => {
  it('attributes only final messages to the exact selected-memory event', () => {
    const callbacks = makeCallbacks();
    const attributed = createMemoryAttributedOrchestratorCallbacks({
      callbacks,
      livingMemory: makeLivingMemory(),
    });

    attributed.onAssistantMessage(
      'Working',
      undefined,
      undefined,
      buildAssistantMessageMetadata('intermediate'),
    );
    attributed.onAssistantMessage(
      'Done',
      undefined,
      undefined,
      buildAssistantMessageMetadata('final'),
    );

    expect(jest.mocked(callbacks.onAssistantMessage).mock.calls[0]?.[3]).not.toHaveProperty(
      'memoryRetrievalEventId',
    );
    expect(jest.mocked(callbacks.onAssistantMessage).mock.calls[1]?.[3]).toEqual(
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
    const callbacks = makeCallbacks();
    const attributed = createMemoryAttributedOrchestratorCallbacks({
      callbacks,
      livingMemory: memory,
    });

    attributed.onAssistantMessage(
      'Done',
      undefined,
      undefined,
      buildAssistantMessageMetadata('final'),
    );

    expect(jest.mocked(callbacks.onAssistantMessage).mock.calls[0]?.[3]).not.toHaveProperty(
      'memoryRetrievalEventId',
    );
  });
});
