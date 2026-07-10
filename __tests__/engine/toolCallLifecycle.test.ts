import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import { executeTool } from '../../src/engine/tools';
import { recordVerifiedToolEffectExperience } from '../../src/services/memory/verifiedToolEffectExperience';
import type { ToolExecutionLifecycleParams } from '../../src/engine/toolExecution/toolCallLifecycleTypes';
import type { ToolDefinition } from '../../src/types/tool';

jest.mock('../../src/services/events/bus', () => ({
  emitAgentEvent: jest.fn(),
}));

jest.mock('../../src/engine/tools', () => ({
  executeTool: jest.fn(),
}));

jest.mock('../../src/services/memory/verifiedToolEffectExperience', () => ({
  recordVerifiedToolEffectExperience: jest.fn(),
}));

const mockedExecuteTool = jest.mocked(executeTool);
const mockedRecordVerifiedToolEffectExperience = jest.mocked(
  recordVerifiedToolEffectExperience,
);

const calendarCreateTool: ToolDefinition = {
  name: 'calendar_create_event',
  description: 'Create a calendar event.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Event title' },
      startDate: { type: 'string', description: 'Start date/time in ISO 8601' },
      endDate: { type: 'string', description: 'End date/time in ISO 8601' },
    },
    required: ['title', 'startDate', 'endDate'],
  },
  contract: { sideEffects: ['remote_mutation'] },
};

function codeTool(name: 'javascript' | 'python'): ToolDefinition {
  return {
    name,
    description: `Execute ${name}.`,
    input_schema: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
    },
    contract: { sideEffects: ['local_artifact'] },
  };
}

function codeLifecycle(
  name: 'javascript' | 'python',
  overrides: Partial<ToolExecutionLifecycleParams> = {},
): ToolExecutionLifecycleParams {
  return buildLifecycle({
    tc: { id: `tc-${name}`, name, arguments: '{"code":"42"}' },
    availableToolNames: new Set([name]),
    groundedRequestScopedTools: [codeTool(name)],
    ...overrides,
  });
}

function buildLifecycle(
  overrides: Partial<ToolExecutionLifecycleParams> = {},
): ToolExecutionLifecycleParams {
  return {
    tc: {
      id: 'tc-calendar-create',
      name: 'calendar_create_event',
      arguments: JSON.stringify({
        startDate: '2026-06-14T09:00:00',
        endDate: '2026-06-14T10:00:00',
      }),
    },
    iteration: 1,
    conversationId: 'conv-1',
    provider: { id: 'p1', name: 'Test', apiKey: 'k', baseUrl: 'https://example.com', models: [] },
    model: 'test-model',
    availableToolNames: new Set(['calendar_create_event']),
    runtimeToolAvailability: {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
    },
    toolCallHistory: [],
    groundedRequestScopedTools: [calendarCreateTool],
    trackedAsyncOperations: new Map(),
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
    ...overrides,
  };
}

