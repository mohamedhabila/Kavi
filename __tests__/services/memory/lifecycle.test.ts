// ---------------------------------------------------------------------------
// Tests — Memory lifecycle
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../../src/services/llm/providerSupport', () => ({
  resolveProviderApiKey: jest.fn(async () => 'test-key'),
}));

import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/factStore';
import { ensureDefaultBlocks } from '../../../src/services/memory/blocks';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { useChatStore } from '../../../src/store/useChatStore';
import {
  runMemoryMigrationTick,
  runMemoryBackgroundFlush,
  __resetMemoryLifecycleForTests,
} from '../../../src/services/memory/lifecycle';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
  __resetMemoryLifecycleForTests();
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

  it('no-ops when no provider is configured', async () => {
    await expect(runMemoryBackgroundFlush()).resolves.toBeUndefined();
  });
});
