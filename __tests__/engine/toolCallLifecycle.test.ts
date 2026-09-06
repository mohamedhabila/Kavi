// ---------------------------------------------------------------------------
// Tests — executeToolCallLifecycle core control flow and failureKind
// classification.
//
// Effect-receipt capture, verified-procedure observation, durability, and
// interpreter effect-state coverage lives in the sibling suite
// toolCallLifecycle.effectReceipts.test.ts (split out to stay under the
// project's maintainability line limit). Both share the same lifecycle
// fixture-builder shape by convention with the other toolCallLifecycle.*.test.ts
// files in this directory.
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import { executeTool } from '../../src/engine/tools';
import type { ToolExecutionLifecycleParams } from '../../src/engine/toolExecution/toolCallLifecycleTypes';
import type { ToolDefinition } from '../../src/types/tool';
import { completedToolOutcome, failedToolOutcome } from '../../src/types/toolRuntimeOutcome';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { MOBILE_UI_ACTION_TOOL_DEFINITION } from '../../src/engine/mobileController/toolDefinition';
import { createPersistedMobileControllerHandoffFixture } from '../helpers/mobileControllerHandoffFixture';

jest.mock('../../src/services/events/bus', () => ({
  emitAgentEvent: jest.fn(),
}));

jest.mock('../../src/engine/tools', () => ({
  executeTool: jest.fn(),
}));

const mockedExecuteTool = jest.mocked(executeTool);

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
    batchIndex: 0,
    conversationId: 'conv-1',
    memoryConversationId: 'memory-conv-1',
    executionRunId: 'execution-run-1',
    modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
    provider: { id: 'p1', name: 'Test', apiKey: 'k', baseUrl: 'https://example.com', models: [] },
    model: 'test-model',
    availableToolNames: new Set(['calendar_create_event']),
    runtimeToolAvailability: {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
      hasMobileController: false,
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
  });

  it('keeps a deferred mobile action running without emitting a tool result', async () => {
    const deferredHandoff = createPersistedMobileControllerHandoffFixture();
    mockedExecuteTool.mockResolvedValueOnce({
      status: 'deferred',
      deferredHandoff,
      effectDispatchObservation: {
        kind: 'deferred',
        handoff: deferredHandoff.handoffRef,
      },
    });
    const onToolCallStart = jest.fn();
    const onToolCallComplete = jest.fn();
    const toolCallHistory: ToolExecutionLifecycleParams['toolCallHistory'] = [];

    const result = await executeToolCallLifecycle(
      buildLifecycle({
        tc: {
          id: deferredHandoff.handoffRef.toolCallId,
          name: 'mobile_ui_action',
          arguments: JSON.stringify(deferredHandoff.handoff.action),
        },
        agentRunId: 'agent-run-mobile-1',
        executionRunId: deferredHandoff.handoffRef.executionRunId,
        availableToolNames: new Set(['mobile_ui_action']),
        groundedRequestScopedTools: [MOBILE_UI_ACTION_TOOL_DEFINITION],
        runtimeToolAvailability: {
          hasWorkspaceTargets: false,
          hasBrowserControllableWorkspaceTargets: false,
          hasDelegableWorkspaceTargets: false,
          hasMobileController: true,
        },
        toolCallHistory,
        callbacks: { onToolCallStart, onToolCallComplete },
      }),
    );

    expect(result).toEqual({
      toolCallId: deferredHandoff.handoffRef.toolCallId,
      effectiveToolName: 'mobile_ui_action',
      deferredHandoff,
      effectDispatchObservation: {
        kind: 'deferred',
        handoff: deferredHandoff.handoffRef,
      },
    });
    expect('toolMessage' in result).toBe(false);
    expect(onToolCallStart).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running', name: 'mobile_ui_action' }),
    );
    expect(onToolCallComplete).not.toHaveBeenCalled();
    expect(toolCallHistory).toEqual([]);
  });

  it('awaits the code-owned scheduler fence before effectful tool dispatch', async () => {
    let releaseFence!: () => void;
    const beforeEffectDispatch = jest.fn(
      () => new Promise<void>((resolve) => (releaseFence = resolve)),
    );
    mockedExecuteTool.mockResolvedValueOnce(
      completedToolOutcome(JSON.stringify({ status: 'created_verified', eventId: 'event-1' })),
    );

    const pending = executeToolCallLifecycle(
      buildLifecycle({
        tc: {
          id: 'tc-calendar-create',
          name: 'calendar_create_event',
          arguments: JSON.stringify({
            title: 'Planning',
            startDate: '2026-06-14T09:00:00',
            endDate: '2026-06-14T10:00:00',
          }),
        },
        beforeEffectDispatch,
      }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 25));

    expect(beforeEffectDispatch).toHaveBeenCalledWith('calendar_create_event');
    expect(mockedExecuteTool).not.toHaveBeenCalled();

    releaseFence();
    await pending;
    expect(mockedExecuteTool).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the pre-effect scheduler fence cannot persist', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      completedToolOutcome(JSON.stringify({ status: 'created_verified', eventId: 'event-1' })),
    );

    await expect(
      executeToolCallLifecycle(
        buildLifecycle({
          tc: {
            id: 'tc-calendar-create',
            name: 'calendar_create_event',
            arguments: JSON.stringify({
              title: 'Planning',
              startDate: '2026-06-14T09:00:00',
              endDate: '2026-06-14T10:00:00',
            }),
          },
          beforeEffectDispatch: jest.fn().mockRejectedValue(new Error('fence unavailable')),
        }),
      ),
    ).rejects.toThrow('fence unavailable');
    expect(mockedExecuteTool).not.toHaveBeenCalled();
  });

  it('passes the code-owned current user message only through execution context', async () => {
    mockedExecuteTool.mockResolvedValueOnce(completedToolOutcome('{}'));
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
      failedToolOutcome(
        JSON.stringify({
          status: 'error',
          code: 'missing_required_argument',
          tool: 'calendar_create_event',
          missingRequiredArguments: ['title'],
          error: 'Missing required argument(s): title',
        }),
      ),
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
    // Preflight schema validation blocks this before the (mocked) executor is ever
    // called, so the structured kind comes from the argument validator.
    expect(result.toolMessage.toolCalls?.[0]).toEqual(
      expect.objectContaining({
        name: 'calendar_create_event',
        status: 'failed',
        failureKind: 'invalid_arguments',
      }),
    );
  });

  it('propagates the executor-supplied failureKind unchanged, regardless of result text', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      failedToolOutcome(JSON.stringify({ error: 'La conexión ha caducado.' }), 'timeout'),
    );
    // Valid arguments so preflight schema validation does not short-circuit before
    // the (mocked) executor's own classification is ever consulted.
    const result = await executeToolCallLifecycle(
      buildLifecycle({
        tc: {
          id: 'tc-calendar-create',
          name: 'calendar_create_event',
          arguments: JSON.stringify({
            title: 'Planning',
            startDate: '2026-06-14T09:00:00',
            endDate: '2026-06-14T10:00:00',
          }),
        },
      }),
    );
    expect(result.toolMessage.toolCalls?.[0]).toEqual(
      expect.objectContaining({ status: 'failed', failureKind: 'timeout' }),
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
