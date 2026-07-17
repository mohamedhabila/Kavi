jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../src/services/events/bus', () => ({
  emitAgentEvent: jest.fn(),
}));

jest.mock('../../src/engine/tools', () => ({
  executeTool: jest.fn(),
}));

import {
  buildModelTurnMemoryPolicyBinding,
  POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
} from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { createForegroundToolCallLifecycleController } from '../../src/engine/graph/foregroundRun/toolCallLifecycle';
import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import type { ToolExecutionLifecycleParams } from '../../src/engine/toolExecution/toolCallLifecycleTypes';
import { executeTool } from '../../src/engine/tools';
import { initializeMemoryPolicyObservation } from '../../src/services/memory/policy';
import { getMemoryDb } from '../../src/services/memory/database';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { ToolCall } from '../../src/types/message';
import type { ToolDefinition } from '../../src/types/tool';
import { completedToolOutcome } from '../../src/types/toolRuntimeOutcome';
import { captureCurrentModelTurnMemoryFence } from '../helpers/modelTurnMemoryAuthority';

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

describe('executeToolCallLifecycle memory authority', () => {
  beforeEach(() => {
    mockedExecuteTool.mockReset();
    useSettingsStore.setState({ disableLongTermMemory: false });
    initializeMemoryPolicyObservation();
  });

  afterEach(() => {
    useSettingsStore.setState({ disableLongTermMemory: false });
  });

  it('does not publish a running tool when cross-runtime authority is already stale', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    getMemoryDb().runSync(
      `UPDATE memory_vault_identity
          SET restrictive_authority_revision = restrictive_authority_revision + 1,
              projection_revision = projection_revision + 1
        WHERE singleton = 1`,
    );
    const onToolCallStart = jest.fn();
    const onToolCallComplete = jest.fn();

    const result = await executeToolCallLifecycle(
      buildLifecycle({
        modelTurnMemoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
        callbacks: { onToolCallStart, onToolCallComplete },
        tc: {
          id: 'tc-calendar-cross-runtime-start',
          name: 'calendar_create_event',
          arguments: JSON.stringify({
            title: 'Planning',
            startDate: '2026-06-14T09:00:00',
            endDate: '2026-06-14T10:00:00',
          }),
        },
      }),
    );

    expect(mockedExecuteTool).not.toHaveBeenCalled();
    expect(onToolCallStart).not.toHaveBeenCalled();
    expect(onToolCallComplete).not.toHaveBeenCalled();
    expect(result.toolMessage.toolCalls?.[0]).toMatchObject({
      status: 'failed',
      failureKind: 'authority_revoked',
    });
  });

  it('terminalizes a foreground running projection when authority changes during start', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    let persistedToolCall: ToolCall | undefined;
    const publishedStatuses: ToolCall['status'][] = [];
    let releaseObservation!: () => void;
    let markObservationStarted!: () => void;
    const observationStarted = new Promise<void>((resolve) => {
      markObservationStarted = resolve;
    });
    const foregroundActions = {
      addToolCall: jest.fn((_assistantMessageId: string, toolCall: ToolCall) => {
        persistedToolCall = { ...toolCall };
      }),
      addToolMessage: jest.fn(),
      appendConversationLog: jest.fn(),
      applyMessageEffect: jest.fn(),
      applyToolCompletionEffect: jest.fn(),
      applyToolStartEffect: jest.fn(),
      clearSurfacedWorkerOutputLock: jest.fn(),
      flushSurfacedWorkerOutput: jest.fn(),
      recordToolUsage: jest.fn(),
      requestPersistenceCheckpoint: jest.fn(),
      trackCounters: jest.fn(),
      updateToolCallStatus: jest.fn(
        (
          _assistantMessageId: string,
          _toolCallId: string,
          status: ToolCall['status'],
          patch: Partial<ToolCall>,
        ) => {
          persistedToolCall = { ...persistedToolCall!, ...patch, status };
        },
      ),
      upsertLiveToolCall: jest.fn((_assistantMessageId: string, toolCall: ToolCall) => {
        persistedToolCall = { ...toolCall };
      }),
    };
    const foregroundController = createForegroundToolCallLifecycleController({
      accessors: {
        getCurrentAssistantMessageId: () => 'assistant-current',
        getLiveToolCalls: () => (persistedToolCall ? [persistedToolCall] : undefined),
        getPersistedAssistantToolCalls: () => (persistedToolCall ? [persistedToolCall] : undefined),
      },
      actions: foregroundActions,
      pendingSurfacedWorkerOutputs: new Map(),
    });
    const onToolCallStart = jest.fn((toolCall: ToolCall) => {
      publishedStatuses.push(toolCall.status);
      foregroundController.startToolCall(toolCall);
      getMemoryDb().runSync(
        `UPDATE memory_vault_identity
            SET restrictive_authority_revision = restrictive_authority_revision + 1,
                projection_revision = projection_revision + 1
          WHERE singleton = 1`,
      );
    });
    const onToolCallComplete = jest.fn((toolCall: ToolCall) => {
      publishedStatuses.push(toolCall.status);
      foregroundController.completeToolCall(toolCall);
    });

    const execution = executeToolCallLifecycle(
      buildLifecycle({
        modelTurnMemoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
        callbacks: { onToolCallStart, onToolCallComplete },
        tc: {
          id: 'tc-calendar-cross-runtime-race',
          name: 'calendar_create_event',
          arguments: JSON.stringify({
            title: 'Planning',
            startDate: '2026-06-14T09:00:00',
            endDate: '2026-06-14T10:00:00',
          }),
        },
        verifiedProcedureSession: {
          markReconciliationRequired: jest.fn(),
          observeRawOutcome: jest.fn(
            () =>
              new Promise<void>((resolve) => {
                releaseObservation = resolve;
                markObservationStarted();
              }),
          ),
        } as never,
      }),
    );

    await observationStarted;
    expect(mockedExecuteTool).not.toHaveBeenCalled();
    expect(onToolCallStart).toHaveBeenCalledTimes(1);
    expect(onToolCallComplete).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', failureKind: 'authority_revoked' }),
    );
    expect(publishedStatuses).toEqual(['running', 'failed']);
    expect(persistedToolCall).toMatchObject({
      status: 'failed',
      failureKind: 'authority_revoked',
    });
    expect(foregroundActions.updateToolCallStatus).toHaveBeenCalledWith(
      'assistant-current',
      'tc-calendar-cross-runtime-race',
      'failed',
      expect.objectContaining({ completedAt: expect.any(Number) }),
    );
    releaseObservation();
    const result = await execution;
    expect(result.toolMessage.toolCalls?.[0]?.status).toBe('failed');
  });

  it('rejects an undispatched effect when its model memory authority expires', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    let releaseDispatch!: () => void;
    let markDispatchFence!: () => void;
    const dispatchFenceReached = new Promise<void>((resolve) => {
      markDispatchFence = resolve;
    });
    const beforeEffectDispatch = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseDispatch = resolve;
          markDispatchFence();
        }),
    );
    mockedExecuteTool.mockResolvedValueOnce(completedToolOutcome('{}'));
    const execution = executeToolCallLifecycle(
      buildLifecycle({
        beforeEffectDispatch,
        modelTurnMemoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
        tc: {
          id: 'tc-calendar-memory-authority',
          name: 'calendar_create_event',
          arguments: JSON.stringify({
            title: 'Planning',
            startDate: '2026-06-14T09:00:00',
            endDate: '2026-06-14T10:00:00',
          }),
        },
      }),
    );

    await dispatchFenceReached;
    useSettingsStore.setState({ disableLongTermMemory: true });
    releaseDispatch();
    const result = await execution;

    expect(mockedExecuteTool).not.toHaveBeenCalled();
    expect(JSON.parse(result.toolMessage.content)).toMatchObject({
      status: 'rejected',
      code: 'model_turn_memory_epoch_expired',
      replanRequired: true,
    });
    expect(result.toolMessage.toolCalls?.[0]?.failureKind).toBe('authority_revoked');
  });

  it('discards an effect-free result when memory authority expires in the executor', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    let releaseExecutor!: (outcome: ReturnType<typeof completedToolOutcome>) => void;
    let markExecutorStarted!: () => void;
    const executorStarted = new Promise<void>((resolve) => {
      markExecutorStarted = resolve;
    });
    mockedExecuteTool.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseExecutor = resolve;
          markExecutorStarted();
        }),
    );
    const onToolCallComplete = jest.fn();
    const execution = executeToolCallLifecycle(
      buildLifecycle({
        tc: { id: 'tc-calendar-list', name: 'calendar_list', arguments: '{}' },
        availableToolNames: new Set(['calendar_list']),
        groundedRequestScopedTools: [
          {
            name: 'calendar_list',
            description: 'List calendars.',
            input_schema: { type: 'object', properties: {} },
            contract: { sideEffects: [] },
          },
        ],
        modelTurnMemoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
        callbacks: { onToolCallStart: jest.fn(), onToolCallComplete },
      }),
    );

    await executorStarted;
    useSettingsStore.setState({ disableLongTermMemory: true });
    releaseExecutor(completedToolOutcome('STALE_EFFECT_FREE_RESULT'));
    const result = await execution;

    expect(result.result).not.toContain('STALE_EFFECT_FREE_RESULT');
    expect(JSON.parse(result.result)).toMatchObject({
      status: 'rejected',
      code: 'model_turn_memory_epoch_expired',
      replanRequired: true,
    });
    expect(onToolCallComplete).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', failureKind: 'authority_revoked' }),
    );
  });
});
