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
import { getBlock } from '../../../src/services/memory/factStore';
import { getWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { getConsolidationState } from '../../../src/services/memory/consolidatorScheduler';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { useChatStore } from '../../../src/store/useChatStore';
import {
  recordCompletedTurnForMemory,
  runMemoryMigrationTick,
  runMemoryBackgroundFlush,
  __resetMemoryLifecycleForTests,
} from '../../../src/services/memory/lifecycle';
import type { Message } from '../../../src/types';

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

describe('recordCompletedTurnForMemory', () => {
  const messages: Message[] = [
    { id: 'u-1', role: 'user', content: 'Please remember the release follow-up.', timestamp: 1 },
    {
      id: 'a-1',
      role: 'assistant',
      content: 'Done. Next: validate the Android release build.',
      timestamp: 2,
      assistantMetadata: { kind: 'final', completionStatus: 'complete' },
    },
  ];

  it('marks completed turns dirty and updates heuristic focus when no provider exists', async () => {
    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-live',
      threadTitle: 'Release hardening',
      messages,
      now: 10,
    });

    expect(result.dirty.marked).toBe(true);
    expect(result.skipped).toBe('no_provider');
    expect(getConsolidationState('conv-live')?.turnsSinceLast).toBe(2);
    expect(getWorkingBlock('active_focus', {
      conversationId: 'conv-live',
      threadId: 'conv-live',
    })?.content).toContain('Release hardening');
    expect(getWorkingBlock('open_threads', {
      conversationId: 'conv-live',
      threadId: 'conv-live',
    })?.content).toContain('validate the Android release build');
  });

  it('creates no dirty state or block writes when long-term memory is disabled', async () => {
    useSettingsStore.setState({ disableLongTermMemory: true } as any);

    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-disabled',
      messages,
      now: 10,
    });

    expect(result.dirty.marked).toBe(false);
    expect(result.skipped).toBe('opt_out');
    expect(getConsolidationState('conv-disabled')).toBeNull();
    expect(getBlock('active_focus')?.content).toBe('');
    expect(getWorkingBlock('active_focus', {
      conversationId: 'conv-disabled',
      threadId: 'conv-disabled',
    })).toBeNull();
  });
});
