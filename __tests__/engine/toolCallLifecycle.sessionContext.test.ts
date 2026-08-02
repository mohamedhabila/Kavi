jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import type { ToolExecutionLifecycleParams } from '../../src/engine/toolExecution/toolCallLifecycleTypes';
import { executeTool } from '../../src/engine/tools';
import { completedToolOutcome } from '../../src/types/toolRuntimeOutcome';

jest.mock('../../src/services/events/bus', () => ({
  emitAgentEvent: jest.fn(),
}));

jest.mock('../../src/engine/tools', () => ({
  executeTool: jest.fn(),
}));

const mockedExecuteTool = jest.mocked(executeTool);

function buildSessionWaitLifecycle(
  trackedAsyncOperations: ToolExecutionLifecycleParams['trackedAsyncOperations'],
): ToolExecutionLifecycleParams {
  return {
    tc: { id: 'tc-session-wait', name: 'sessions_wait', arguments: '{}' },
    iteration: 1,
    batchIndex: 0,
    conversationId: 'conv-1',
    memoryConversationId: 'memory-conv-1',
    executionRunId: 'execution-run-1',
    modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
    provider: {
      id: 'p1',
      name: 'Test',
      apiKey: 'k',
      baseUrl: 'https://example.com',
      models: [],
    },
    model: 'test-model',
    availableToolNames: new Set(['sessions_wait']),
    runtimeToolAvailability: {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
      hasMobileController: false,
    },
    toolCallHistory: [],
    groundedRequestScopedTools: [
      {
        name: 'sessions_wait',
        description: 'Wait for workers.',
        input_schema: { type: 'object', properties: {}, required: [] },
        contract: { sideEffects: ['none'] },
      },
    ],
    trackedAsyncOperations,
    callbacks: {
      onToolCallStart: jest.fn(),
      onToolCallComplete: jest.fn(),
    },
    usePerformanceMetrics: false,
    idPrefixes: {
      blocked: 'blocked',
      filtered: 'filtered',
      workflow: 'workflow',
      cancelled: 'cancelled',
      success: 'tool',
      error: 'error',
    },
  };
}

describe('executeToolCallLifecycle session context', () => {
  beforeEach(() => {
    mockedExecuteTool.mockReset();
  });

  it('passes exact joined session identities through code-owned context', async () => {
    mockedExecuteTool.mockResolvedValueOnce(completedToolOutcome('{}'));
    const trackedAsyncOperations: ToolExecutionLifecycleParams['trackedAsyncOperations'] = new Map([
      [
        'session:sub-exact-1',
        {
          key: 'session:sub-exact-1',
          kind: 'session',
          resourceId: 'sub-exact-1',
          displayName: 'Worker',
          status: 'running',
          blocksFinalization: true,
          lastUpdatedByTool: 'sessions_spawn',
          updatedAt: 1000,
          monitorToolNames: ['sessions_wait'],
          waitToolName: 'sessions_wait',
          waitArgs: { sessionId: 'sub-exact-1' },
        },
      ],
    ]);

    await executeToolCallLifecycle(buildSessionWaitLifecycle(trackedAsyncOperations));

    expect(mockedExecuteTool).toHaveBeenCalledWith(
      'sessions_wait',
      '{}',
      'conv-1',
      expect.objectContaining({ pendingSessionIds: ['sub-exact-1'] }),
    );
  });
});
