import { executeAgentControlGraphToolBatch } from '../../src/engine/graph/toolTurnBatchExecution';
import { GOAL_BOOTSTRAP_TOOL_NAME } from '../../src/engine/goals/bootstrap';
import { buildEffectCompletionCriterion } from '../../src/engine/goals/effectCompletionEvidence';
import { resolveToolEffectCompletionRequirement } from '../../src/engine/toolExecution/toolEffectCompletionContract';
import { buildToolResultMessage } from '../../src/engine/toolExecution/toolExecutionMessages';
import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import type { Message } from '../../src/types/message';
import type { ToolDefinition } from '../../src/types/tool';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';

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

const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: 'Write a workspace file.',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'],
  },
};

const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read a workspace file.',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
};

function createParams(overrides: Record<string, unknown> = {}) {
  return {
    executableToolCalls: [
      {
        id: 'tc-search',
        name: 'web_search',
        arguments: '{"queries":["OpenAI structured outputs developer guide"]}',
      },
    ],
    memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
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
      hasMobileController: false,
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
    onBatchCommitted: jest.fn(),
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

  it('awaits the complete planned batch before any lifecycle dispatch', async () => {
    const ordering: string[] = [];
    let releasePlan!: () => void;
    let markPlanStarted!: () => void;
    const planStarted = new Promise<void>((resolve) => {
      markPlanStarted = resolve;
    });
    const verifiedProcedureSession = {
      observePlannedBatch: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            ordering.push('planned');
            releasePlan = resolve;
            markPlanStarted();
          }),
      ),
    };
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => {
      ordering.push('executed');
      expect(ordering).toEqual(['planned', 'executed']);
      expect(params.batchIndex).toBe(0);
      expect(params.verifiedProcedureSession).toBe(verifiedProcedureSession);
      return {
        toolCallId: params.tc.id,
        effectiveToolName: params.tc.name,
        result: '{}',
        toolMessage: buildToolResultMessage({
          idPrefix: 'tool',
          toolCallId: params.tc.id,
          content: '{}',
          toolCall: { ...params.tc, status: 'completed' },
        }),
      };
    });

    const execution = executeAgentControlGraphToolBatch(createParams({ verifiedProcedureSession }));
    await planStarted;
    expect(ordering).toEqual(['planned']);
    expect(mockedExecuteToolCallLifecycle).not.toHaveBeenCalled();
    releasePlan();
    await execution;

    expect(verifiedProcedureSession.observePlannedBatch).toHaveBeenCalledWith({
      iteration: 2,
      executeInParallel: false,
      memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
      toolCalls: [{ batchIndex: 0, toolCallId: 'tc-search', toolName: 'web_search' }],
    });
  });

  it('propagates a lifecycle reconciliation barrier to graph outcome handling', async () => {
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => ({
      toolCallId: params.tc.id,
      effectiveToolName: params.tc.name,
      result: 'Error: reconciliation required',
      effectReconciliationRequired: true,
      toolMessage: buildToolResultMessage({
        idPrefix: 'tool_error',
        toolCallId: params.tc.id,
        content: 'Error: reconciliation required',
        toolCall: {
          id: params.tc.id,
          name: params.tc.name,
          arguments: params.tc.arguments,
          status: 'failed',
        },
        isError: true,
      }),
    }));

    const outcomes = await executeAgentControlGraphToolBatch(createParams());

    expect(outcomes[0]).toEqual(expect.objectContaining({ effectReconciliationRequired: true }));
  });

  it('propagates a typed pre-dispatch effect failure to graph outcome handling', async () => {
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => ({
      toolCallId: params.tc.id,
      effectiveToolName: params.tc.name,
      result: 'Error: durable journal unavailable',
      effectDispatchObservation: {
        kind: 'not_claimed',
        reason: 'journal_unavailable',
      },
      toolMessage: buildToolResultMessage({
        idPrefix: 'tool_error',
        toolCallId: params.tc.id,
        content: 'Error: durable journal unavailable',
        toolCall: {
          id: params.tc.id,
          name: params.tc.name,
          arguments: params.tc.arguments,
          status: 'failed',
        },
        isError: true,
      }),
    }));

    const outcomes = await executeAgentControlGraphToolBatch(createParams());

    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        effectDispatchObservation: {
          kind: 'not_claimed',
          reason: 'journal_unavailable',
        },
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

  it('passes the code-owned current user message through the batch boundary', async () => {
    const currentUserMessage = { id: 'user-current', text: 'Raw current request.' };
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => {
      expect(params.currentUserMessage).toBe(currentUserMessage);
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

    await executeAgentControlGraphToolBatch(createParams({ currentUserMessage }));
    expect(mockedExecuteToolCallLifecycle).toHaveBeenCalledTimes(1);
  });

  it('blocks an effect until an active blocking goal owns its exact completion contract', async () => {
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => {
      const blocked = params.workflowToolCallBlocker(params.tc.name, params.tc.arguments);
      return {
        toolCallId: params.tc.id,
        effectiveToolName: params.tc.name,
        result: blocked ?? '{}',
        toolMessage: buildToolResultMessage({
          idPrefix: blocked ? 'blocked' : 'tool',
          toolCallId: params.tc.id,
          content: blocked ?? '{}',
          toolCall: {
            id: params.tc.id,
            name: params.tc.name,
            arguments: params.tc.arguments,
            status: blocked ? 'failed' : 'completed',
          },
          isError: Boolean(blocked),
        }),
      };
    });

    const outcomes = await executeAgentControlGraphToolBatch(
      createParams({
        executableToolCalls: [
          {
            id: 'tc-write',
            name: 'write_file',
            arguments: '{"path":"reports/final.md","content":"done"}',
          },
        ],
        groundedRequestScopedTools: [writeFileTool],
        availableToolNames: new Set(['write_file']),
        controlGraphGoals: [],
      }),
    );

    const blocked = JSON.parse(outcomes[0]?.toolMessage.content ?? '{}');
    expect(blocked).toMatchObject({
      status: 'error',
      code: 'completion_contract_required',
      tool: 'write_file',
      repair: {
        retryable: true,
        code: 'completion_contract_required',
        tool: GOAL_BOOTSTRAP_TOOL_NAME,
        retryArguments: {
          action: 'add',
          completionPolicy: 'blocking',
          status: 'active',
        },
        sideEffectApplied: false,
      },
    });
    expect(blocked.requiredCriterion).toEqual(expect.stringMatching(/^evidence\.effect:/u));
  });

  it.each([
    ['wrong resource', { resource: { kind: 'workspace_file', id: 'reports/other.md' } }],
    ['wrong digest', { resource: { digest: `sha256:${'b'.repeat(64)}` } }],
  ])('rejects a goal contract bound to the %s', async (_label, criterionOverride) => {
    const argumentsText = '{"path":"reports/final.md","content":"done"}';
    const requirement = await resolveToolEffectCompletionRequirement({
      toolName: 'write_file',
      argumentsText,
    });
    expect(requirement.kind).toBe('effectful');
    if (requirement.kind !== 'effectful') {
      throw new Error('write_file must have a code-owned effect completion contract');
    }
    const criterion = buildEffectCompletionCriterion({
      ...requirement.criterion,
      resource: {
        ...requirement.criterion.resource,
        ...criterionOverride.resource,
      },
    });
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => {
      const blocked = params.workflowToolCallBlocker(params.tc.name, params.tc.arguments);
      return {
        toolCallId: params.tc.id,
        effectiveToolName: params.tc.name,
        result: blocked ?? '{}',
        toolMessage: buildToolResultMessage({
          idPrefix: 'tool',
          toolCallId: params.tc.id,
          content: blocked ?? '{}',
          toolCall: {
            id: params.tc.id,
            name: params.tc.name,
            arguments: params.tc.arguments,
            status: blocked ? 'failed' : 'completed',
          },
          isError: Boolean(blocked),
        }),
      };
    });

    const outcomes = await executeAgentControlGraphToolBatch(
      createParams({
        executableToolCalls: [{ id: 'tc-write', name: 'write_file', arguments: argumentsText }],
        groundedRequestScopedTools: [writeFileTool],
        availableToolNames: new Set(['write_file']),
        controlGraphGoals: [
          {
            id: 'g-write',
            title: 'Write final report',
            status: 'active',
            completionPolicy: 'blocking',
            dependencies: [],
            evidence: [],
            successCriteria: [criterion],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );

    expect(JSON.parse(outcomes[0]?.toolMessage.content ?? '{}')).toMatchObject({
      code: 'completion_contract_required',
    });
  });

  it('allows an effect when an active blocking goal owns the exact request-bound contract', async () => {
    const argumentsText = '{"path":"reports/final.md","content":"done"}';
    const requirement = await resolveToolEffectCompletionRequirement({
      toolName: 'write_file',
      argumentsText,
    });
    expect(requirement.kind).toBe('effectful');
    if (requirement.kind !== 'effectful') {
      throw new Error('write_file must have a code-owned effect completion contract');
    }
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => {
      expect(params.workflowToolCallBlocker(params.tc.name, params.tc.arguments)).toBeUndefined();
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
        executableToolCalls: [{ id: 'tc-write', name: 'write_file', arguments: argumentsText }],
        groundedRequestScopedTools: [writeFileTool],
        availableToolNames: new Set(['write_file']),
        controlGraphGoals: [
          {
            id: 'g-write',
            title: 'Write final report',
            status: 'active',
            completionPolicy: 'blocking',
            dependencies: [],
            evidence: [],
            successCriteria: [requirement.serializedCriterion],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );

    expect(mockedExecuteToolCallLifecycle).toHaveBeenCalledTimes(1);
  });

  it('keeps goal mutation and effect execution on separate graph boundaries', async () => {
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => {
      const blocked = params.workflowToolCallBlocker(params.tc.name, params.tc.arguments);
      return {
        toolCallId: params.tc.id,
        effectiveToolName: params.tc.name,
        result: blocked ?? '{}',
        toolMessage: buildToolResultMessage({
          idPrefix: 'tool',
          toolCallId: params.tc.id,
          content: blocked ?? '{}',
          toolCall: {
            id: params.tc.id,
            name: params.tc.name,
            arguments: params.tc.arguments,
            status: blocked ? 'failed' : 'completed',
          },
          isError: Boolean(blocked),
        }),
      };
    });
    const argumentsText = '{"path":"reports/final.md","content":"done"}';
    const requirement = await resolveToolEffectCompletionRequirement({
      toolName: 'write_file',
      argumentsText,
    });
    if (requirement.kind !== 'effectful') {
      throw new Error('write_file must have a code-owned effect completion contract');
    }

    const outcomes = await executeAgentControlGraphToolBatch(
      createParams({
        executableToolCalls: [
          { id: 'tc-goal', name: GOAL_BOOTSTRAP_TOOL_NAME, arguments: '{"action":"create"}' },
          { id: 'tc-write', name: 'write_file', arguments: argumentsText },
        ],
        groundedRequestScopedTools: [
          {
            name: GOAL_BOOTSTRAP_TOOL_NAME,
            description: 'Update graph goals.',
            input_schema: { type: 'object', properties: {} },
          },
          writeFileTool,
        ],
        availableToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'write_file']),
        controlGraphGoals: [
          {
            id: 'g-write',
            title: 'Write final report',
            status: 'active',
            completionPolicy: 'blocking',
            dependencies: [],
            evidence: [],
            successCriteria: [requirement.serializedCriterion],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );

    expect(JSON.parse(outcomes[1]?.toolMessage.content ?? '{}')).toMatchObject({
      code: 'goal_mutation_boundary',
      tool: 'write_file',
    });
  });

  it('allows an answer-supporting read-only tool without a completion goal', async () => {
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => {
      expect(params.workflowToolCallBlocker(params.tc.name, params.tc.arguments)).toBeUndefined();
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
        executableToolCalls: [
          { id: 'tc-read', name: 'read_file', arguments: '{"path":"reports/final.md"}' },
        ],
        groundedRequestScopedTools: [readFileTool],
        availableToolNames: new Set(['read_file']),
        controlGraphGoals: [],
      }),
    );

    expect(mockedExecuteToolCallLifecycle).toHaveBeenCalledTimes(1);
  });

  it('interrupts a serial batch after repeated failed goal mutations and returns skipped tool results', async () => {
    const serialTools: ToolDefinition[] = [
      {
        name: 'read_file',
        description: 'Read a local file.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: GOAL_BOOTSTRAP_TOOL_NAME,
        description: 'Update graph goals.',
        input_schema: { type: 'object', properties: {} },
      },
    ];
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => {
      const status =
        params.tc.name === GOAL_BOOTSTRAP_TOOL_NAME ? ('failed' as const) : ('completed' as const);
      const result =
        status === 'failed' ? '{"status":"error","error":"validation failed"}' : '{"ok":true}';
      params.toolCallHistory.push({
        name: params.tc.name,
        arguments: params.tc.arguments,
        timestamp: Date.now(),
        status,
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
            status,
          },
          isError: status === 'failed',
        }),
      };
    });

    const outcomes = await executeAgentControlGraphToolBatch(
      createParams({
        executableToolCalls: [
          { id: 'tc-read-1', name: 'read_file', arguments: '{"path":"one.txt"}' },
          { id: 'tc-goal-1', name: GOAL_BOOTSTRAP_TOOL_NAME, arguments: '{"action":"complete"}' },
          { id: 'tc-read-2', name: 'read_file', arguments: '{"path":"two.txt"}' },
          { id: 'tc-goal-2', name: GOAL_BOOTSTRAP_TOOL_NAME, arguments: '{"action":"complete"}' },
          { id: 'tc-read-3', name: 'read_file', arguments: '{"path":"three.txt"}' },
          { id: 'tc-goal-3', name: GOAL_BOOTSTRAP_TOOL_NAME, arguments: '{"action":"complete"}' },
          { id: 'tc-read-4', name: 'read_file', arguments: '{"path":"four.txt"}' },
        ],
        groundedRequestScopedTools: serialTools,
        availableToolNames: new Set(['read_file', GOAL_BOOTSTRAP_TOOL_NAME]),
        controlGraphGoals: [
          {
            id: 'g1',
            title: 'Goal',
            status: 'active',
            completionPolicy: 'blocking',
            dependencies: [],
            evidence: [],
            successCriteria: ['evidence.tool:read_file'],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );

    expect(mockedExecuteToolCallLifecycle).toHaveBeenCalledTimes(6);
    expect(outcomes).toHaveLength(7);
    expect(outcomes[6]?.toolCallId).toBe('tc-read-4');
    expect(outcomes[6]?.toolMessage.isError).toBe(true);
    expect(outcomes[6]?.toolMessage.content).toContain('critical_loop_detected');
  });
});
