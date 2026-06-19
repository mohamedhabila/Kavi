import { executeAgentControlGraphToolBatch } from '../../src/engine/graph/toolTurnBatchExecution';
import { GOAL_BOOTSTRAP_TOOL_NAME } from '../../src/engine/goals/bootstrap';
import { buildToolResultMessage } from '../../src/engine/toolExecution/toolExecutionMessages';
import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import type { Message } from '../../src/types/message';
import type { ToolDefinition } from '../../src/types/tool';

jest.mock('../../src/engine/toolExecution/toolCallLifecycle', () => ({
  executeToolCallLifecycle: jest.fn(),
}));

const mockedExecuteToolCallLifecycle = jest.mocked(executeToolCallLifecycle);

const tools: ToolDefinition[] = [
  {
    name: 'web_search',
    description: 'Search the web.',
    input_schema: {
      type: 'object',
      properties: { queries: { type: 'array', items: { type: 'string' } } },
      required: ['queries'],
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch a page.',
    input_schema: {
      type: 'object',
      properties: { urls: { type: 'array', items: { type: 'string' } } },
      required: ['urls'],
    },
  },
];

function createParams(overrides: Record<string, unknown> = {}) {
  return {
    executableToolCalls: [
      {
        id: 'tc-search',
        name: 'web_search',
        arguments: '{"queries":["OpenAI structured outputs developer guide"]}',
      },
    ],
    iteration: 2,
    conversationId: 'conv-1',
    activeProvider: {
      id: 'provider-1',
      name: 'Gemini',
      apiKey: 'test-key',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      enabled: true,
    } as any,
    allProviders: undefined,
    activeModel: 'gemini-2.5-pro',
    workspaceConversationId: undefined,
    workspaceReadFallbackConversationId: undefined,
    availableToolNames: new Set(['web_search', 'web_fetch']),
    runtimeToolAvailability: {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
    },
    toolCallHistory: [],
    trackedAsyncOperations: new Map(),
    signal: undefined,
    callbacks: {
      onToolCallStart: jest.fn(),
      onToolCallComplete: jest.fn(),
    },
    toolFilter: undefined,
    pendingAsyncMonitorToolNames: new Set<string>(),
    groundedRequestScopedTools: tools,
    completedWorkflowToolNames: new Set<string>(),
    emitPendingAsyncOperationsChange: jest.fn(),
    recordPerformanceMetrics: jest.fn(),
    publishWorkflowToolResultProgress: jest.fn(({ toolMessage }: { toolMessage: Message }) => ({
      observedToolName: toolMessage.toolCalls?.[0]?.name,
      nextCompletedToolNames: [],
    })),
    ...overrides,
  } as any;
}

describe('toolTurnBatchExecution', () => {
  beforeEach(() => {
    mockedExecuteToolCallLifecycle.mockReset();
  });

  it('executes web_search directly without a runtime search-until-fetch guard', async () => {
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => ({
      toolCallId: params.tc.id,
      effectiveToolName: params.tc.name,
      result: '{}',
      toolMessage: buildToolResultMessage({
        idPrefix: 'tool',
        toolCallId: params.tc.id,
        content: '{}',
        toolCall: {
          id: params.tc.id,
          name: params.tc.name,
          arguments: params.tc.arguments,
          status: 'completed',
        },
      }),
    }));

    const outcomes = await executeAgentControlGraphToolBatch(createParams());

    expect(mockedExecuteToolCallLifecycle).toHaveBeenCalledTimes(1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.toolCallId).toBe('tc-search');
    expect(outcomes[0]?.toolMessage.toolCalls?.[0]).toEqual(
      expect.objectContaining({
        name: 'web_search',
        status: 'completed',
      }),
    );
  });

  it('passes a grounded-surface execution filter into tool lifecycle preflight', async () => {
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => {
      expect(params.groundedRequestScopedTools).toEqual(tools.slice(0, 1));
      expect(params.toolFilter('web_search')).toBe(true);
      expect(params.toolFilter('web_fetch')).toBe(false);
      return {
        toolCallId: params.tc.id,
        effectiveToolName: params.tc.name,
        result: '{}',
        toolMessage: buildToolResultMessage({
          idPrefix: 'tool',
          toolCallId: params.tc.id,
          content: '{}',
          toolCall: {
            id: params.tc.id,
            name: params.tc.name,
            arguments: params.tc.arguments,
            status: 'completed',
          },
        }),
      };
    });

    await executeAgentControlGraphToolBatch(
      createParams({
        availableToolNames: new Set(['web_search', 'web_fetch']),
        groundedRequestScopedTools: tools.slice(0, 1),
      }),
    );

    expect(mockedExecuteToolCallLifecycle).toHaveBeenCalledTimes(1);
  });

  it('interrupts a serial batch after repeated failed goal mutations and returns skipped tool results', async () => {
    const serialTools: ToolDefinition[] = [
      {
        name: 'write_file',
        description: 'Write a local file.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: GOAL_BOOTSTRAP_TOOL_NAME,
        description: 'Update graph goals.',
        input_schema: { type: 'object', properties: {} },
      },
    ];
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => {
      const result =
        params.tc.name === GOAL_BOOTSTRAP_TOOL_NAME
          ? '{"status":"error","error":"validation failed"}'
          : '{"ok":true}';
      params.toolCallHistory.push({
        name: params.tc.name,
        arguments: params.tc.arguments,
        timestamp: Date.now(),
        result,
      });
      return {
        toolCallId: params.tc.id,
        effectiveToolName: params.tc.name,
        result,
        toolMessage: buildToolResultMessage({
          idPrefix: 'tool',
          toolCallId: params.tc.id,
          content: result,
          toolCall: {
            id: params.tc.id,
            name: params.tc.name,
            arguments: params.tc.arguments,
            status: result.includes('"error"') ? 'failed' : 'completed',
          },
          isError: result.includes('"error"'),
        }),
      };
    });

    const outcomes = await executeAgentControlGraphToolBatch(
      createParams({
        executableToolCalls: [
          { id: 'tc-write-1', name: 'write_file', arguments: '{"path":"one.txt"}' },
          { id: 'tc-goal-1', name: GOAL_BOOTSTRAP_TOOL_NAME, arguments: '{"action":"complete"}' },
          { id: 'tc-write-2', name: 'write_file', arguments: '{"path":"two.txt"}' },
          { id: 'tc-goal-2', name: GOAL_BOOTSTRAP_TOOL_NAME, arguments: '{"action":"complete"}' },
          { id: 'tc-write-3', name: 'write_file', arguments: '{"path":"three.txt"}' },
          { id: 'tc-goal-3', name: GOAL_BOOTSTRAP_TOOL_NAME, arguments: '{"action":"complete"}' },
          { id: 'tc-write-4', name: 'write_file', arguments: '{"path":"four.txt"}' },
        ],
        groundedRequestScopedTools: serialTools,
        availableToolNames: new Set(['write_file', GOAL_BOOTSTRAP_TOOL_NAME]),
        controlGraphGoals: [
          {
            id: 'g1',
            title: 'Goal',
            status: 'active',
            completionPolicy: 'blocking',
            dependencies: [],
            evidence: [],
            successCriteria: ['evidence.tool:write_file'],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );

    expect(mockedExecuteToolCallLifecycle).toHaveBeenCalledTimes(6);
    expect(outcomes).toHaveLength(7);
    expect(outcomes[6]?.toolCallId).toBe('tc-write-4');
    expect(outcomes[6]?.toolMessage.isError).toBe(true);
    expect(outcomes[6]?.toolMessage.content).toContain('critical_loop_detected');
  });
});
