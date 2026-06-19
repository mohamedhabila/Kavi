// ---------------------------------------------------------------------------
// Tests — Engine memory tools opt-out
// ---------------------------------------------------------------------------
// Verifies that every `memory_*` tool short-circuits with a uniform
// `permission_denied` payload when `useSettingsStore.disableLongTermMemory`
// is set, and falls through to the real implementation when the flag is off.
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/sqlite-store';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { ensureDefaultBlocks } from '../../src/services/memory/blocks';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { executeTool } from '../../src/engine/tools';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const MEMORY_TOOLS = [
  'memory_search',
  'memory_recall',
  'memory_remember',
  'memory_pin',
  'memory_unpin',
  'memory_forget',
  'memory_block_read',
  'memory_block_edit',
  'memory_manage',
  'memory_block',
];

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
});

describe('memory tools — opt-out gate', () => {
  it.each(MEMORY_TOOLS)(
    'returns permission_denied for %s when disableLongTermMemory is true',
    async (toolName) => {
      useSettingsStore.setState({ disableLongTermMemory: true });
      const raw = await executeTool(toolName, '{}', 'conv-1');
      const parsed = JSON.parse(raw);
      expect(parsed.ok).toBe(false);
      expect(parsed.code).toBe('permission_denied');
      expect(typeof parsed.error).toBe('string');
    },
  );

  it('does NOT short-circuit when disableLongTermMemory is false', async () => {
    useSettingsStore.setState({ disableLongTermMemory: false });
    const raw = await executeTool('memory_block_read', JSON.stringify({ label: 'profile' }), 'conv-1');
    const parsed = JSON.parse(raw);
    expect(parsed.code).not.toBe('permission_denied');
  });

  it('adds runtime conversation provenance to memory_remember writes', async () => {
    const raw = await executeTool(
      'memory_remember',
      JSON.stringify({
        subject: 'user',
        predicate: 'timezone',
        value: 'UTC+1',
      }),
      'conv-runtime-memory',
    );
    const parsed = JSON.parse(raw);

    expect(parsed.ok).toBe(true);
    expect(parsed.fact.scope).toBe('conversation');
    expect(parsed.fact.originConversationId).toBe('conv-runtime-memory');
  });
});
