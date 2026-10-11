import { executeAgentControlGraphToolBatch } from '../../src/engine/graph/toolTurnBatchExecution';
import { buildToolResultMessage } from '../../src/engine/toolExecution/toolExecutionMessages';
import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';

jest.mock('../../src/engine/toolExecution/toolCallLifecycle', () => ({
  executeToolCallLifecycle: jest.fn(),
  isDeferredToolExecutionLifecycleResult: (result: unknown) =>
    Boolean(result && typeof result === 'object' && 'deferredHandoff' in result),
}));

const mockedExecuteToolCallLifecycle = jest.mocked(executeToolCallLifecycle);

import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { createParams, readFileTool, tools, writeFileTool } from './helpers/toolTurnBatch';

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

  // The execution filter carries permission only. It used to AND the advertised surface,
  // which made a turn's guess about what would be useful an enforcement boundary at
  // dispatch — the point where the over-planning was actually applied. Traced on-device, a
  // run that needed `python` mid-task could not call it and was sent to `tool_catalog`,
  // whose result never arrived.
  it('filters execution by permission, not by what this turn advertised', async () => {
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => {
      expect(params.groundedRequestScopedTools).toEqual(tools.slice(0, 1));
      expect(params.toolFilter('web_search')).toBe(true);
      // Registered and permitted, merely unadvertised this turn: still callable.
      expect(params.toolFilter('web_fetch')).toBe(true);
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

  it('runs an effect with no goal to own it', async () => {
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

    expect(mockedExecuteToolCallLifecycle).toHaveBeenCalledTimes(1);
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

  it('interrupts a serial batch at a critical loop and returns skipped tool results', async () => {
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => {
      const result = '{"status":"written"}';
      params.toolCallHistory.push({
        name: params.tc.name,
        arguments: params.tc.arguments,
        timestamp: Date.now(),
        status: 'completed',
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
            status: 'completed',
          },
        }),
      };
    });

    const sameWrite = '{"path":"notes.txt","content":"same"}';
    const outcomes = await executeAgentControlGraphToolBatch(
      createParams({
        executableToolCalls: Array.from({ length: 7 }, (_unused, index) => ({
          id: `tc-write-${index + 1}`,
          name: 'write_file',
          arguments: sameWrite,
        })),
        groundedRequestScopedTools: [writeFileTool],
        availableToolNames: new Set(['write_file']),
        controlGraphGoals: [],
      }),
    );

    expect(mockedExecuteToolCallLifecycle).toHaveBeenCalledTimes(6);
    expect(outcomes).toHaveLength(7);
    expect(outcomes[6]?.toolCallId).toBe('tc-write-7');
    expect(outcomes[6]?.toolMessage.isError).toBe(true);
    expect(outcomes[6]?.toolMessage.content).toContain('critical_loop_detected');
  });
});
