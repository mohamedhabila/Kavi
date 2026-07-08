const mockSendLlmMessage = jest.fn();

jest.mock('../../../src/services/llm/messageService', () => ({
  sendLlmMessage: (...args: unknown[]) => mockSendLlmMessage(...args),
}));

import { createLlmMemoryFactSelector } from '../../../src/services/memory/llmFactSelector';
import type { MemoryFact } from '../../../src/services/memory/facts/types';
import type { LlmProviderConfig } from '../../../src/types/provider';

function fact(
  id: string,
  objectText: string,
  memoryKind: MemoryFact['memoryKind'] = 'agent_run',
): MemoryFact {
  return {
    id,
    subjectId: `subject-${id}`,
    predicate: 'agent_run',
    objectText,
    confidence: 0.9,
    validAt: 1,
    invalidAt: null,
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
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
    attributes: {},
    contentHash: null,
    sourceActorId: null,
    taskId: null,
    memoryKind,
    retrievability: 1,
    stability: 0.8,
    decayRate: 0.03,
    lastPresentedAt: null,
    lastConfirmedAt: null,
    lastConflictedAt: null,
    reviewState: 'auto',
    sensitivity: 'normal',
    deletedAt: null,
  };
}

describe('createLlmMemoryFactSelector', () => {
  beforeEach(() => {
    mockSendLlmMessage.mockReset();
  });

  it('asks the configured LLM to select a compact high-confidence evidence slate', async () => {
    mockSendLlmMessage.mockResolvedValue({
      output_parsed: { selectedFactIds: ['fact-b', 'fact-a'] },
    });
    const provider: LlmProviderConfig = {
      id: 'test-provider',
      name: 'Test Provider',
      kind: 'remote',
      protocol: 'openai-responses',
      providerFamily: 'openai',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-key',
      model: 'test-model',
      enabled: true,
      capabilityHints: { supportsStructuredOutput: true },
    };
    const selector = createLlmMemoryFactSelector({ provider, model: 'test-model' });

    const result = await selector?.({
      query: 'which workflow evidence supports the current request?',
      limit: 4,
      candidates: [
        {
          fact: fact('fact-a', 'first direct workflow observation'),
          score: 0.9,
          textScore: 0.8,
          relevanceScore: 0.8,
        },
        {
          fact: fact('fact-b', 'second complementary workflow observation'),
          score: 0.8,
          textScore: 0.7,
          relevanceScore: 0.7,
        },
        {
          fact: fact('fact-c', 'third competing workflow observation'),
          score: 0.7,
          textScore: 0.6,
          relevanceScore: 0.6,
        },
      ],
    });

    expect(result?.factIds).toEqual(['fact-b', 'fact-a']);
    const params = mockSendLlmMessage.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(params.messages[0]?.content).toContain('evidence slate');
    expect(params.messages[0]?.content).toContain('distinct sourceRunId');
    expect(params.messages[0]?.content).toContain('smallest sufficient set');
    expect(params.messages[0]?.content).not.toContain('targetSelected');
    const payload = JSON.parse(params.messages[1]?.content ?? '{}') as {
      maxSelected?: number;
      targetSelected?: number;
      candidates?: unknown[];
    };
    expect(payload.maxSelected).toBe(4);
    expect(payload.targetSelected).toBeUndefined();
    expect(payload.candidates).toHaveLength(3);
  });

  it('keeps query-matching structured affordances visible in selector candidates', async () => {
    mockSendLlmMessage.mockResolvedValue({
      output_parsed: { selectedFactIds: ['fact-target'] },
    });
    const provider: LlmProviderConfig = {
      id: 'test-provider',
      name: 'Test Provider',
      kind: 'remote',
      protocol: 'openai-responses',
      providerFamily: 'openai',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-key',
      model: 'test-model',
      enabled: true,
      capabilityHints: { supportsStructuredOutput: true },
    };
    const selector = createLlmMemoryFactSelector({ provider, model: 'test-model' });
    const observedAffordances = [
      ...Array.from({ length: 24 }, (_, index) => ({
        role: 'link',
        label: `Generic action ${index}`,
      })),
      {
        role: 'link',
        label: 'Late section action',
        section: 'Late evidence section',
      },
    ];

    await selector?.({
      query: 'late evidence action',
      limit: 1,
      candidates: [
        {
          fact: fact(
            'fact-target',
            JSON.stringify({
              sourceRunId: 'run-target',
              status: 'completed',
              evidenceSlices: [{ observedAffordances }],
            }),
          ),
          score: 0.4,
          textScore: 0.2,
          relevanceScore: 0.2,
        },
      ],
    });

    const params = mockSendLlmMessage.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const payload = JSON.parse(params.messages[1]?.content ?? '{}') as {
      candidates?: Array<{ text?: string }>;
    };
    expect(payload.candidates?.[0]?.text).toContain('Late section action');
    expect(payload.candidates?.[0]?.text).toContain('Late evidence section');
  });

  it('exposes compact query coverage for selector candidate comparison', async () => {
    mockSendLlmMessage.mockResolvedValue({
      output_parsed: { selectedFactIds: ['fact-target'] },
    });
    const provider: LlmProviderConfig = {
      id: 'test-provider',
      name: 'Test Provider',
      kind: 'remote',
      protocol: 'openai-responses',
      providerFamily: 'openai',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-key',
      model: 'test-model',
      enabled: true,
      capabilityHints: { supportsStructuredOutput: true },
    };
    const selector = createLlmMemoryFactSelector({ provider, model: 'test-model' });

    await selector?.({
      query: 'surface alpha target',
      limit: 1,
      candidates: [
        {
          fact: fact(
            'fact-target',
            JSON.stringify({
              sourceRunId: 'run-target',
              status: 'completed',
              evidenceSlices: [
                {
                  url: 'https://app.example.test/surface/alpha',
                  observedControlSequence: [{ role: 'button', label: 'target action' }],
                },
              ],
            }),
          ),
          score: 0.4,
          textScore: 0.2,
          relevanceScore: 0.2,
        },
        {
          fact: fact(
            'fact-other',
            JSON.stringify({
              sourceRunId: 'run-other',
              status: 'completed',
              evidenceSlices: [
                {
                  url: 'https://app.example.test/other',
                  observedControlSequence: [{ role: 'button', label: 'target action' }],
                },
              ],
            }),
          ),
          score: 0.4,
          textScore: 0.2,
          relevanceScore: 0.2,
        },
      ],
    });

    const params = mockSendLlmMessage.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const payload = JSON.parse(params.messages[1]?.content ?? '{}') as {
      candidates?: Array<{ matchedQueryUnits?: string[]; queryUnitCoverage?: number }>;
    };
    expect(payload.candidates?.[0]?.matchedQueryUnits).toEqual(
      expect.arrayContaining(['surface', 'alpha', 'target']),
    );
    expect(payload.candidates?.[1]?.matchedQueryUnits).toEqual(
      expect.arrayContaining(['target']),
    );
    expect(payload.candidates?.[0]?.queryUnitCoverage ?? 0).toBeGreaterThan(
      payload.candidates?.[1]?.queryUnitCoverage ?? 0,
    );
  });

  it('keeps query-neighboring observed controls in source order for selector candidates', async () => {
    mockSendLlmMessage.mockResolvedValue({
      output_parsed: { selectedFactIds: ['fact-target'] },
    });
    const provider: LlmProviderConfig = {
      id: 'test-provider',
      name: 'Test Provider',
      kind: 'remote',
      protocol: 'openai-responses',
      providerFamily: 'openai',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-key',
      model: 'test-model',
      enabled: true,
      capabilityHints: { supportsStructuredOutput: true },
    };
    const selector = createLlmMemoryFactSelector({ provider, model: 'test-model' });

    await selector?.({
      query: 'Approve adjacent controls',
      limit: 1,
      candidates: [
        {
          fact: fact(
            'fact-target',
            JSON.stringify({
              sourceRunId: 'run-target',
              status: 'completed',
              evidenceSlices: [
                {
                  observedControlSequence: [
                    { role: 'button', label: 'Open' },
                    { role: 'button', label: 'Review' },
                    { role: 'button', label: 'Approve' },
                    { role: 'button', label: 'Archive' },
                    { role: 'columnheader', label: 'Name' },
                  ],
                },
              ],
            }),
          ),
          score: 0.4,
          textScore: 0.2,
          relevanceScore: 0.2,
        },
      ],
    });

    const params = mockSendLlmMessage.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const payload = JSON.parse(params.messages[1]?.content ?? '{}') as {
      candidates?: Array<{ text?: string }>;
    };
    const text = payload.candidates?.[0]?.text ?? '';
    expect(text).toContain('observedControlSequence');
    expect(text.indexOf('Review')).toBeLessThan(text.indexOf('Approve'));
    expect(text.indexOf('Approve')).toBeLessThan(text.indexOf('Archive'));
  });

  it('keeps step surface URLs visible in selector candidates', async () => {
    mockSendLlmMessage.mockResolvedValue({
      output_parsed: { selectedFactIds: ['fact-target'] },
    });
    const provider: LlmProviderConfig = {
      id: 'test-provider',
      name: 'Test Provider',
      kind: 'remote',
      protocol: 'openai-responses',
      providerFamily: 'openai',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-key',
      model: 'test-model',
      enabled: true,
      capabilityHints: { supportsStructuredOutput: true },
    };
    const selector = createLlmMemoryFactSelector({ provider, model: 'test-model' });

    await selector?.({
      query: 'which action is shown on the detail surface?',
      limit: 1,
      candidates: [
        {
          fact: fact(
            'fact-target',
            JSON.stringify({
              sourceRunId: 'run-target',
              status: 'completed',
              evidenceSlices: [
                {
                  url: 'https://app.example.test/work/items/index/edit/id/10',
                  observedControlSequence: [
                    { role: 'button', label: 'action-a' },
                    { role: 'button', label: 'action-b' },
                  ],
                },
              ],
            }),
          ),
          score: 0.4,
          textScore: 0.2,
          relevanceScore: 0.2,
        },
      ],
    });

    const params = mockSendLlmMessage.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const payload = JSON.parse(params.messages[1]?.content ?? '{}') as {
      candidates?: Array<{ text?: string }>;
    };
    const text = payload.candidates?.[0]?.text ?? '';
    expect(text).toContain('https://app.example.test/work/items/index/edit/id/10');
    expect(text).toContain('action-a');
    expect(text).toContain('action-b');
  });

  it('keeps ordered control sequence boundaries with query-neighbor evidence', async () => {
    mockSendLlmMessage.mockResolvedValue({
      output_parsed: { selectedFactIds: ['fact-target'] },
    });
    const provider: LlmProviderConfig = {
      id: 'test-provider',
      name: 'Test Provider',
      kind: 'remote',
      protocol: 'openai-responses',
      providerFamily: 'openai',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-key',
      model: 'test-model',
      enabled: true,
      capabilityHints: { supportsStructuredOutput: true },
    };
    const observedControlSequence = Array.from({ length: 60 }, (_, index) => ({
      role: 'button',
      label: `control-${index}`,
    }));
    observedControlSequence[0] = { role: 'button', label: 'boundary-start' };
    observedControlSequence[30] = { role: 'button', label: 'needle-control' };
    observedControlSequence[59] = { role: 'button', label: 'boundary-end' };
    const selector = createLlmMemoryFactSelector({ provider, model: 'test-model' });

    await selector?.({
      query: 'needle control',
      limit: 1,
      candidates: [
        {
          fact: fact(
            'fact-target',
            JSON.stringify({
              sourceRunId: 'run-target',
              status: 'completed',
              evidenceSlices: [{ observedControlSequence }],
            }),
          ),
          score: 0.4,
          textScore: 0.2,
          relevanceScore: 0.2,
        },
      ],
    });

    const params = mockSendLlmMessage.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const payload = JSON.parse(params.messages[1]?.content ?? '{}') as {
      candidates?: Array<{ text?: string }>;
    };
    const text = payload.candidates?.[0]?.text ?? '';
    expect(text).toContain('boundary-start');
    expect(text).toContain('needle-control');
    expect(text).toContain('boundary-end');
  });

  it('keeps selector candidates focused on observed evidence over prior thoughts', async () => {
    mockSendLlmMessage.mockResolvedValue({
      output_parsed: { selectedFactIds: ['fact-target'] },
    });
    const provider: LlmProviderConfig = {
      id: 'test-provider',
      name: 'Test Provider',
      kind: 'remote',
      protocol: 'openai-responses',
      providerFamily: 'openai',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-key',
      model: 'test-model',
      enabled: true,
      capabilityHints: { supportsStructuredOutput: true },
    };
    const selector = createLlmMemoryFactSelector({ provider, model: 'test-model' });

    await selector?.({
      query: 'direct evidence',
      limit: 1,
      candidates: [
        {
          fact: fact(
            'fact-target',
            JSON.stringify({
              sourceRunId: 'run-target',
              status: 'completed',
              evidenceSlices: [
                {
                  action: 'inspect-state',
                  thought: 'previous inferred plan that should not fill selector context',
                  observedControlSequence: [{ role: 'button', label: 'direct evidence action' }],
                  observation: 'direct evidence was observed',
                },
              ],
            }),
          ),
          score: 0.4,
          textScore: 0.2,
          relevanceScore: 0.2,
        },
      ],
    });

    const params = mockSendLlmMessage.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const payload = JSON.parse(params.messages[1]?.content ?? '{}') as {
      candidates?: Array<{ text?: string }>;
    };
    const text = payload.candidates?.[0]?.text ?? '';
    expect(text).toContain('direct evidence action');
    expect(text).toContain('direct evidence was observed');
    expect(text).not.toContain('previous inferred plan');
  });

  it('keeps selector candidates focused on ordered controls over sampled affordance summaries', async () => {
    mockSendLlmMessage.mockResolvedValue({
      output_parsed: { selectedFactIds: ['fact-target'] },
    });
    const provider: LlmProviderConfig = {
      id: 'test-provider',
      name: 'Test Provider',
      kind: 'remote',
      protocol: 'openai-responses',
      providerFamily: 'openai',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-key',
      model: 'test-model',
      enabled: true,
      capabilityHints: { supportsStructuredOutput: true },
    };
    const selector = createLlmMemoryFactSelector({ provider, model: 'test-model' });

    await selector?.({
      query: 'direct control',
      limit: 1,
      candidates: [
        {
          fact: fact(
            'fact-target',
            JSON.stringify({
              sourceRunId: 'run-target',
              status: 'completed',
              evidenceSlices: [
                {
                  observedControlSequence: [{ role: 'button', label: 'direct control action' }],
                  observedAffordances: [{ role: 'button', label: 'duplicated sampled action' }],
                },
              ],
            }),
          ),
          score: 0.4,
          textScore: 0.2,
          relevanceScore: 0.2,
        },
      ],
    });

    const params = mockSendLlmMessage.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const payload = JSON.parse(params.messages[1]?.content ?? '{}') as {
      candidates?: Array<{ text?: string }>;
    };
    const text = payload.candidates?.[0]?.text ?? '';
    expect(text).toContain('direct control action');
    expect(text).not.toContain('duplicated sampled action');
  });

  it('keeps complementary query-matching affordance evidence when ordered controls omit it', async () => {
    mockSendLlmMessage.mockResolvedValue({
      output_parsed: { selectedFactIds: ['fact-target'] },
    });
    const provider: LlmProviderConfig = {
      id: 'test-provider',
      name: 'Test Provider',
      kind: 'remote',
      protocol: 'openai-responses',
      providerFamily: 'openai',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-key',
      model: 'test-model',
      enabled: true,
      capabilityHints: { supportsStructuredOutput: true },
    };
    const selector = createLlmMemoryFactSelector({ provider, model: 'test-model' });
    const longControlSequence = Array.from({ length: 48 }, (_, index) => ({
      role: 'button',
      label: `alpha workspace action ${index}`,
      attributes: `visible action ${index}`,
    }));

    await selector?.({
      query: 'alpha marker value',
      limit: 1,
      candidates: [
        {
          fact: fact(
            'fact-target',
            JSON.stringify({
              sourceRunId: 'run-target',
              sequence: 4,
              observedControlSequence: longControlSequence,
              observedAffordances: [
                { role: 'textbox', label: 'marker', attributes: "value='TARGET-123'" },
                { role: 'button', label: 'unrelated affordance' },
              ],
            }),
            'evidence_span',
          ),
          score: 0.4,
          textScore: 0.2,
          relevanceScore: 0.2,
        },
      ],
    });

    const params = mockSendLlmMessage.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const payload = JSON.parse(params.messages[1]?.content ?? '{}') as {
      candidates?: Array<{ text?: string }>;
    };
    const text = payload.candidates?.[0]?.text ?? '';
    expect(text).toContain('marker');
    expect(text).toContain('TARGET-123');
    expect(text).toContain('observedControlSequence');
    expect(text).not.toContain('unrelated affordance');
  });
});
