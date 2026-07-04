import { assemblePrompt } from '../../../src/services/memory/promptAssembly';
import type { MemoryFact } from '../../../src/services/memory/facts/types';

function memoryFact(id: string, objectText: string): MemoryFact {
  return {
    id,
    subjectId: `subject-${id}`,
    predicate: 'agent_run_result',
    objectText,
    objectEntityId: null,
    attributes: {},
    confidence: 0.9,
    sourceMessageId: null,
    sourceRunId: `run-${id}`,
    scope: 'conversation',
    originConversationId: 'conversation-1',
    originThreadId: null,
    originTaskId: null,
    sourceTurnId: null,
    sourceSummary: null,
    importance: 0.8,
    accessCount: 0,
    repeatedMentionCount: 0,
    lastRecalledAt: null,
    lastReinforcedAt: null,
    lastAccessedAt: null,
    decayPolicy: 'normal',
    expiresAt: null,
    contentHash: `hash-${id}`,
    embedding: null,
    validAt: 1,
    invalidAt: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    pinned: false,
    sourceActorId: null,
    taskId: null,
    retrievability: 1,
    stability: 0.8,
    decayRate: 0.03,
    lastPresentedAt: null,
    lastConfirmedAt: null,
    lastConflictedAt: null,
    reviewState: 'auto',
    sensitivity: 'normal',
    memoryKind: 'outcome',
  };
}

describe('assemblePrompt', () => {
  it('keeps ordered control sequence boundaries with query-neighbor evidence', () => {
    const observedControlSequence = Array.from({ length: 72 }, (_, index) => ({
      role: 'button',
      label: `control-${index}`,
    }));
    observedControlSequence[0] = { role: 'button', label: 'boundary-start' };
    observedControlSequence[36] = { role: 'button', label: 'needle-control' };
    observedControlSequence[71] = { role: 'button', label: 'boundary-end' };

    const assembled = assemblePrompt({
      basePrompt: 'Base prompt.',
      retrievalQuery: 'needle control',
      retrievedFacts: [
        memoryFact(
          'target',
          JSON.stringify({
            sourceRunId: 'run-target',
            status: 'completed',
            lastSteps: [{ observedControlSequence }],
          }),
        ),
      ],
    });

    const text = assembled.sections.map((section) => section.text).join('\n\n');
    expect(text).toContain('boundary-start');
    expect(text).toContain('needle-control');
    expect(text).toContain('boundary-end');
  });
});
