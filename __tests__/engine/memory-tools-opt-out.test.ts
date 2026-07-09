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
import { listFacts } from '../../src/services/memory/facts/queries';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { executeTool } from '../../src/engine/tools';
import { createGoal } from '../../src/engine/goals/types';

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
    const raw = await executeTool(
      'memory_block_read',
      JSON.stringify({ label: 'profile' }),
      'conv-1',
    );
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
    expect(parsed.fact.originThreadId).toBe('conv-runtime-memory');
  });

  it('writes memory_remember facts to the workspace namespace with source-thread provenance', async () => {
    const raw = await executeTool(
      'memory_remember',
      JSON.stringify({
        subject: 'project',
        predicate: 'release_artifact',
        value: 'build-42',
      }),
      'child-runtime-memory',
      { workspaceConversationId: 'parent-runtime-memory' },
    );
    const parsed = JSON.parse(raw);

    expect(parsed.ok).toBe(true);
    expect(parsed.fact.scope).toBe('conversation');
    expect(parsed.fact.originConversationId).toBe('parent-runtime-memory');
    expect(parsed.fact.originThreadId).toBe('child-runtime-memory');
  });

  it('ignores provider-supplied null provenance for memory_remember writes', async () => {
    const raw = await executeTool(
      'memory_remember',
      JSON.stringify({
        subject: 'project',
        predicate: 'build_marker',
        value: 'artifact-null',
        scope: 'project',
        originConversationId: null,
        originThreadId: null,
        originTaskId: 'model-task',
        sourceMessageId: 'model-message',
        sourceRunId: 'model-run',
      }),
      'child-runtime-memory',
      { workspaceConversationId: 'parent-runtime-memory', agentRunId: 'runtime-run' },
    );
    const parsed = JSON.parse(raw);

    expect(parsed.ok).toBe(true);
    expect(parsed.fact.scope).toBe('project');
    expect(parsed.fact.originConversationId).toBe('parent-runtime-memory');
    expect(parsed.fact.originThreadId).toBe('child-runtime-memory');
    expect(parsed.fact.originTaskId).toBeNull();
    expect(parsed.fact.sourceMessageId).toBeNull();
    expect(listFacts({ originConversationId: 'parent-runtime-memory' })[0]?.sourceRunId).toBe(
      'runtime-run',
    );
  });

  it('ignores provider-supplied provenance overrides for memory_remember writes', async () => {
    const raw = await executeTool(
      'memory_remember',
      JSON.stringify({
        subject: 'project',
        predicate: 'build_marker',
        value: 'artifact-hostile',
        originConversationId: 'wrong-parent',
        originThreadId: 'wrong-child',
        originTaskId: 'wrong-run',
        sourceMessageId: 'wrong-message',
        sourceRunId: 'wrong-run',
      }),
      'child-runtime-memory',
      { workspaceConversationId: 'parent-runtime-memory' },
    );
    const parsed = JSON.parse(raw);

    expect(parsed.ok).toBe(true);
    expect(parsed.fact.scope).toBe('conversation');
    expect(parsed.fact.originConversationId).toBe('parent-runtime-memory');
    expect(parsed.fact.originThreadId).toBe('child-runtime-memory');
    expect(parsed.fact.originTaskId).toBeNull();
    expect(parsed.fact.sourceMessageId).toBeNull();
    expect(listFacts({ originConversationId: 'parent-runtime-memory' })[0]?.sourceRunId).toBeNull();
  });

  it('records active graph task provenance separately from source run provenance', async () => {
    const raw = await executeTool(
      'memory_remember',
      JSON.stringify({
        subject: 'project',
        predicate: 'release_artifact',
        value: 'artifact-task',
      }),
      'child-runtime-memory',
      {
        workspaceConversationId: 'parent-runtime-memory',
        agentRunId: 'runtime-run',
        controlGraphGoals: [
          createGoal({
            id: 'task-active',
            title: 'Ship the release',
            status: 'active',
            now: 1_000,
          }),
        ],
      },
    );
    const parsed = JSON.parse(raw);
    const storedFact = listFacts({ originConversationId: 'parent-runtime-memory' })[0];

    expect(parsed.ok).toBe(true);
    expect(parsed.fact.originTaskId).toBe('task-active');
    expect(storedFact?.originTaskId).toBe('task-active');
    expect(storedFact?.taskId).toBe('task-active');
    expect(storedFact?.sourceRunId).toBe('runtime-run');
  });
});
