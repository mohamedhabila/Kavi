import type { AgentGoal } from '../../src/engine/goals/types';
import { createAgentControlGraphRuntime } from '../../src/engine/graph/agentControlGraphRuntime';
import { syncActiveGoalFocusFromGraphTransition } from '../../src/services/memory/tasks';

jest.mock('../../src/services/memory/tasks', () => ({
  syncActiveGoalFocusFromGraphTransition: jest.fn(),
}));

const mockedSyncActiveGoalFocus = jest.mocked(syncActiveGoalFocusFromGraphTransition);

function createGoal(id: string): AgentGoal {
  return {
    id,
    title: `Goal ${id}`,
    status: 'active',
    dependencies: [],
    evidence: [],
    createdAt: 1,
    updatedAt: 1,
    completionPolicy: 'blocking',
  };
}

function createRuntime() {
  return createAgentControlGraphRuntime({
    callbacks: {
      onAssistantMessage: jest.fn(),
      onStateChange: jest.fn(),
      onError: jest.fn(),
      onDone: jest.fn(),
    },
    conversationId: 'conversation-1',
    initialMessages: [],
  });
}

describe('agent control graph runtime task-memory projection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not project internal completion bookkeeping into task memory', () => {
    const runtime = createRuntime();

    runtime.applyEvents([
      {
        type: 'GOALS_UPDATED',
        goals: [createGoal('effect-write-file-request')],
        reason: 'effect_completion_contract:add',
        projectToMemoryTasks: false,
      },
    ]);

    expect(mockedSyncActiveGoalFocus).not.toHaveBeenCalled();
    expect(runtime.snapshot.goals).toEqual([
      expect.objectContaining({ id: 'effect-write-file-request', status: 'active' }),
    ]);
  });

  it('continues projecting user task goals into memory', () => {
    const runtime = createRuntime();
    const goal = createGoal('user-goal');

    runtime.applyEvents([
      {
        type: 'GOALS_UPDATED',
        goals: [goal],
        reason: 'update_goals:add',
      },
    ]);

    expect(mockedSyncActiveGoalFocus).toHaveBeenCalledWith({
      threadId: 'conversation-1',
      goals: [expect.objectContaining({ id: 'user-goal', status: 'active' })],
    });
  });
});

describe('agent control graph runtime discovery activation', () => {
  it('replaces stale discovery-only pins with the latest successful result', () => {
    const runtime = createRuntime();

    runtime.applyEvents([
      {
        type: 'SESSION_ACTIVATED_TOOLS_UPDATED',
        toolNames: ['calendar_list', 'read_file'],
        updateMode: 'replace',
        reason: 'tool_catalog:discovery',
      },
      {
        type: 'SESSION_ACTIVATED_TOOLS_UPDATED',
        toolNames: ['memory_recall'],
        updateMode: 'replace',
        reason: 'tool_catalog:discovery',
      },
    ]);

    expect(runtime.snapshot.sessionActivatedToolNames).toEqual(['memory_recall']);
  });

  it('clears stale discovery-only pins when the latest result is empty', () => {
    const runtime = createRuntime();

    runtime.applyEvents([
      {
        type: 'SESSION_ACTIVATED_TOOLS_UPDATED',
        toolNames: ['calendar_list'],
        updateMode: 'replace',
      },
      {
        type: 'SESSION_ACTIVATED_TOOLS_UPDATED',
        toolNames: [],
        updateMode: 'replace',
      },
    ]);

    expect(runtime.snapshot.sessionActivatedToolNames).toBeUndefined();
  });

  it('keeps sibling catalog results when one tool is described in detail', () => {
    const runtime = createRuntime();

    runtime.applyEvents([
      {
        type: 'SESSION_ACTIVATED_TOOLS_UPDATED',
        toolNames: ['mcp__ledger__get_record', 'mcp__ledger__put_record'],
        updateMode: 'replace',
      },
      {
        type: 'SESSION_ACTIVATED_TOOLS_UPDATED',
        toolNames: ['mcp__ledger__put_record'],
        updateMode: 'merge',
      },
    ]);

    expect(runtime.snapshot.sessionActivatedToolNames).toEqual([
      'mcp__ledger__get_record',
      'mcp__ledger__put_record',
    ]);
  });
});
