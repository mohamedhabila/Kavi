import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import { executeTool } from '../../src/engine/tools';
import { observeExternalToolResultDurability } from '../../src/services/executionJournal/externalToolDurabilityLifecycle';
import type { ToolExecutionLifecycleParams } from '../../src/engine/toolExecution/toolCallLifecycleTypes';
import { completedToolOutcome, failedToolOutcome } from '../../src/types/toolRuntimeOutcome';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';

jest.mock('../../src/services/events/bus', () => ({ emitAgentEvent: jest.fn() }));
jest.mock('../../src/engine/tools', () => ({ executeTool: jest.fn() }));
jest.mock('../../src/services/executionJournal/externalToolDurabilityLifecycle', () => {
  const actual = jest.requireActual(
    '../../src/services/executionJournal/externalToolDurabilityLifecycle',
  );
  return {
    ...actual,
    observeExternalToolResultDurability: jest.fn(),
  };
});

const mockedExecuteTool = jest.mocked(executeTool);
const mockedObserveDurability = jest.mocked(observeExternalToolResultDurability);

function lifecycle(onToolCallComplete = jest.fn()): ToolExecutionLifecycleParams {
  return {
    tc: {
      id: 'tool-call-build',
      name: 'expo_eas_build',
      arguments: JSON.stringify({ projectId: 'project-1', platform: 'android' }),
    },
    iteration: 1,
    conversationId: 'conversation-1',
    provider: { id: 'p1', name: 'Test', apiKey: 'k', baseUrl: 'https://example.com', models: [] },
    model: 'test-model',
    availableToolNames: new Set(['expo_eas_build']),
    runtimeToolAvailability: {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
      hasMobileController: false,
    },
    toolCallHistory: [],
    groundedRequestScopedTools: [
      {
        name: 'expo_eas_build',
        description: 'Start an EAS build.',
        input_schema: {
          type: 'object',
          properties: { projectId: { type: 'string' } },
          required: ['projectId'],
        },
        contract: { sideEffects: ['external_run'] },
      },
    ],
    trackedAsyncOperations: new Map(),
    callbacks: { onToolCallStart: jest.fn(), onToolCallComplete },
    usePerformanceMetrics: false,
    agentRunId: 'agent-run-1',
    executionRunId: 'execution-run-1',
    modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
    idPrefixes: {
      blocked: 'blocked',
      filtered: 'filtered',
      workflow: 'workflow',
      cancelled: 'cancelled',
      success: 'tool',
      error: 'error',
    },
  };
}

describe('tool call external durability boundary', () => {
  beforeEach(() => {
    mockedExecuteTool.mockReset();
    mockedObserveDurability.mockReset();
  });

  it('persists and schedules from the raw result before completing the tool call', async () => {
    const rawResult = JSON.stringify({
      mode: 'eas-workflow',
      workflowRun: { id: 'workflow-1', status: 'NEW' },
    });
    mockedExecuteTool.mockResolvedValueOnce(completedToolOutcome(rawResult));
    mockedObserveDurability.mockResolvedValueOnce({
      kind: 'persisted',
      observation: {
        kind: 'created',
        runId: 'external-run-1',
        handleId: 'handle-1',
        status: 'pending',
        terminal: false,
      },
      scheduling: { kind: 'scheduled', runId: 'external-run-1' },
      remote: { provider: 'expo', target: 'project-1', workflowRunId: 'workflow-1' },
    });
    const onToolCallComplete = jest.fn();

    const result = await executeToolCallLifecycle(lifecycle(onToolCallComplete));

    expect(mockedObserveDurability).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'expo_eas_build',
        toolCallId: 'tool-call-build',
        resultText: rawResult,
        conversationId: 'conversation-1',
        parentAgentRunId: 'agent-run-1',
      }),
    );
    expect(mockedObserveDurability.mock.invocationCallOrder[0]).toBeLessThan(
      onToolCallComplete.mock.invocationCallOrder[0],
    );
    expect(result.toolMessage.isError).not.toBe(true);
  });

  it('returns a no-retry failure when a launched run cannot be journaled', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      completedToolOutcome(
        JSON.stringify({
          mode: 'github-workflow',
          workflowRun: { id: 12345, status: 'queued' },
        }),
      ),
    );
    mockedObserveDurability.mockResolvedValueOnce({
      kind: 'persistence_failed',
      reason: 'journal_unavailable',
      remote: { provider: 'github', target: 'openai/kavi', workflowRunId: '12345' },
    });

    const result = await executeToolCallLifecycle(lifecycle());

    expect(result.toolMessage.isError).toBe(true);
    expect(result.toolMessage.content).toContain('Do not retry this launch automatically');
    expect(result.toolMessage.content).toContain('github workflow 12345');
  });

  it('does not observe executor-declared failures as durable launches', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      failedToolOutcome(JSON.stringify({ status: 'error', error: 'dispatch rejected' })),
    );

    const result = await executeToolCallLifecycle(lifecycle());

    expect(mockedObserveDurability).not.toHaveBeenCalled();
    expect(result.toolMessage.isError).toBe(true);
  });
});
