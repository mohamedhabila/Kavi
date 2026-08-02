jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import { executeTool } from '../../src/engine/tools';
import type { ToolExecutionLifecycleParams } from '../../src/engine/toolExecution/toolCallLifecycleTypes';
import type { ToolDefinition } from '../../src/types/tool';
import type { VerifiedProcedureExecutionSession } from '../../src/services/memory/verifiedProcedure/executionSession';
import * as toolOutputSpill from '../../src/engine/tools/toolOutputSpill';
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
      completedToolOutcome(JSON.stringify({ status: 'created_verified', eventId: 'event-1' })),
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
        executionRunId: 'execution-run-uncontracted-1',
      }),
    );

    expect(onToolCallComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        effectReceipts: [
          expect.objectContaining({
            executionRunId: 'execution-run-uncontracted-1',
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

  it('preserves the primary receipt when the awaited procedure observer fails unexpectedly', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      completedToolOutcome(JSON.stringify({ status: 'created_verified', eventId: 'event-1' })),
    );
    const markReconciliationRequired = jest.fn();
    const verifiedProcedureSession = {
      observeRawOutcome: jest.fn().mockRejectedValue(new Error('observer unavailable')),
      markReconciliationRequired,
    } as unknown as VerifiedProcedureExecutionSession;

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
        executionRunId: 'execution-run-1',
        verifiedProcedureSession,
      }),
    );

    expect(result.effectReceipt).toEqual(
      expect.objectContaining({
        executionRunId: 'execution-run-1',
        effectKind: 'calendar.create',
        effectState: 'applied',
        verificationState: 'verified',
      }),
    );
    expect(result.toolMessage.isError).not.toBe(true);
    expect(markReconciliationRequired).toHaveBeenCalledTimes(1);
  });

  it('awaits raw procedure observation before lifecycle completion', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      completedToolOutcome(JSON.stringify({ status: 'created_verified', eventId: 'event-1' })),
    );
    let releaseObserver!: () => void;
    let observerStarted!: () => void;
    const observerStartedPromise = new Promise<void>((resolve) => {
      observerStarted = resolve;
    });
    const verifiedProcedureSession = {
      observeRawOutcome: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseObserver = resolve;
            observerStarted();
          }),
      ),
      markReconciliationRequired: jest.fn(),
    } as unknown as VerifiedProcedureExecutionSession;
    let completed = false;
    const execution = executeToolCallLifecycle(
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
        executionRunId: 'execution-run-1',
        verifiedProcedureSession,
      }),
    ).then((value) => {
      completed = true;
      return value;
    });

    await observerStartedPromise;
    expect(completed).toBe(false);
    releaseObserver();
    const result = await execution;

    expect(result.effectReceipt).toEqual(
      expect.objectContaining({
        effectState: 'applied',
        verificationState: 'verified',
      }),
    );
    expect(result.toolMessage.isError).not.toBe(true);
  });

  it('observes authoritative raw output before spill transforms model-visible content', async () => {
    const rawResult = JSON.stringify({
      status: 'created_verified',
      eventId: 'event-raw',
      calendarId: 'calendar-raw',
      privatePayload: 'RAW-ONLY-EVIDENCE',
    });
    const spilledPayload = JSON.stringify({ status: 'spilled', path: '.kavi/spill/result.txt' });
    mockedExecuteTool.mockResolvedValueOnce(completedToolOutcome(rawResult));
    jest.spyOn(toolOutputSpill, 'maybeSpillToolOutput').mockResolvedValueOnce({
      spilled: true,
      path: '.kavi/spill/result.txt',
      byteLength: rawResult.length,
      preview: 'redacted preview',
      payload: spilledPayload,
    });
    const observeRawOutcome = jest.fn().mockResolvedValue(undefined);
    const verifiedProcedureSession = {
      observeRawOutcome,
      markReconciliationRequired: jest.fn(),
    } as unknown as VerifiedProcedureExecutionSession;

    const result = await executeToolCallLifecycle(
      buildLifecycle({
        tc: {
          id: 'tc-calendar-create',
          name: calendarCreateTool.name,
          arguments: JSON.stringify({
            title: 'Planning',
            startDate: '2026-06-14T09:00:00',
            endDate: '2026-06-14T10:00:00',
            calendarId: 'calendar-raw',
          }),
        },
        executionRunId: 'execution-run-raw-seam',
        verifiedProcedureSession,
      }),
    );

    expect(observeRawOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        resultText: rawResult,
        receipt: expect.objectContaining({ resultDigest: expect.stringMatching(/^sha256:/u) }),
      }),
    );
    expect(result.result).toBe(spilledPayload);
    expect(result.result).not.toContain('RAW-ONLY-EVIDENCE');
  });

  it('records a code-owned workspace artifact ref and digest end to end', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      completedToolOutcome(
        JSON.stringify({
          status: 'written',
          path: 'reports/final.md',
          size: 4,
          sha256: 'a'.repeat(64),
        }),
      ),
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

  it.each([
    ['javascript', 'applied', 'verified'],
    ['python', 'unknown', 'unverified'],
  ] as const)(
    'records %s interpreter completion with the appropriate effect authority',
    async (toolName, effectState, verificationState) => {
      mockedExecuteTool.mockResolvedValueOnce(
        completedToolOutcome(
          JSON.stringify({
            status: 'completed',
            workspaceMutationState: 'none_observed',
            output: '42',
          }),
        ),
      );

      const result = await executeToolCallLifecycle(codeLifecycle(toolName));

      expect(result.effectReceipt).toEqual(
        expect.objectContaining({
          transportState: 'returned',
          executionState: 'completed',
          effectKind: 'compute.execute',
          effectState,
          verificationState,
        }),
      );
      expect(result.effectReceipt?.resource).toBeUndefined();
      expect(result.effectReceipt?.operationHandle).toBeUndefined();
    },
  );

  it('keeps a returned Python timeout distinct from transport failure', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      failedToolOutcome(
        JSON.stringify({
          status: 'timed_out',
          isError: true,
          failureKind: 'timed_out',
          executionEffectState: 'none_observed',
          error: 'Python execution timed out after 1000ms',
        }),
      ),
    );

    const result = await executeToolCallLifecycle(codeLifecycle('python'));

    expect(result.toolMessage.isError).toBe(true);
    expect(result.effectReceipt).toEqual(
      expect.objectContaining({
        transportState: 'returned',
        executionState: 'timed_out',
        effectState: 'failed',
        verificationState: 'unverified',
      }),
    );
  });

  it('keeps interpreter completion when returned workspace persistence fails', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      failedToolOutcome(
        JSON.stringify({
          status: 'effect_failed',
          isError: true,
          failureKind: 'workspace_persistence_failed',
          error: 'storage unavailable',
        }),
      ),
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
