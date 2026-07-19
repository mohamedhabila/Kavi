// ---------------------------------------------------------------------------
// Tests — Engine memory tools opt-out
// ---------------------------------------------------------------------------
// Verifies that every non-erasure memory tool short-circuits with a uniform
// typed rejection when `useSettingsStore.disableLongTermMemory`
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

import { closeMemoryDb } from '../../src/services/memory/database';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { listFacts } from '../../src/services/memory/facts/queries';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { useChatStore } from '../../src/store/useChatStore';
import { executeToolInner as executeTool } from '../../src/engine/tools/toolDispatchRouter';
import { createGoal } from '../../src/engine/goals/types';
import type { ToolExecutionContext } from '../../src/engine/tools/toolExecutionContext';
import type { ToolRuntimeOutcome } from '../../src/types/toolRuntimeOutcome';
import { memoryRememberArgs, memoryRememberExecution } from '../helpers/memoryRememberExecution';
import { parseCompletedToolOutcome, parseFailedToolOutcome } from '../helpers/toolRuntimeOutcome';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const MEMORY_TOOLS = [
  'memory_search',
  'memory_recall',
  'memory_remember',
  'memory_preserve_source',
  'memory_pin',
  'memory_unpin',
];

async function executeGroundedRemember(input: {
  args: Record<string, unknown>;
  threadId: string;
  userMessageId: string;
  userMessageText: string;
  context?: ToolExecutionContext;
}): Promise<ToolRuntimeOutcome> {
  const memoryConversationId = input.context?.memoryConversationId ?? input.threadId;
  const execution = memoryRememberExecution({
    memoryConversationId,
    sourceThreadId: input.threadId,
    taskId: input.context?.controlGraphGoals?.find((goal) => goal.status === 'active')?.id ?? null,
    userMessageId: input.userMessageId,
    userMessageText: input.userMessageText,
  });
  return executeTool(
    'memory_remember',
    JSON.stringify(input.args),
    input.threadId,
    {
      ...input.context,
      currentUserMessage: { id: input.userMessageId, text: input.userMessageText },
    },
    execution.executionClaim,
  );
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false });
  useChatStore.setState({ conversations: [] } as never);
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
  useChatStore.setState({ conversations: [] } as never);
});

