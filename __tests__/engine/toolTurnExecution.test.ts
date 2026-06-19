import type { TrackedAsyncOperation } from '../../src/engine/pendingAsyncOperations';
import type { PendingAgentToolCall } from '../../src/engine/graph/modelTurnExecutionTypes';
import {
  executeAgentControlGraphToolTurn,
  type ExecuteAgentControlGraphToolTurnParams,
} from '../../src/engine/graph/toolTurnExecution';
import type { Message } from '../../src/types/message';
import type { ToolDefinition } from '../../src/types/tool';
import { detectLoops } from '../../src/engine/loopDetection';
import { executeToolExecutionBatch } from '../../src/engine/toolExecution/toolExecutionBatch';
import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';

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
    warningInjectedThisRound: false,
    turnAssistantContent: 'Working on it',
    reasoning: 'reasoning',
    providerReplay: undefined,
    completion: undefined,
    pendingToolCalls: [createPendingToolCall()],
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

describe('toolTurnExecution', () => {
  beforeEach(() => {
    mockedDetectLoops.mockReset();
    mockedExecuteToolExecutionBatch.mockReset();
    mockedResolveToolExecutionOutcomes.mockReset();
    mockedResolveToolExecutionOutcomes.mockImplementation(async (params: any) => ({
      status: 'continued',
      lastPendingAsyncSignature: 'next-signature',
      workingMessages: params.workingMessages,
    }));
  });

  it('blocks the run when a critical loop is detected before tool execution', async () => {
    mockedDetectLoops.mockReturnValue({
      loopDetected: true,
      level: 'critical',
      type: 'generic_repeat',
      details: 'Repeated tool calls',
    });
    mockedExecuteToolExecutionBatch.mockResolvedValue([]);

    const params = createParams();
    const result = await executeAgentControlGraphToolTurn(params);

    expect(result.status).toBe('finalized');
    expect(params.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: {
          type: 'BLOCKED',
          reason: 'loop_detected',
        },
        sessionEndReason: 'loop_detected',
      }),
    );
    expect(mockedExecuteToolExecutionBatch).not.toHaveBeenCalled();
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      {
        type: 'BLOCKED',
        reason: 'loop_detected',
      },
    ]);
  });

  it('trims queued tool calls after sessions_yield before assistant staging and execution', async () => {
    mockedDetectLoops.mockReturnValue({ loopDetected: false });
    mockedExecuteToolExecutionBatch.mockResolvedValue([]);
    const params = createParams({
      pendingToolCalls: [
        createPendingToolCall({ id: 'tc-1', name: 'write_file' }),
        createPendingToolCall({
          id: 'tc-2',
          name: 'sessions_yield',
          arguments: '{"status":"completed"}',
        }),
        createPendingToolCall({
          id: 'tc-3',
          name: 'read_file',
          arguments: '{"path":"after.txt"}',
        }),
      ],
    });

    await executeAgentControlGraphToolTurn(params);

    expect(params.callbacks.onAssistantMessage).toHaveBeenCalledWith(
      'Working on it',
      [
        expect.objectContaining({ id: 'tc-1', name: 'write_file' }),
        expect.objectContaining({ id: 'tc-2', name: 'sessions_yield' }),
      ],
      undefined,
      expect.any(Object),
    );
    expect(mockedExecuteToolExecutionBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        executableToolCalls: [
          expect.objectContaining({ id: 'tc-1', name: 'write_file' }),
          expect.objectContaining({ id: 'tc-2', name: 'sessions_yield' }),
        ],
      }),
    );
  });

  it('records stagnation signatures after successful tool execution', async () => {
    mockedDetectLoops.mockReturnValue({ loopDetected: false });
    mockedExecuteToolExecutionBatch.mockResolvedValue([
      {
        index: 0,
        toolCallId: 'tc-1',
        toolMessage: createToolMessage(),
      },
    ]);

    const stagnationSignatures: Array<{
      toolMultisetKey: string;
      goalProgressFingerprint: string;
    }> = [];
    const params = createParams({
      stagnationSignatures,
      getGraphSnapshot: () =>
        ({
          goals: [
            {
              id: 'gate-followup',
              status: 'active',
              evidence: ['write_file:artifacts/e2e.txt'],
            },
          ],
        }) as any,
    });

    await executeAgentControlGraphToolTurn(params);

    expect(stagnationSignatures).toHaveLength(1);
    expect(stagnationSignatures[0]?.toolMultisetKey).toBe('write_file');
    expect(stagnationSignatures[0]?.goalProgressFingerprint).toContain('gate-followup:active:1:');
  });

  it('blocks the run when batch settles fewer outcomes than executable tool calls', async () => {
    mockedDetectLoops.mockReturnValue({ loopDetected: false });
    mockedExecuteToolExecutionBatch.mockResolvedValue([
      {
        index: 0,
        toolCallId: 'tc-1',
        toolMessage: createToolMessage(),
      },
    ]);

    const params = createParams({
      pendingToolCalls: [
        createPendingToolCall({ id: 'tc-1', name: 'calendar_list' }),
        createPendingToolCall({ id: 'tc-2', name: 'calendar_events' }),
      ],
    });

    const result = await executeAgentControlGraphToolTurn(params);

    expect(result.status).toBe('finalized');
    expect(params.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: {
          type: 'BLOCKED',
          reason: 'tool_batch_incomplete',
        },
        sessionEndReason: 'tool_batch_incomplete',
      }),
    );
    expect(mockedResolveToolExecutionOutcomes).not.toHaveBeenCalled();
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'GRAPH_OBSERVABILITY_RECORDED',
        observabilityType: 'TOOL_BATCH_INCOMPLETE',
        detail: 'expected:2,settled:1,unsettled:tc-2',
      }),
      {
        type: 'BLOCKED',
        reason: 'tool_batch_incomplete',
      },
    ]);
  });

  it('keeps loop-recovery as prompt guidance instead of recording workflow-tool directives', async () => {
    mockedDetectLoops.mockReturnValue({
      loopDetected: true,
      level: 'warning',
      type: 'generic_repeat',
      details: 'Repeated identical tool call',
    });
    mockedExecuteToolExecutionBatch.mockResolvedValue([
      {
        index: 0,
        toolCallId: 'tc-1',
        toolMessage: createToolMessage(),
      },
    ]);

    const params = createParams({
      warningInjectedThisRound: true,
    });
    const result = await executeAgentControlGraphToolTurn(params);

    expect(result.status).toBe('continued');
    expect(params.recordTurnDirectives).not.toHaveBeenCalled();
    expect(result.warningInjectedThisRound).toBe(true);
    expect(result.workingMessages.some((message) => message.role === 'system')).toBe(true);
  });
});
