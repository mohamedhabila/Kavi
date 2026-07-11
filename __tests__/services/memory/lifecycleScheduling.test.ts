jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../../src/services/llm/support/providerSupport', () => {
  const actual = jest.requireActual('../../../src/services/llm/support/providerSupport');
  return {
    ...actual,
    resolveProviderApiKey: jest.fn(async () => 'test-key'),
  };
});

const mockSendMessage = jest.fn();

jest.mock('../../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({
    sendMessage: mockSendMessage,
  })),
}));

import { ensureDefaultBlocks } from '../../../src/services/memory/blocks';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { __resetIngestionQueueForTests } from '../../../src/services/memory/ingestionQueue';
import {
  __resetMemoryLifecycleForTests,
  runMemoryBackgroundFlush,
  runMemoryMigrationTick,
} from '../../../src/services/memory/lifecycle';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import { closeMemoryDb } from '../../../src/services/memory/database';
import { useChatStore } from '../../../src/store/useChatStore';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
  __resetMemoryLifecycleForTests();
  __resetOnDeviceGuardsForTests();
  __resetIngestionQueueForTests();
  mockSendMessage.mockReset();
  useSettingsStore.setState({
    disableLongTermMemory: false,
    consolidationProvider: '',
    providers: [],
  } as any);
  useChatStore.setState({ conversations: [] } as any);
});

describe('runMemoryMigrationTick', () => {
  it('returns empty result when no consolidationProvider is configured', async () => {
    const result = await runMemoryMigrationTick({ force: true });
    expect(result.attempted).toBe(0);
    expect(result.completed).toBe(0);
  });

  it('returns empty result when disableLongTermMemory is true', async () => {
    useSettingsStore.setState({ disableLongTermMemory: true } as any);
    const result = await runMemoryMigrationTick({ force: true });
    expect(result.attempted).toBe(0);
  });

  it('throttles repeat ticks within the cooldown window', async () => {
    const now = Date.now();
    await runMemoryMigrationTick({ now, force: true });
    const second = await runMemoryMigrationTick({ now: now + 100 });
    expect(second.attempted).toBe(0);
    expect(second.completed).toBe(0);
  });
});

describe('runMemoryBackgroundFlush', () => {
  it('no-ops when memory is disabled', async () => {
    useSettingsStore.setState({ disableLongTermMemory: true } as any);
    await expect(runMemoryBackgroundFlush()).resolves.toBeUndefined();
  });

  it('no-ops when no conversations exist', async () => {
    await expect(runMemoryBackgroundFlush()).resolves.toBeUndefined();
  });
});
