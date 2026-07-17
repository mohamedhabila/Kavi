jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { resolvePreparedAgentControlGraphModelTurnResult } from '../../src/engine/graph/iterationModelTurnResolution';
import {
  buildModelTurnMemoryPolicyBinding,
  POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
} from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import { initializeMemoryPolicyObservation } from '../../src/services/memory/policy';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { captureCurrentModelTurnMemoryFence } from '../helpers/modelTurnMemoryAuthority';

beforeEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
  initializeMemoryPolicyObservation();
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
});

describe('resolvePreparedAgentControlGraphModelTurnResult', () => {
  it('hands only the earliest discovery call to tool execution', async () => {
    const applyAgentControlGraphEvents = jest.fn();
    const executePendingToolTurn = jest.fn().mockResolvedValue('continued');
    const status = await resolvePreparedAgentControlGraphModelTurnResult({
      iterationParams: {
        iteration: 3,
        graph: {
          getCurrentTurnDirectives: () => ({}),
          applyAgentControlGraphEvents,
        },
      } as any,
      modelTurnPreparation: {} as any,
      runtime: {
        workingMessages: [],
        consecutivePendingAsyncNoToolTurns: 0,
      } as any,
      fullContent: '',
      memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
      reasoning: '',
      pendingToolCalls: [
        { id: 'tc-memory', name: 'memory_recall', arguments: '{}' },
        { id: 'tc-catalog-1', name: 'tool_catalog', arguments: '{"query":"memory_recall"}' },
        { id: 'tc-catalog-2', name: 'tool_catalog', arguments: '{"query":"memory_remember"}' },
      ],
      contextWindow: 100_000,
      requestMaxTokens: 2048,
      executePendingToolTurn,
    });

    expect(status).toBe('continued');
    expect(applyAgentControlGraphEvents).not.toHaveBeenCalled();
    expect(executePendingToolTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        pendingToolCalls: [
          { id: 'tc-catalog-1', name: 'tool_catalog', arguments: '{"query":"memory_recall"}' },
        ],
      }),
    );
  });

  it('does not commit continuation state when memory authority expires during the UI yield', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    const applyAgentControlGraphEvents = jest.fn();
    const recordTurnDirectives = jest.fn();
    const workingMessages: any[] = [];

    await expect(
      resolvePreparedAgentControlGraphModelTurnResult({
        iterationParams: {
          iteration: 4,
          allTools: [],
          trackedAsyncOperations: new Map(),
          callbacks: { onStateChange: jest.fn() },
          toolRuntime: { toolCallHistory: [] },
          yieldToUiFrame: jest.fn(async () => {
            useSettingsStore.setState({ disableLongTermMemory: true });
          }),
          graph: {
            getCurrentTurnDirectives: () => ({
              forceFinalText: false,
              requireWorkflowTool: false,
              incompleteFinalTextRecoveryCount: 0,
            }),
            getGraphSnapshot: () => createInitialAgentControlGraphSnapshot(),
            applyAgentControlGraphEvents,
            resetIncompleteFinalTextRecovery: jest.fn(),
            recordTurnDirectives,
            finishWithGraphFinalCandidateEvent: jest.fn(),
            finishWithGraphTerminalEvent: jest.fn(),
          },
        } as any,
        modelTurnPreparation: {
          effectiveForceTextThisTurn: false,
          requestModel: 'test-model',
          toolingEnabledForProvider: true,
          preparedTurn: { selectedTools: [] },
        } as any,
        runtime: {
          workingMessages,
          consecutivePendingAsyncNoToolTurns: 0,
        } as any,
        fullContent: 'PARTIAL_MEMORY_DERIVED_TEXT',
        memoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
        reasoning: '',
        completion: { completionStatus: 'incomplete', finishReason: 'length' },
        pendingToolCalls: [],
        contextWindow: 100_000,
        requestMaxTokens: 2048,
        executePendingToolTurn: jest.fn(),
      }),
    ).rejects.toThrow('memory_prompt_epoch_expired');

    const graphEvents = applyAgentControlGraphEvents.mock.calls.flatMap(([events]) => events);
    expect(graphEvents).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'MODEL_TURN_COMPLETED' }),
        expect.objectContaining({ type: 'FINALIZATION_HELD' }),
      ]),
    );
    expect(recordTurnDirectives).not.toHaveBeenCalled();
    expect(workingMessages).toEqual([]);
  });

  it('does not deliver a final answer when graph publication revokes its memory authority', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    const finishWithGraphFinalCandidateEvent = jest.fn();
    const applyAgentControlGraphEvents = jest.fn((events: Array<{ type: string }>) => {
      if (events.some((event) => event.type === 'MODEL_TURN_COMPLETED')) {
        useSettingsStore.setState({ disableLongTermMemory: true });
      }
    });

    await expect(
      resolvePreparedAgentControlGraphModelTurnResult({
        iterationParams: {
          iteration: 2,
          allTools: [],
          trackedAsyncOperations: new Map(),
          callbacks: { onStateChange: jest.fn() },
          toolRuntime: { toolCallHistory: [] },
          yieldToUiFrame: jest.fn(),
          graph: {
            getCurrentTurnDirectives: () => ({
              forceFinalText: false,
              requireWorkflowTool: false,
              incompleteFinalTextRecoveryCount: 0,
            }),
            getGraphSnapshot: () => createInitialAgentControlGraphSnapshot(),
            applyAgentControlGraphEvents,
            resetIncompleteFinalTextRecovery: jest.fn(),
            recordTurnDirectives: jest.fn(),
            finishWithGraphFinalCandidateEvent,
            finishWithGraphTerminalEvent: jest.fn(),
          },
        } as any,
        modelTurnPreparation: {
          effectiveForceTextThisTurn: false,
          requestModel: 'test-model',
          toolingEnabledForProvider: true,
          preparedTurn: { selectedTools: [] },
        } as any,
        runtime: {
          workingMessages: [],
          consecutivePendingAsyncNoToolTurns: 0,
        } as any,
        fullContent: 'A final answer grounded in recalled memory.',
        memoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
        reasoning: '',
        completion: { completionStatus: 'complete', finishReason: 'stop' },
        pendingToolCalls: [],
        contextWindow: 100_000,
        requestMaxTokens: 2048,
        executePendingToolTurn: jest.fn(),
      }),
    ).rejects.toThrow('memory_prompt_epoch_expired');

    expect(finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
  });

  it('does not deliver a final answer at exact memory-expiry equality', async () => {
    const validUntil = Date.now() + 10_000;
    let observedAt = validUntil - 1;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => observedAt);
    const memoryFence = {
      ...captureCurrentModelTurnMemoryFence(),
      validUntil,
    };
    const finishWithGraphFinalCandidateEvent = jest.fn(
      async (params: { beforeAssistantDelivery?: () => void }) => {
        observedAt = validUntil;
        params.beforeAssistantDelivery?.();
      },
    );

    try {
      await expect(
        resolvePreparedAgentControlGraphModelTurnResult({
          iterationParams: {
            iteration: 2,
            allTools: [],
            trackedAsyncOperations: new Map(),
            callbacks: { onStateChange: jest.fn() },
            toolRuntime: { toolCallHistory: [] },
            yieldToUiFrame: jest.fn(),
            graph: {
              getCurrentTurnDirectives: () => ({
                forceFinalText: false,
                requireWorkflowTool: false,
                incompleteFinalTextRecoveryCount: 0,
              }),
              getGraphSnapshot: () => createInitialAgentControlGraphSnapshot(),
              applyAgentControlGraphEvents: jest.fn(),
              resetIncompleteFinalTextRecovery: jest.fn(),
              recordTurnDirectives: jest.fn(),
              finishWithGraphFinalCandidateEvent,
              finishWithGraphTerminalEvent: jest.fn(),
            },
          } as any,
          modelTurnPreparation: {
            effectiveForceTextThisTurn: false,
            requestModel: 'test-model',
            toolingEnabledForProvider: true,
            preparedTurn: { selectedTools: [] },
          } as any,
          runtime: {
            workingMessages: [],
            consecutivePendingAsyncNoToolTurns: 0,
          } as any,
          fullContent: 'A final answer grounded in recalled memory.',
          memoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
          reasoning: '',
          completion: { completionStatus: 'complete', finishReason: 'stop' },
          pendingToolCalls: [],
          contextWindow: 100_000,
          requestMaxTokens: 2048,
          executePendingToolTurn: jest.fn(),
        }),
      ).rejects.toThrow('memory_prompt_epoch_expired');
    } finally {
      nowSpy.mockRestore();
    }

    expect(finishWithGraphFinalCandidateEvent).toHaveBeenCalledTimes(1);
  });
});
jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});
