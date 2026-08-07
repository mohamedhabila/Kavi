import type { TrackedAsyncOperation } from '../../src/engine/pendingAsyncOperations';
import type { PendingAgentToolCall } from '../../src/engine/graph/modelTurnExecutionTypes';
import type { ExecuteAgentControlGraphToolTurnParams } from '../../src/engine/graph/toolTurnExecution';
import type { Message } from '../../src/types/message';
import type { ToolDefinition } from '../../src/types/tool';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';

export const toolTurnExecutionTools: ToolDefinition[] = [
  {
    name: 'write_file',
    description: 'Write a local file',
    inputSchema: { type: 'object', properties: {} },
  },
];

export function createPendingToolCall(
  overrides: Partial<PendingAgentToolCall> = {},
): PendingAgentToolCall {
  return {
    id: 'tc-1',
    name: 'write_file',
    arguments: '{"path":"draft.txt"}',
    ...overrides,
  };
}

export function createToolMessage(): Message {
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

export function createToolTurnExecutionParams(
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
    groundedRequestScopedTools: toolTurnExecutionTools,
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
