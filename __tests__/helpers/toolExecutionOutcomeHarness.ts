import type { TrackedAsyncOperation } from '../../src/engine/pendingAsyncOperations';
import type { Message } from '../../src/types/message';
import type { ToolDefinition } from '../../src/types/tool';
import type { ToolCallRecord } from '../../src/engine/loopDetection';
import type { ToolExecutionOutcome } from '../../src/engine/graph/toolExecutionOutcomeResolution';

export const tools: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a file from the workspace',
    inputSchema: { type: 'object', properties: {} },
  },
];

export function tool(params: Pick<ToolDefinition, 'name' | 'contract'>): ToolDefinition {
  return {
    name: params.name,
    description: params.name,
    input_schema: { type: 'object', properties: {} },
    ...(params.contract ? { contract: params.contract } : {}),
  };
}

export function createToolMessage(params: {
  id: string;
  name: string;
  arguments?: string;
  content: string;
  isError?: boolean;
  toolCallOverrides?: Partial<NonNullable<Message['toolCalls']>[number]>;
}): Message {
  return {
    id: `msg_${params.id}`,
    role: 'tool',
    content: params.content,
    toolCallId: params.id,
    toolCalls: [
      {
        id: params.id,
        name: params.name,
        arguments: params.arguments ?? '{}',
        status: params.isError ? 'failed' : 'completed',
        ...(params.isError ? { error: params.content } : {}),
        ...params.toolCallOverrides,
      },
    ],
    timestamp: 1000,
    ...(params.isError ? { isError: true } : {}),
  };
}

export function createPendingOperation(
  overrides: Partial<TrackedAsyncOperation> = {},
): TrackedAsyncOperation {
  return {
    key: 'session:worker-1',
    kind: 'session',
    resourceId: 'worker-1',
    displayName: 'Worker 1',
    status: 'running',
    lastUpdatedByTool: 'sessions_spawn',
    updatedAt: 1000,
    monitorToolNames: ['sessions_wait'],
    waitToolName: 'sessions_wait',
    waitArgs: { sessionId: 'worker-1' },
    ...overrides,
  };
}

export function buildBaseParams() {
  const workingMessages: Message[] = [];
  return {
    iteration: 2,
    executableToolCalls: [{ name: 'read_file' }],
    toolExecutionOutcomes: [] as ToolExecutionOutcome[],
    groundedRequestScopedTools: tools,
    activation: undefined,
    completedWorkflowToolNames: new Set<string>(),
    trackedAsyncOperations: new Map<string, TrackedAsyncOperation>(),
    toolCallHistory: [] as ToolCallRecord[],
    pendingAsyncMonitorToolNames: new Set<string>(['sessions_wait']),
    lastPendingAsyncSignature: '',
    contextWindow: 20000,
    conversationId: 'conv-test',
    currentUserMessage: { id: 'user-test', text: 'Test request' },
    compactionEngine: null,
    livingMemory: null,
    onCompaction: undefined,
    warn: jest.fn(),
    publishMobileControllerHandoff: jest.fn().mockResolvedValue(undefined),
    onToolMessage: jest.fn().mockResolvedValue(undefined),
    onStateChange: jest.fn(),
    yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
    applyGraphEvents: jest.fn(),
    publishWorkflowToolResultProgress: jest.fn(({ toolMessage }) => ({
      observedToolName: toolMessage.toolCalls?.[0]?.name,
      newlyCompletedToolNames: ['read_file'],
      nextCompletedToolNames: ['read_file'],
    })),
    syncPendingAsyncOperationsToGraph: jest.fn(),
    recordTurnDirectives: jest.fn(),
    recordPostToolFinalTextDirective: jest.fn(() => false),
    getModelTurnBlocker: jest.fn(() => undefined),
    finishWithGraphTerminalEvent: jest.fn().mockResolvedValue(undefined),
    finishWaitingForUserInput: jest.fn().mockResolvedValue(undefined),
    getGraphSnapshot: jest.fn().mockReturnValue({}),
    workingMessages,
  };
}