describe('executeToolCallLifecycle', () => {
  beforeEach(() => {
    mockedExecuteTool.mockReset();
    mockedRecordVerifiedToolEffectExperience.mockReset();
    mockedRecordVerifiedToolEffectExperience.mockResolvedValue({
      status: 'skipped',
      reason: 'non_terminal_outcome',
    });
  });

  it('passes the code-owned current user message only through execution context', async () => {
    mockedExecuteTool.mockResolvedValueOnce('{}');
    const currentUserMessage = { id: 'user-current', text: 'Raw current request.' };

    await executeToolCallLifecycle(codeLifecycle('javascript', { currentUserMessage }));

    expect(mockedExecuteTool).toHaveBeenCalledWith(
      'javascript',
      expect.any(String),
      'conv-1',
      expect.objectContaining({ currentUserMessage }),
    );
  });

  it('returns schema-grounded retry details for structured missing required arguments', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      JSON.stringify({
        status: 'error',
        code: 'missing_required_argument',
        tool: 'calendar_create_event',
        missingRequiredArguments: ['title'],
        error: 'Missing required argument(s): title',
      }),
    );

    const result = await executeToolCallLifecycle(buildLifecycle());
    const parsed = JSON.parse(result.toolMessage.content);

    expect(result.toolMessage.isError).toBe(true);
    expect(parsed.repair).toMatchObject({
      retryable: true,
      code: 'missing_required_argument',
      missingFields: ['title'],
      expectedShape: {
        arguments: {
          title: { type: 'string' },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
        },
      },
    });
    expect(result.toolMessage.toolCalls?.[0]).toEqual(
      expect.objectContaining({
        name: 'calendar_create_event',
        status: 'failed',
        failureKind: 'tool_error',
      }),
    );
  });

  it('records a code-owned calendar receipt without exposing it to the provider transcript', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      JSON.stringify({ status: 'created_verified', eventId: 'event-1' }),
    );
    const onToolCallComplete = jest.fn();
    const result = await executeToolCallLifecycle(
      buildLifecycle({
        tc: {
          id: 'tc-calendar-uncontracted',
          name: calendarCreateTool.name,
          arguments: JSON.stringify({
            title: 'Planning',
            startDate: '2026-06-14T09:00:00',
            endDate: '2026-06-14T10:00:00',
          }),
        },
        callbacks: {
          onToolCallStart: jest.fn(),
          onToolCallComplete,
        },
        agentRunId: 'run-uncontracted-1',
      }),
    );

    expect(onToolCallComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        effectReceipts: [
          expect.objectContaining({
            runId: 'run-uncontracted-1',
            transportState: 'returned',
            effectKind: 'calendar.create',
            effectState: 'applied',
            verificationState: 'verified',
            resource: { kind: 'calendar_event', id: 'event-1' },
          }),
        ],
      }),
    );
    expect(result.effectReceipt).toEqual(
      expect.objectContaining({
        effectState: 'applied',
        verificationState: 'verified',
      }),
    );
    expect(result.toolMessage.toolCalls?.[0]?.effectReceipts).toBeUndefined();
  });

  it('preserves the primary receipt when ancillary experience storage fails unexpectedly', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      JSON.stringify({ status: 'created_verified', eventId: 'event-1' }),
    );
    mockedRecordVerifiedToolEffectExperience.mockRejectedValueOnce(
      new Error('experience storage unavailable'),
    );

    const result = await executeToolCallLifecycle(
      buildLifecycle({
        tc: {
          id: 'tc-calendar-create',
          name: calendarCreateTool.name,
          arguments: JSON.stringify({
            title: 'Planning',
            startDate: '2026-06-14T09:00:00',
            endDate: '2026-06-14T10:00:00',
          }),
        },
        memoryConversationId: 'memory-conversation-1',
        conversationId: 'source-thread-1',
        agentRunId: 'agent-run-1',
      }),
    );

    expect(result.effectReceipt).toEqual(
      expect.objectContaining({
        runId: 'agent-run-1',
        effectKind: 'calendar.create',
        effectState: 'applied',
        verificationState: 'verified',
      }),
    );
    expect(result.toolMessage.isError).not.toBe(true);
    expect(mockedRecordVerifiedToolEffectExperience).toHaveBeenCalledWith({
      memoryConversationId: 'memory-conversation-1',
      sourceThreadId: 'source-thread-1',
      sourceRunId: 'agent-run-1',
      toolCallId: 'tc-calendar-create',
      toolName: 'calendar_create_event',
      receipt: result.effectReceipt,
    });
  });

  it('does not await an indefinitely pending experience collector', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      JSON.stringify({ status: 'created_verified', eventId: 'event-1' }),
    );
    mockedRecordVerifiedToolEffectExperience.mockReturnValueOnce(
      new Promise<never>(() => undefined),
    );

    const result = await executeToolCallLifecycle(
      buildLifecycle({
        tc: {
          id: 'tc-calendar-create',
          name: calendarCreateTool.name,
          arguments: JSON.stringify({
            title: 'Planning',
            startDate: '2026-06-14T09:00:00',
            endDate: '2026-06-14T10:00:00',
          }),
        },
        memoryConversationId: 'memory-conversation-1',
        conversationId: 'source-thread-1',
        agentRunId: 'agent-run-1',
      }),
    );

    expect(result.effectReceipt).toEqual(
      expect.objectContaining({
        effectState: 'applied',
        verificationState: 'verified',
      }),
    );
    expect(result.toolMessage.isError).not.toBe(true);
  });

  it('records a code-owned workspace artifact ref and digest end to end', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      JSON.stringify({
        status: 'written',
        path: 'reports/final.md',
        size: 4,
        sha256: 'a'.repeat(64),
      }),
    );
    const onToolCallComplete = jest.fn();
    const result = await executeToolCallLifecycle(
      buildLifecycle({
        tc: {
          id: 'tc-write-file',
          name: 'write_file',
          arguments: JSON.stringify({ path: 'reports/final.md', content: 'done' }),
        },
        availableToolNames: new Set(['write_file']),
        groundedRequestScopedTools: [
          {
            name: 'write_file',
            description: 'Write a workspace file.',
            input_schema: {
              type: 'object',
              properties: { path: { type: 'string' }, content: { type: 'string' } },
              required: ['path', 'content'],
            },
          },
        ],
        callbacks: { onToolCallStart: jest.fn(), onToolCallComplete },
      }),
    );

    expect(onToolCallComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        effectReceipts: [
          expect.objectContaining({
            effectKind: 'artifact.write',
            effectState: 'applied',
            verificationState: 'verified',
            resource: {
              kind: 'workspace_file',
              id: 'reports/final.md',
              digest: `sha256:${'a'.repeat(64)}`,
            },
          }),
        ],
      }),
    );
    expect(result.toolMessage.toolCalls?.[0]?.effectReceipts).toBeUndefined();
  });

  it.each(['javascript', 'python'] as const)(
    'records %s interpreter completion without claiming side-effect completion',
    async (toolName) => {
      mockedExecuteTool.mockResolvedValueOnce(
        JSON.stringify({
          status: 'completed',
          workspaceMutationState: 'none_observed',
          output: '42',
        }),
      );

      const result = await executeToolCallLifecycle(codeLifecycle(toolName));

      expect(result.effectReceipt).toEqual(
        expect.objectContaining({
          transportState: 'returned',
          executionState: 'completed',
          effectKind: 'compute.execute',
          effectState: 'unknown',
          verificationState: 'unverified',
        }),
      );
      expect(result.effectReceipt?.resource).toBeUndefined();
      expect(result.effectReceipt?.operationHandle).toBeUndefined();
    },
  );

  it('keeps a returned Python timeout distinct from transport failure', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      JSON.stringify({
        status: 'timed_out',
        isError: true,
        failureKind: 'timed_out',
        error: 'Python execution timed out after 1000ms',
      }),
    );

    const result = await executeToolCallLifecycle(codeLifecycle('python'));

    expect(result.toolMessage.isError).toBe(true);
    expect(result.effectReceipt).toEqual(
      expect.objectContaining({
        transportState: 'returned',
        executionState: 'timed_out',
        effectState: 'unknown',
        verificationState: 'unverified',
      }),
    );
  });

  it('keeps interpreter completion when returned workspace persistence fails', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      JSON.stringify({
        status: 'effect_failed',
        isError: true,
        failureKind: 'workspace_persistence_failed',
        error: 'storage unavailable',
      }),
    );

    const result = await executeToolCallLifecycle(codeLifecycle('javascript'));

    expect(result.toolMessage.isError).toBe(true);
    expect(result.effectReceipt).toEqual(
      expect.objectContaining({
        transportState: 'returned',
        executionState: 'completed',
        effectState: 'unknown',
        verificationState: 'unverified',
      }),
    );
  });

  it('keeps an unexpected JavaScript bridge throw execution-unknown', async () => {
    mockedExecuteTool.mockRejectedValueOnce(new Error('bridge crashed'));

    const result = await executeToolCallLifecycle(codeLifecycle('javascript'));

    expect(result.effectReceipt).toEqual(
      expect.objectContaining({
        transportState: 'threw',
        executionState: 'unknown',
        effectState: 'unknown',
        verificationState: 'unverified',
      }),
    );
  });

  it('records pre-execution Python cancellation without invoking the runtime', async () => {
    const signal = new AbortController();
    signal.abort();

    const result = await executeToolCallLifecycle(codeLifecycle('python', { signal }));

    expect(mockedExecuteTool).not.toHaveBeenCalled();
    expect(result.effectReceipt).toEqual(
      expect.objectContaining({
        transportState: 'rejected',
        executionState: 'cancelled',
        effectState: 'cancelled',
        verificationState: 'unverified',
      }),
    );
  });

  it('does not invoke an effectful runtime when its completion contract is missing', async () => {
    const blocker = JSON.stringify({
      status: 'error',
      code: 'completion_contract_required',
      tool: 'write_file',
    });
    const onToolCallStart = jest.fn();
    const onToolCallComplete = jest.fn();

    const result = await executeToolCallLifecycle(
      buildLifecycle({
        tc: {
          id: 'tc-write-blocked',
          name: 'write_file',
          arguments: '{"path":"reports/final.md","content":"done"}',
        },
        availableToolNames: new Set(['write_file']),
        groundedRequestScopedTools: [
          {
            name: 'write_file',
            description: 'Write a workspace file.',
            input_schema: {
              type: 'object',
              properties: { path: { type: 'string' }, content: { type: 'string' } },
              required: ['path', 'content'],
            },
          },
        ],
        callbacks: { onToolCallStart, onToolCallComplete },
        workflowToolCallBlocker: () => blocker,
      }),
    );

    expect(mockedExecuteTool).not.toHaveBeenCalled();
    expect(result.toolMessage.content).toBe(blocker);
    expect(result.toolMessage.isError).toBe(true);
    expect(onToolCallStart).toHaveBeenCalledTimes(1);
    expect(onToolCallComplete).toHaveBeenCalledTimes(1);
  });
});
