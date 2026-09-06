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
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

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

describe('createLlmMemoryFactSelector candidate-text grapheme safety', () => {
  beforeEach(() => {
    mockSendLlmMessage.mockReset();
  });

  it('never splits a grapheme cluster when the 1800-char candidate-text cut lands inside a probe', async () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
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
    for (const probe of probes) {
      mockSendLlmMessage.mockResolvedValue({ output_parsed: { selectedFactIds: ['fact-a'] } });
      const selector = createLlmMemoryFactSelector({ provider, model: 'test-model' });
      // Repeat the probe near the 1800-char MAX_CANDIDATE_TEXT_CHARS boundary
      // so at least one occurrence straddles the exact cut.
      const objectText = `${'a'.repeat(1790)}${probe.repeat(15)}`;
      await selector?.({
        query: 'irrelevant',
        limit: 1,
        candidates: [
          {
            fact: fact('fact-a', objectText),
            score: 0.5,
            textScore: 0.5,
            relevanceScore: 0.5,
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
      expectGraphemeSafe(text);
    }
  });
});
