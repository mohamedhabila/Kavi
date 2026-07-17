const mockSendLlmMessage = jest.fn();

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../../src/services/llm/messageService', () => ({
  sendLlmMessage: (...args: unknown[]) => mockSendLlmMessage(...args),
}));

import { createLlmMemoryFactSelector } from '../../../src/services/memory/llmFactSelector';
import { initializeMemoryPolicyObservation } from '../../../src/services/memory/policy';
import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { MemoryFact } from '../../../src/services/memory/facts/types';
import type { LlmProviderConfig } from '../../../src/types/provider';

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

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function memoryFact(): MemoryFact {
  return {
    id: 'fact-private',
    subjectId: 'subject-private',
    predicate: 'decision',
    objectText: 'deferred private evidence',
    objectEntityId: null,
    attributes: {},
    confidence: 0.9,
    sourceMessageId: null,
    sourceRunId: null,
    memoryOwnerId: 'vault-owner',
    personaId: null,
    factClass: 'workflow',
    sourceAuthority: 'tool_observed',
    scope: 'global',
    originConversationId: null,
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
    contentHash: 'private-hash',
    localSimilarity: null,
    validAt: 1,
    invalidAt: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    pinned: false,
    sourceActorId: null,
    retrievability: 1,
    stability: 0.8,
    decayRate: 0.03,
    lastPresentedAt: null,
    lastConfirmedAt: null,
    lastConflictedAt: null,
    reviewState: 'auto',
    sensitivity: 'normal',
    memoryKind: 'agent_run',
  };
}

beforeEach(() => {
  mockSendLlmMessage.mockReset();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  initializeMemoryPolicyObservation();
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  closeMemoryDb();
});

it('discards provider output when opt-out occurs while the provider is deferred', async () => {
  let releaseProvider!: (value: unknown) => void;
  mockSendLlmMessage.mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseProvider = resolve;
      }),
  );
  const selector = createLlmMemoryFactSelector({ provider, model: 'test-model' });
  const pending = selector!({
    query: 'deferred private evidence',
    limit: 1,
    candidates: [
      {
        fact: memoryFact(),
        score: 0.9,
        textScore: 0.9,
        relevanceScore: 0.9,
      },
    ],
  });
  expect(mockSendLlmMessage).toHaveBeenCalledTimes(1);
  useSettingsStore.setState({ disableLongTermMemory: true } as never);
  releaseProvider({ output_parsed: { selectedFactIds: ['fact-private'] } });

  await expect(pending).resolves.toEqual({ factIds: [] });
});
