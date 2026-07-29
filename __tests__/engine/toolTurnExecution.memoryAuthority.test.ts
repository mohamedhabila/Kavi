import type { TrackedAsyncOperation } from '../../src/engine/pendingAsyncOperations';
import type { PendingAgentToolCall } from '../../src/engine/graph/modelTurnExecutionTypes';

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  executeAgentControlGraphToolTurn,
  type ExecuteAgentControlGraphToolTurnParams,
} from '../../src/engine/graph/toolTurnExecution';
import type { Message } from '../../src/types/message';
import type { ToolDefinition } from '../../src/types/tool';
import { detectLoops } from '../../src/engine/loopDetection';
import { executeToolExecutionBatch } from '../../src/engine/toolExecution/toolExecutionBatch';
import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';

jest.mock('../../src/engine/loopDetection', () => {
  const actual = jest.requireActual('../../src/engine/loopDetection');
  return {
    ...actual,
    detectLoops: jest.fn(),
  };
});

jest.mock('../../src/engine/toolExecution/toolExecutionBatch', () => ({
  executeToolExecutionBatch: jest.fn(),
}));

jest.mock('../../src/engine/graph/toolExecutionOutcomeResolution', () => ({
  resolveAgentControlGraphToolExecutionOutcomes: jest.fn(),
}));

const mockedDetectLoops = jest.mocked(detectLoops);
const mockedExecuteToolExecutionBatch = jest.mocked(executeToolExecutionBatch);
const mockedResolveToolExecutionOutcomes = jest.mocked(
  resolveAgentControlGraphToolExecutionOutcomes,
);

const tools: ToolDefinition[] = [
  {
    name: 'write_file',
    description: 'Write a local file',
    inputSchema: { type: 'object', properties: {} },
  },
];

function createPendingToolCall(
  overrides: Partial<PendingAgentToolCall> = {},
): PendingAgentToolCall {
  return {
    id: 'tc-1',
    name: 'write_file',
    arguments: '{"path":"draft.txt"}',
    ...overrides,
  };
}

function createToolMessage(): Message {
  return {
    id: 'msg_tool_1',
    role: 'tool',
    content: 'done',
    toolCallId: 'tc-1',
    toolCalls: [
      {
        id: 'tc-1',
        name: 'write_file',
        arguments: '{"path":"draft.txt"}',
        status: 'completed',
      },
    ],
    timestamp: 1000,
  };
}

function createParams(
  overrides: Partial<ExecuteAgentControlGraphToolTurnParams> = {},
): ExecuteAgentControlGraphToolTurnParams {
  return {
    iteration: 4,
    maxToolIterations: 20,
    conversationId: 'conv-1',
    activeProvider: {
      id: 'provider-1',
      name: 'OpenAI',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
      enabled: true,
    } as any,
    allProviders: undefined,
    activeModel: 'gpt-5-mini',
    workspaceConversationId: undefined,
    workspaceReadFallbackConversationId: undefined,
    availableToolNames: new Set(['write_file', 'sessions_yield']),
    runtimeToolAvailability: {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
      hasMobileController: false,
    },
    toolCallHistory: [],
    stagnationSignatures: [],
    getGraphSnapshot: () => ({ goals: [] }) as any,
    trackedAsyncOperations: new Map<string, TrackedAsyncOperation>(),
    signal: undefined,
    callbacks: {
      onAssistantMessage: jest.fn(),
      onToolCallStart: jest.fn(),
      onToolCallComplete: jest.fn(),
      onToolMessage: jest.fn().mockResolvedValue(undefined),
      onStateChange: jest.fn(),
    },
    toolFilter: undefined,
    pendingAsyncMonitorToolNames: new Set<string>(['sessions_wait']),
    groundedRequestScopedTools: tools,
    activation: undefined,
    completedWorkflowToolNames: new Set<string>(),
    lastPendingAsyncSignature: '',
    contextWindow: 24000,
    compactionEngine: null,
    livingMemory: null,
    onCompaction: undefined,
    warn: jest.fn(),
    yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
    applyGraphEvents: jest.fn(),
    publishWorkflowToolResultProgress: jest.fn(({ toolMessage }) => ({
      observedToolName: toolMessage.toolCalls?.[0]?.name,
      nextCompletedToolNames: ['write_file'],
    })),
    syncPendingAsyncOperationsToGraph: jest.fn(),
    recordTurnDirectives: jest.fn(),
    recordPostToolFinalTextDirective: jest.fn(() => false),
    getModelTurnBlocker: jest.fn(() => undefined),
    finishWithGraphTerminalEvent: jest.fn().mockResolvedValue(undefined),
    recordPerformanceMetrics: jest.fn(),
    emitPendingAsyncOperationsChange: jest.fn(),
    executionRunId: 'execution-run-1',
    warningInjectedThisRound: false,
    turnAssistantContent: 'Working on it',
    reasoning: 'reasoning',
    providerReplay: undefined,
    completion: undefined,
    pendingToolCalls: [createPendingToolCall()],
    memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
    workingMessages: [
      {
        id: 'msg_user_1',
        role: 'user',
        content: 'Create a file',
        timestamp: 1,
      },
    ],
    ...overrides,
  };
}

