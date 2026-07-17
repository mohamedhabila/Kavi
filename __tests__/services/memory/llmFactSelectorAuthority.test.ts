const mockProviderTransport = jest.fn();
const mockBeforeProviderTransport = jest.fn();

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock({ fileBacked: true });
});

jest.mock('../../../src/services/llm/messageService', () => ({
  sendLlmMessage: (params: { options?: { requestDispatchGuard?: () => void } }) => {
    mockBeforeProviderTransport();
    params.options?.requestDispatchGuard?.();
    return mockProviderTransport(params);
  },
}));

import Database from 'better-sqlite3';
import { makeMemoryFact } from '../../helpers/memoryFactFixtures';
import { createLlmMemoryFactSelector } from '../../../src/services/memory/llmFactSelector';
import * as memoryAuthority from '../../../src/services/memory/memoryAuthority';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { initializeMemoryPolicyObservation } from '../../../src/services/memory/policy';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
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

function selectOneFact() {
  const selector = createLlmMemoryFactSelector({ provider, model: 'test-model' });
  if (!selector) throw new Error('expected authorized memory fact selector');
  return selector({
    query: 'current request evidence',
    limit: 1,
    candidates: [
      {
        fact: makeMemoryFact({
          id: 'fact-current',
          objectText: 'current request evidence',
        }),
        score: 0.9,
        textScore: 0.9,
        relevanceScore: 0.9,
      },
    ],
  });
}

function runExternalMemoryMutation(sql: string): void {
  const externalMemoryDb = new Database(getMemoryDb().databasePath);
  try {
    externalMemoryDb.prepare(sql).run();
  } finally {
    externalMemoryDb.close();
  }
}

beforeEach(() => {
  mockProviderTransport.mockReset();
  mockBeforeProviderTransport.mockReset();
  mockProviderTransport.mockResolvedValue({
    output_parsed: { selectedFactIds: ['fact-current'] },
  });
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  memoryAuthority.setDurableMemoryPolicyEnabled(true);
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  initializeMemoryPolicyObservation();
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  jest.restoreAllMocks();
  closeMemoryDb();
});

it('dispatches exactly once while local and durable memory authority remains stable', async () => {
  await expect(selectOneFact()).resolves.toEqual({ factIds: ['fact-current'] });

  expect(mockBeforeProviderTransport).toHaveBeenCalledTimes(1);
  expect(mockProviderTransport).toHaveBeenCalledTimes(1);
});

it('uses the exact authority snapshot supplied by the owning retrieval', async () => {
  const exactSnapshot = memoryAuthority.captureMemoryAuthoritySnapshot();
  if (!exactSnapshot) throw new Error('expected memory authority');
  const recapture = jest
    .spyOn(memoryAuthority, 'captureMemoryAuthoritySnapshot')
    .mockReturnValue(null);
  const selector = createLlmMemoryFactSelector({
    provider,
    model: 'test-model',
    memoryAuthoritySnapshot: exactSnapshot,
  });

  await expect(
    selector?.({
      query: '証拠を選ぶ',
      limit: 1,
      candidates: [
        {
          fact: makeMemoryFact({ id: 'fact-current', objectText: '関連する証拠' }),
          score: 0.9,
          textScore: 0.9,
          relevanceScore: 0.9,
        },
      ],
    }),
  ).resolves.toEqual({ factIds: ['fact-current'] });
  expect(recapture).not.toHaveBeenCalled();
});

it('does not dispatch after an external-runtime correction changes restrictive authority', async () => {
  mockBeforeProviderTransport.mockImplementationOnce(() => {
    runExternalMemoryMutation(
      `UPDATE memory_vault_identity
          SET restrictive_authority_revision = restrictive_authority_revision + 1,
              projection_revision = projection_revision + 1
        WHERE singleton = 1`,
    );
  });

  await expect(selectOneFact()).resolves.toEqual({ factIds: [] });

  expect(mockBeforeProviderTransport).toHaveBeenCalledTimes(1);
  expect(mockProviderTransport).not.toHaveBeenCalled();
});

it('does not dispatch after an external runtime disables durable memory policy', async () => {
  mockBeforeProviderTransport.mockImplementationOnce(() => {
    runExternalMemoryMutation(
      `UPDATE memory_vault_identity
          SET memory_policy_enabled = 0,
              memory_policy_revision = memory_policy_revision + 1
        WHERE singleton = 1`,
    );
  });

  await expect(selectOneFact()).resolves.toEqual({ factIds: [] });

  expect(mockBeforeProviderTransport).toHaveBeenCalledTimes(1);
  expect(mockProviderTransport).not.toHaveBeenCalled();
});

it('does not dispatch after the process-local read epoch is revoked', async () => {
  mockBeforeProviderTransport.mockImplementationOnce(() => {
    useSettingsStore.setState({ disableLongTermMemory: true } as never);
  });

  await expect(selectOneFact()).resolves.toEqual({ factIds: [] });

  expect(mockBeforeProviderTransport).toHaveBeenCalledTimes(1);
  expect(mockProviderTransport).not.toHaveBeenCalled();
});

it('discards a selector response when restrictive authority changes after dispatch', async () => {
  mockProviderTransport.mockImplementationOnce(async () => {
    runExternalMemoryMutation(
      `UPDATE memory_vault_identity
          SET restrictive_authority_revision = restrictive_authority_revision + 1,
              projection_revision = projection_revision + 1
        WHERE singleton = 1`,
    );
    return { output_parsed: { selectedFactIds: ['fact-current'] } };
  });

  await expect(selectOneFact()).resolves.toEqual({ factIds: [] });

  expect(mockBeforeProviderTransport).toHaveBeenCalledTimes(1);
  expect(mockProviderTransport).toHaveBeenCalledTimes(1);
});