describe('structured memory tool executor — opt-out gate', () => {
  it.each(MEMORY_TOOLS)(
    'returns a typed disabled rejection for %s when disableLongTermMemory is true',
    async (toolName) => {
      useSettingsStore.setState({ disableLongTermMemory: true });
      const outcome = await executeTool(toolName, '{}', 'conv-1');
      const parsed = parseFailedToolOutcome(outcome);
      expect(parsed.ok).toBe(false);
      expect(parsed.status).toBe('rejected');
      expect(parsed.code).toBe('memory_disabled');
      expect(typeof parsed.error).toBe('string');
    },
  );

  it('still honors explicit memory_forget withdrawal while memory is disabled', async () => {
    const remembered = parseCompletedToolOutcome(
      await executeGroundedRemember({
        args: memoryRememberArgs({
          userMessageText: 'I usually keep architecture reviews to 30 minutes.',
          subjectRef: { kind: 'self' },
          predicate: 'usual architecture review duration',
          value: '30 minutes',
          scope: 'global',
        }),
        threadId: 'conv-1',
        userMessageId: 'user-review-duration-withdrawal',
        userMessageText: 'I usually keep architecture reviews to 30 minutes.',
      }),
    );
    useSettingsStore.setState({ disableLongTermMemory: true });

    const outcome = await executeTool(
      'memory_forget',
      JSON.stringify({ factId: remembered.fact.id }),
      'conv-1',
    );
    const result = parseCompletedToolOutcome(outcome);

    expect(result).toEqual(expect.objectContaining({ ok: true, action: 'withdrawal' }));
    expect(JSON.stringify(result)).not.toContain('30 minutes');
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
  });

  it('rejects memory_manage withdrawal aliases and keeps correction gated under opt-out', async () => {
    const remembered = parseCompletedToolOutcome(
      await executeGroundedRemember({
        args: memoryRememberArgs({
          userMessageText: 'I usually keep architecture reviews to 45 minutes.',
          subjectRef: { kind: 'self' },
          predicate: 'usual architecture review duration',
          value: '45 minutes',
          scope: 'global',
        }),
        threadId: 'conv-1',
        userMessageId: 'user-review-duration-manage',
        userMessageText: 'I usually keep architecture reviews to 45 minutes.',
      }),
    );
    useSettingsStore.setState({ disableLongTermMemory: true });

    const withdrawnAlias = parseFailedToolOutcome(
      await executeTool(
        'memory_manage',
        JSON.stringify({ action: 'forget', factId: remembered.fact.id }),
        'conv-1',
      ),
    );
    const invalidated = parseFailedToolOutcome(
      await executeTool(
        'memory_manage',
        JSON.stringify({ action: 'invalidate', factId: remembered.fact.id }),
        'conv-1',
      ),
    );

    expect(withdrawnAlias).toEqual(expect.objectContaining({ ok: false, code: 'invalid_args' }));
    expect(invalidated).toEqual(
      expect.objectContaining({ status: 'rejected', ok: false, code: 'memory_disabled' }),
    );
  });

  it.each(['PIN', 'UNPIN', 'INVALIDATE', 'FORGET'])(
    'rejects non-canonical memory_manage action %s',
    async (action) => {
      const outcome = await executeTool(
        'memory_manage',
        JSON.stringify({ action, factId: 'fact-1' }),
        'conv-1',
      );
      expect(parseFailedToolOutcome(outcome)).toEqual(
        expect.objectContaining({ ok: false, code: 'invalid_args' }),
      );
    },
  );

  it.each(['pin', 'unpin', 'invalidate'])(
    'rejects extra runtime fields for memory_manage action=%s',
    async (action) => {
      const outcome = await executeTool(
        'memory_manage',
        JSON.stringify({ action, factId: 'fact-1', mode: 'delete' }),
        'conv-1',
      );
      expect(parseFailedToolOutcome(outcome)).toEqual(
        expect.objectContaining({ ok: false, code: 'invalid_args' }),
      );
    },
  );

  it('does NOT short-circuit when disableLongTermMemory is false', async () => {
    useSettingsStore.setState({ disableLongTermMemory: false });
    const outcome = await executeTool('memory_recall', JSON.stringify({ all: true }), 'conv-1');
    const parsed = parseCompletedToolOutcome(outcome);
    expect(parsed.code).not.toBe('memory_disabled');
  });

  it('adds runtime conversation provenance to memory_remember writes', async () => {
    const outcome = await executeGroundedRemember({
      args: memoryRememberArgs({
        userMessageText: 'My timezone is UTC+1.',
        subjectRef: { kind: 'self' },
        predicate: 'timezone',
        value: 'UTC+1',
        scope: 'conversation',
      }),
      threadId: 'conv-runtime-memory',
      userMessageId: 'user-runtime-timezone',
      userMessageText: 'My timezone is UTC+1.',
    });
    const parsed = parseCompletedToolOutcome(outcome);

    expect(parsed.ok).toBe(true);
    expect(parsed.fact.scope).toBe('conversation');
    expect(parsed.fact.originConversationId).toBe('conv-runtime-memory');
    expect(parsed.fact.originThreadId).toBe('conv-runtime-memory');
  });

  it('writes memory_remember facts to the explicit memory namespace with source-thread provenance', async () => {
    const outcome = await executeGroundedRemember({
      args: memoryRememberArgs({
        userMessageText: 'project release_artifact is artifact-build.',
        subjectRef: { kind: 'named', label: 'project' },
        predicate: 'release_artifact',
        value: 'artifact-build',
        scope: 'conversation',
      }),
      threadId: 'child-runtime-memory',
      userMessageId: 'user-release-artifact',
      userMessageText: 'project release_artifact is artifact-build.',
      context: {
        memoryConversationId: 'parent-runtime-memory',
        workspaceConversationId: 'parent-runtime-files',
      },
    });
    const parsed = parseCompletedToolOutcome(outcome);

    expect(parsed.ok).toBe(true);
    expect(parsed.fact.scope).toBe('conversation');
    expect(parsed.fact.originConversationId).toBe('parent-runtime-memory');
    expect(parsed.fact.originThreadId).toBe('child-runtime-memory');
  });

  it('rejects provider-supplied null provenance for memory_remember writes', async () => {
    const outcome = await executeGroundedRemember({
      args: {
        ...memoryRememberArgs({
          userMessageText: 'project build_marker is artifact-null.',
          subjectRef: { kind: 'named', label: 'project' },
          predicate: 'build_marker',
          value: 'artifact-null',
          scope: 'project',
        }),
        originConversationId: null,
        originThreadId: null,
        originTaskId: 'model-task',
        sourceMessageId: 'model-message',
        sourceRunId: 'model-run',
      },
      threadId: 'child-runtime-memory',
      userMessageId: 'user-build-marker-null',
      userMessageText: 'project build_marker is artifact-null.',
      context: {
        memoryConversationId: 'parent-runtime-memory',
        workspaceConversationId: 'parent-runtime-files',
        agentRunId: 'runtime-run',
      },
    });
    const parsed = parseFailedToolOutcome(outcome);

    expect(parsed).toMatchObject({
      ok: false,
      code: 'invalid_args',
      error: 'memory_remember requires only semanticEvidence and optional pinned.',
    });
    expect(listFacts({ originConversationId: 'parent-runtime-memory' })).toEqual([]);
  });

  it('rejects provider-supplied provenance overrides for memory_remember writes', async () => {
    const outcome = await executeGroundedRemember({
      args: {
        ...memoryRememberArgs({
          userMessageText: 'project build_marker is artifact-hostile.',
          subjectRef: { kind: 'named', label: 'project' },
          predicate: 'build_marker',
          value: 'artifact-hostile',
          scope: 'conversation',
        }),
        originConversationId: 'wrong-parent',
        originThreadId: 'wrong-child',
        originTaskId: 'wrong-run',
        sourceMessageId: 'wrong-message',
        sourceRunId: 'wrong-run',
      },
      threadId: 'child-runtime-memory',
      userMessageId: 'user-build-marker-hostile',
      userMessageText: 'project build_marker is artifact-hostile.',
      context: {
        memoryConversationId: 'parent-runtime-memory',
        workspaceConversationId: 'parent-runtime-files',
      },
    });
    const parsed = parseFailedToolOutcome(outcome);

    expect(parsed).toMatchObject({
      ok: false,
      code: 'invalid_args',
      error: 'memory_remember requires only semanticEvidence and optional pinned.',
    });
    expect(listFacts({ originConversationId: 'parent-runtime-memory' })).toEqual([]);
  });

  it('rejects a present non-exact code-owned agent run instead of trimming it', async () => {
    const outcome = await executeGroundedRemember({
      args: memoryRememberArgs({
        userMessageText: 'project build_marker is artifact-invalid-run.',
        subjectRef: { kind: 'named', label: 'project' },
        predicate: 'build_marker',
        value: 'artifact-invalid-run',
        scope: 'global',
      }),
      threadId: 'child-runtime-memory',
      userMessageId: 'user-invalid-runtime-run',
      userMessageText: 'project build_marker is artifact-invalid-run.',
      context: { agentRunId: ' runtime-run ' },
    });

    expect(parseFailedToolOutcome(outcome)).toMatchObject({ ok: false, code: 'internal' });
    expect(listFacts()).toEqual([]);
  });

  it('records active graph task provenance separately from source run provenance', async () => {
    const context: ToolExecutionContext = {
      memoryConversationId: 'parent-runtime-memory',
      workspaceConversationId: 'parent-runtime-files',
      agentRunId: 'runtime-run',
      controlGraphGoals: [
        createGoal({
          id: 'task-active',
          title: 'Ship the release',
          status: 'active',
          now: 1_000,
        }),
      ],
    };
    const outcome = await executeGroundedRemember({
      args: memoryRememberArgs({
        userMessageText: 'project release_artifact is artifact-task.',
        subjectRef: { kind: 'named', label: 'project' },
        predicate: 'release_artifact',
        value: 'artifact-task',
        scope: 'session',
      }),
      threadId: 'child-runtime-memory',
      userMessageId: 'user-release-artifact-task',
      userMessageText: 'project release_artifact is artifact-task.',
      context,
    });
    const parsed = parseCompletedToolOutcome(outcome);
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
    const global = parseCompletedToolOutcome(
      await executeGroundedRemember({
        args: memoryRememberArgs({
          userMessageText: 'My timezone is UTC+1.',
          subjectRef: { kind: 'self' },
          predicate: 'timezone',
          value: 'UTC+1',
          scope: 'global',
        }),
        threadId: 'persona-thread',
        userMessageId: 'user-global-timezone',
        userMessageText: 'My timezone is UTC+1.',
        context: { memoryConversationId: 'memory-root', workspaceConversationId: 'workspace-root' },
      }),
    );
    const persona = parseCompletedToolOutcome(
      await executeGroundedRemember({
        args: memoryRememberArgs({
          userMessageText: 'My role is warm.',
          subjectRef: { kind: 'self' },
          predicate: 'role',
          value: 'warm',
          scope: 'persona',
        }),
        threadId: 'persona-thread',
        userMessageId: 'user-persona-role',
        userMessageText: 'My role is warm.',
        context: { memoryConversationId: 'memory-root', workspaceConversationId: 'workspace-root' },
      }),
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
    const parsed = parseFailedToolOutcome(
      await executeGroundedRemember({
        args: memoryRememberArgs({
          userMessageText: 'project draft_state is open.',
          subjectRef: { kind: 'named', label: 'project' },
          predicate: 'draft_state',
          value: 'open',
          scope: 'session',
        }),
        threadId: 'thread-1',
        userMessageId: 'user-session-without-task',
        userMessageText: 'project draft_state is open.',
        context: { memoryConversationId: 'memory-root', workspaceConversationId: 'workspace-root' },
      }),
    );

    expect(parsed).toMatchObject({ ok: false, code: 'grounding_required' });
    expect(parsed.error).toContain('session_identity_unavailable');
    expect(listFacts()).toEqual([]);
  });
});