describe('toolTurnExecution memory-authority refresh', () => {
  beforeEach(() => {
    mockedDetectLoops.mockReset();
    mockedDetectLoops.mockReturnValue({ loopDetected: false });
    mockedExecuteToolExecutionBatch.mockReset();
    mockedResolveToolExecutionOutcomes.mockReset();
    mockedResolveToolExecutionOutcomes.mockImplementation(async (params: any) => ({
      status: 'continued',
      lastPendingAsyncSignature: 'next-signature',
      workingMessages: params.workingMessages,
    }));
  });

  it('reprepares a turn when every tool outcome was rejected by changed memory authority', async () => {
    mockedExecuteToolExecutionBatch.mockResolvedValue([
      {
        index: 0,
        toolCallId: 'tc-1',
        toolMessage: {
          id: 'memory-authority-rejected',
          role: 'tool',
          content: '{"code":"model_turn_memory_epoch_expired"}',
          toolCallId: 'tc-1',
          toolCalls: [
            {
              id: 'tc-1',
              name: 'write_file',
              arguments: '{"path":"draft.txt"}',
              status: 'failed',
              failureKind: 'authority_revoked',
            },
          ],
          timestamp: 1000,
          isError: true,
        },
      },
    ]);

    await expect(executeAgentControlGraphToolTurn(createParams())).rejects.toThrow(
      'memory_prompt_epoch_expired',
    );
    expect(mockedResolveToolExecutionOutcomes).not.toHaveBeenCalled();
  });

  it('does not replay a mixed batch after another tool already completed', async () => {
    mockedExecuteToolExecutionBatch.mockResolvedValue([
      {
        index: 0,
        toolCallId: 'tc-1',
        toolMessage: createToolMessage(),
      },
      {
        index: 1,
        toolCallId: 'tc-2',
        toolMessage: {
          id: 'memory-authority-rejected',
          role: 'tool',
          content: '{"code":"model_turn_memory_epoch_expired"}',
          toolCallId: 'tc-2',
          toolCalls: [
            {
              id: 'tc-2',
              name: 'write_file',
              arguments: '{"path":"second.txt"}',
              status: 'failed',
              failureKind: 'authority_revoked',
            },
          ],
          timestamp: 1001,
          isError: true,
        },
      },
    ]);
    const params = createParams({
      pendingToolCalls: [
        createPendingToolCall({ id: 'tc-1' }),
        createPendingToolCall({ id: 'tc-2', arguments: '{"path":"second.txt"}' }),
      ],
    });

    await expect(executeAgentControlGraphToolTurn(params)).resolves.toEqual(
      expect.objectContaining({ status: 'continued' }),
    );
    expect(mockedResolveToolExecutionOutcomes).toHaveBeenCalledTimes(1);
  });
});
