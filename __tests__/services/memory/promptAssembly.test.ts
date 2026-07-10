import { assemblePrompt } from '../../../src/services/memory/promptAssembly';
import type { MemoryFact, MemoryFactKind } from '../../../src/services/memory/facts/types';

function memoryFact(
  id: string,
  objectText: string,
  memoryKind: MemoryFactKind = 'agent_run',
): MemoryFact {
  return {
    id,
    subjectId: `subject-${id}`,
    predicate: memoryKind,
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
    localSimilarity: null,
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
    memoryKind,
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
            evidenceSlices: [{ observedControlSequence }],
          }),
        ),
      ],
    });

    const text = assembled.sections.map((section) => section.text).join('\n\n');
    expect(text).toContain('boundary-start');
    expect(text).toContain('needle-control');
    expect(text).toContain('boundary-end');
  });

  it('omits prior step thoughts when direct observed evidence is present', () => {
    const assembled = assemblePrompt({
      basePrompt: 'Base prompt.',
      retrievalQuery: 'target evidence',
      retrievedFacts: [
        memoryFact(
          'target',
          JSON.stringify({
            sourceRunId: 'run-target',
            status: 'completed',
            evidenceSlices: [
              {
                action: 'inspect-state',
                thought: 'prior model inference that should not compete with observation',
                observedControlSequence: [{ role: 'button', label: 'target evidence action' }],
                observation: 'target evidence was directly observed',
              },
            ],
          }),
        ),
      ],
    });

    const text = assembled.sections.map((section) => section.text).join('\n\n');
    expect(text).toContain('target evidence action');
    expect(text).toContain('target evidence was directly observed');
    expect(text).not.toContain('prior model inference');
  });

  it('omits sampled affordance summaries when query-focused ordered controls are present', () => {
    const assembled = assemblePrompt({
      basePrompt: 'Base prompt.',
      retrievalQuery: 'target evidence',
      retrievedFacts: [
        memoryFact(
          'target',
          JSON.stringify({
            sourceRunId: 'run-target',
            status: 'completed',
            evidenceSlices: [
              {
                observedControlSequence: [{ role: 'button', label: 'target evidence action' }],
                observedAffordances: [{ role: 'button', label: 'duplicated sampled action' }],
              },
            ],
          }),
        ),
      ],
    });

    const text = assembled.sections.map((section) => section.text).join('\n\n');
    expect(text).toContain('target evidence action');
    expect(text).not.toContain('duplicated sampled action');
  });

  it('keeps complementary query-matching affordance evidence in final prompt context', () => {
    const observedControlSequence = Array.from({ length: 48 }, (_, index) => ({
      role: 'button',
      label: `alpha workspace action ${index}`,
      attributes: `visible action ${index}`,
    }));

    const assembled = assemblePrompt({
      basePrompt: 'Base prompt.',
      retrievalQuery: 'alpha marker value',
      retrievedFacts: [
        memoryFact(
          'target',
          JSON.stringify({
            sourceRunId: 'run-target',
            status: 'completed',
            evidenceSlices: [
              {
                observedControlSequence,
                observedAffordances: [
                  {
                    role: 'textbox',
                    label: 'marker',
                    attributes: "value='TARGET-123'",
                    section: 'target section',
                  },
                  { role: 'button', label: 'unrelated affordance' },
                ],
              },
            ],
          }),
        ),
      ],
    });

    const text = assembled.sections.map((section) => section.text).join('\n\n');
    expect(text).toContain('observedAffordances');
    expect(text).toContain('marker');
    expect(text).toContain('TARGET-123');
    expect(text).toContain('target section');
    expect(text).toContain('observedControlSequence');
    expect(text).not.toContain('unrelated affordance');
  });

  it('keeps prior step thoughts when no direct observed evidence is available', () => {
    const assembled = assemblePrompt({
      basePrompt: 'Base prompt.',
      retrievalQuery: 'fallback note',
      retrievedFacts: [
        memoryFact(
          'target',
          JSON.stringify({
            sourceRunId: 'run-target',
            status: 'completed',
            evidenceSlices: [
              {
                action: 'record-note',
                thought: 'fallback note from sparse agent record',
              },
            ],
          }),
        ),
      ],
    });

    const text = assembled.sections.map((section) => section.text).join('\n\n');
    expect(text).toContain('fallback note from sparse agent record');
  });

  it('renders direct evidence spans ahead of compact run summaries', () => {
    const assembled = assemblePrompt({
      basePrompt: 'Base prompt.',
      retrievalQuery: 'deployment artifact path',
      retrievedFacts: [
        memoryFact(
          'summary',
          JSON.stringify({
            sourceRunId: 'run-target',
            status: 'completed',
            evidenceSlices: [{ action: 'Inspect deployment output' }],
          }),
        ),
        memoryFact(
          'span',
          JSON.stringify({
            sourceRunId: 'run-target',
            stateIndex: 4,
            action: 'Inspect deployment output',
            toolResult: 'deployment artifact path reports/release.json was written',
          }),
          'evidence_span',
        ),
      ],
    });

    const text = assembled.sections.map((section) => section.text).join('\n\n');
    expect(text.indexOf('#### Observed Evidence')).toBeLessThan(
      text.indexOf('#### Agent Run Evidence'),
    );
    expect(text).toContain('deployment artifact path reports/release.json was written');
  });
});
