const mockSendLlmMessage = jest.fn();

jest.mock('../../../src/services/llm/messageService', () => ({
  sendLlmMessage: (...args: unknown[]) => mockSendLlmMessage(...args),
}));

jest.mock('../../../src/services/memory/memoryAuthority', () => ({
  captureMemoryAuthoritySnapshot: () => ({
    processEpochs: { restrictive: 0, projection: 0 },
    restrictiveRevision: {
      kind: 'restrictive',
      memoryOwnerId: 'selector-unit-test-owner',
      value: 0,
    },
    projectionRevision: {
      kind: 'projection',
      memoryOwnerId: 'selector-unit-test-owner',
      value: 0,
    },
    policy: { enabled: true, revision: 0 },
  }),
  isRestrictiveMemoryAuthoritySnapshotDurablyCurrent: () => true,
  isDurableMemoryPolicyEnabled: () => true,
  setDurableMemoryPolicyEnabled: jest.fn(),
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

describe('createLlmMemoryFactSelector — request payload contract', () => {
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
      options?: { temperature?: number };
    };
    expect(params.messages[0]?.content).toContain('evidence slate');
    expect(params.messages[0]?.content).toContain('distinct sourceRunId');
    expect(params.messages[0]?.content).toContain('smallest sufficient set');
    expect(params.messages[0]?.content).toContain('semantic similarity is not exact identity');
    expect(params.messages[0]?.content).toContain('most complete relevant observed inventory');
    expect(params.messages[0]?.content).not.toContain('targetSelected');
    const payload = JSON.parse(params.messages[1]?.content ?? '{}') as {
      maxSelected?: number;
      targetSelected?: number;
      candidates?: unknown[];
    };
    expect(payload.maxSelected).toBe(4);
    expect(payload.targetSelected).toBeUndefined();
    expect(payload.candidates).toHaveLength(3);
    expect(params.options?.temperature).toBe(0);
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
    expect(payload.candidates?.[1]?.matchedQueryUnits).toEqual(expect.arrayContaining(['target']));
    expect(payload.candidates?.[0]?.queryUnitCoverage ?? 0).toBeGreaterThan(
      payload.candidates?.[1]?.queryUnitCoverage ?? 0,
    );
  });
});
