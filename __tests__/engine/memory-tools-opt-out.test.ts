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

jest.mock('../../src/services/remote/approvalStore', () => {
  const actual = jest.requireActual('../../src/services/remote/approvalStore');
  return {
    ...actual,
    requestToolApproval: jest.fn(async () => 'approved'),
  };
});

import { closeMemoryDb } from '../../src/services/memory/sqlite-store';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { ensureDefaultBlocks } from '../../src/services/memory/blocks';
import { listFacts } from '../../src/services/memory/facts/queries';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { useChatStore } from '../../src/store/useChatStore';
import { executeTool } from '../../src/engine/tools';
import { createGoal } from '../../src/engine/goals/types';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const MEMORY_TOOLS = [
  'memory_search',
  'memory_recall',
  'memory_remember',
  'memory_pin',
  'memory_unpin',
  'memory_block_read',
  'memory_block_edit',
  'memory_block',
];

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
  useSettingsStore.setState({ disableLongTermMemory: false });
  useChatStore.setState({ conversations: [] } as never);
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
  useChatStore.setState({ conversations: [] } as never);
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

  it('still honors explicit memory_forget withdrawal while memory is disabled', async () => {
    const remembered = JSON.parse(
      await executeTool(
        'memory_remember',
        JSON.stringify({
          subject: 'user',
          predicate: 'private_code',
          value: 'secret-42',
          scope: 'global',
        }),
        'conv-1',
      ),
    );
    useSettingsStore.setState({ disableLongTermMemory: true });

    const raw = await executeTool(
      'memory_forget',
      JSON.stringify({ factId: remembered.fact.id }),
      'conv-1',
    );
    const result = JSON.parse(raw);

    expect(result).toEqual(expect.objectContaining({ ok: true, action: 'withdrawal' }));
    expect(JSON.stringify(result)).not.toContain('secret-42');
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
  });

  it('rejects memory_manage withdrawal aliases and keeps correction gated under opt-out', async () => {
    const remembered = JSON.parse(
      await executeTool(
        'memory_remember',
        JSON.stringify({
          subject: 'user',
          predicate: 'private_code',
          value: 'secret-43',
          scope: 'global',
        }),
        'conv-1',
      ),
    );
    useSettingsStore.setState({ disableLongTermMemory: true });

    const withdrawnAlias = JSON.parse(
      await executeTool(
        'memory_manage',
        JSON.stringify({ action: 'forget', factId: remembered.fact.id }),
        'conv-1',
      ),
    );
    const invalidated = JSON.parse(
      await executeTool(
        'memory_manage',
        JSON.stringify({ action: 'invalidate', factId: remembered.fact.id }),
        'conv-1',
      ),
    );

    expect(withdrawnAlias).toEqual(expect.objectContaining({ ok: false, code: 'invalid_args' }));
    expect(invalidated).toEqual(expect.objectContaining({ ok: false, code: 'permission_denied' }));
  });

  it.each(['PIN', 'UNPIN', 'INVALIDATE', 'FORGET'])(
    'rejects non-canonical memory_manage action %s',
    async (action) => {
      const raw = await executeTool(
        'memory_manage',
        JSON.stringify({ action, factId: 'fact-1' }),
        'conv-1',
      );
      expect(JSON.parse(raw)).toEqual(expect.objectContaining({ ok: false, code: 'invalid_args' }));
    },
  );

  it.each(['pin', 'unpin', 'invalidate'])(
    'rejects extra runtime fields for memory_manage action=%s',
    async (action) => {
      const raw = await executeTool(
        'memory_manage',
        JSON.stringify({ action, factId: 'fact-1', mode: 'delete' }),
        'conv-1',
      );
      expect(JSON.parse(raw)).toEqual(expect.objectContaining({ ok: false, code: 'invalid_args' }));
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
        scope: 'conversation',
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
        scope: 'conversation',
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
        scope: 'conversation',
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
        scope: 'session',
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
    expect(storedFact?.sourceRunId).toBe('runtime-run');
  });

  it('keeps global and persona writes free of conversation and task bindings', async () => {
    useChatStore.setState({
      conversations: [{ id: 'persona-thread', personaId: 'assistant-persona' }],
    } as never);
    const global = JSON.parse(
      await executeTool(
        'memory_remember',
        JSON.stringify({
          subject: 'user',
          predicate: 'stable_timezone',
          value: 'UTC+1',
          scope: 'global',
        }),
        'persona-thread',
        { workspaceConversationId: 'workspace-root' },
      ),
    );
    const persona = JSON.parse(
      await executeTool(
        'memory_remember',
        JSON.stringify({
          subject: 'user',
          predicate: 'assistant_tone',
          value: 'warm',
          scope: 'persona',
        }),
        'persona-thread',
        { workspaceConversationId: 'workspace-root' },
      ),
    );

    expect(global).toMatchObject({
      ok: true,
      fact: {
        scope: 'global',
        personaId: null,
        originConversationId: null,
        originThreadId: null,
        originTaskId: null,
      },
    });
    expect(persona).toMatchObject({
      ok: true,
      fact: {
        scope: 'persona',
        personaId: 'assistant-persona',
        originConversationId: null,
        originThreadId: null,
        originTaskId: null,
      },
    });
  });

  it('rejects session memory without an active task instead of changing scope', async () => {
    const parsed = JSON.parse(
      await executeTool(
        'memory_remember',
        JSON.stringify({
          subject: 'project',
          predicate: 'draft_state',
          value: 'open',
          scope: 'session',
        }),
        'thread-1',
        { workspaceConversationId: 'workspace-root' },
      ),
    );

    expect(parsed).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(parsed.error).toContain('memory_fact_origin_task_id_required');
    expect(listFacts()).toEqual([]);
  });
});
