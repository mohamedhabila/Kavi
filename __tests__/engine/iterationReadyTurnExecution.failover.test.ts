import { createFailoverState } from '../../src/engine/failover';
import { prepareAgentTurn } from '../../src/engine/graph/agentTurnPreparation';
import { executePreparedAgentControlGraphTurn } from '../../src/engine/graph/iterationReadyTurnExecution';
import { resolveModelTurnIterationRequest } from '../../src/engine/graph/modelTurn/resolveIterationRequest';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { buildGraphEntryRequestFrame } from '../../src/engine/graph/requestEntrySignals';
import type { AgentControlTurnDirectives } from '../../src/engine/graph/agentControlGraph';
import type { LlmProviderConfig } from '../../src/types/provider';
import type { ToolDefinition } from '../../src/types/tool';
import { createAgentRunAbortError } from '../../src/services/runtimeError';

const mockExecuteAgentControlGraphModelTurn = jest.fn();
const mockResolvePreparedAgentControlGraphModelTurnResult = jest.fn();

jest.mock('../../src/engine/graph/modelTurnExecution', () => ({
  executeAgentControlGraphModelTurn: (...args: unknown[]) =>
    mockExecuteAgentControlGraphModelTurn(...args),
}));

jest.mock('../../src/engine/graph/iterationModelTurnResolution', () => ({
  resolvePreparedAgentControlGraphModelTurnResult: (...args: unknown[]) =>
    mockResolvePreparedAgentControlGraphModelTurnResult(...args),
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn().mockResolvedValue(null),
}));

const primaryProvider: LlmProviderConfig = {
  id: 'primary',
  name: 'Primary',
  baseUrl: 'https://primary.example.test/v1',
  model: 'primary-model',
  enabled: true,
};

const backupProvider: LlmProviderConfig = {
  id: 'backup',
  name: 'Backup',
  baseUrl: 'https://backup.example.test/v1',
  model: 'backup-model',
  enabled: true,
};

const recoveryDirectives: AgentControlTurnDirectives = {
  forceFinalText: true,
  forcedTextReason: 'empty_delivery_recovery',
  requireWorkflowTool: false,
  maxTokensOverride: 8192,
  incompleteFinalTextRecoveryCount: 1,
};

const writeTool: ToolDefinition = {
  name: 'write_file',
  description: 'Write a file.',
  input_schema: { type: 'object', properties: {} },
};

function buildParams() {
  const consumeOneShotTurnDirectives = jest.fn();
  const graph = {
    applyAgentControlGraphEvents: jest.fn(),
    completedWorkflowToolNames: new Set<string>(),
    consumeOneShotTurnDirectives,
    finishCancelled: jest.fn(),
    finishExistingTerminalSession: jest.fn(),
    finishFailure: jest.fn(),
    finishWithGraphFinalCandidateEvent: jest.fn(),
    finishWithGraphTerminalEvent: jest.fn(),
    getCurrentTurnDirectives: jest.fn(() => recoveryDirectives),
    getGraphSnapshot: jest.fn(() => ({ goals: [] })),
    publishWorkflowToolResultProgressToAgentControlGraph: jest.fn(),
    recordPerformanceMetrics: jest.fn(),
    recordObservability: jest.fn(),
    recordPostToolFinalTextDirective: jest.fn(),
    recordTurnDirectives: jest.fn(),
    resetIncompleteFinalTextRecovery: jest.fn(),
    syncPendingAsyncOperationsToGraph: jest.fn(),
  };
  const runtime = {
    activeModel: primaryProvider.model,
    activeProvider: primaryProvider,
    admittedMemoryContext: { livingMemory: null },
    consecutivePendingAsyncNoToolTurns: 0,
    lastPendingAsyncSignature: '',
    llm: {} as never,
    warningInjectedThisRound: false,
    workingMessages: [],
  };

  return {
    consumeOneShotTurnDirectives,
    params: {
      iterationParams: {
        allProviders: [primaryProvider, backupProvider],
        allTools: [writeTool],
        callbacks: {
          onAssistantMessage: jest.fn(),
          onStateChange: jest.fn(),
          onToken: jest.fn(),
          onToolCallStart: jest.fn(),
          onToolCallComplete: jest.fn(),
          onToolMessage: jest.fn(),
        },
        compactionEngine: null,
        conversationId: 'conversation-failover',
        failoverState: createFailoverState(
          [
            { providerId: primaryProvider.id, model: primaryProvider.model, priority: 0 },
            { providerId: backupProvider.id, model: backupProvider.model, priority: 1 },
          ],
          { providerId: primaryProvider.id, model: primaryProvider.model },
        ),
        graph,
        isSuperAgent: true,
        iteration: 2,
        maxToolIterations: 6,
        maxTokens: 4096,
        promptContextSupport: {
          maxToolIterations: 6,
          resolvedPrompt: 'System prompt',
          runtimeContext: null,
          skillPrompts: '',
        },
        reportUsage: jest.fn(),
        requestFrame: buildGraphEntryRequestFrame({
          text: 'Return the recovered answer.',
          attachmentCount: 0,
          mode: 'agentic',
          continuation: 'new',
        }),
        runtime,
        thinkingLevel: 'off',
        toolRuntime: {
          availableToolNames: new Set([writeTool.name]),
          memoryConversationId: 'conversation-failover',
          runtimeToolAvailability: {},
          toolCallHistory: [],
          stagnationSignatures: [],
        },
        trackedAsyncOperations: new Map(),
        warn: jest.fn(),
        yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
      },
      modelTurnPreparation: {
        effectiveForceTextThisTurn: true,
        effectiveForceTextReasonThisTurn: 'empty_delivery_recovery',
        iterationThinkingLevel: 'off',
        pendingAsyncMonitorToolNames: new Set<string>(),
        preparedTurn: {
          enrichedSystemPrompt: 'Forced text only',
          enrichedSystemPromptSections: [],
          pinnedToolNames: [],
          selectedToolTokenEstimate: 0,
          selectedTools: [],
          toolsForIteration: undefined,
        },
        requestMaxTokens: 8192,
        requestModel: primaryProvider.model,
        toolingEnabledForProvider: true,
        toolSurfacePinTelemetry: {
          sessionPinnedCount: 0,
          turnPinnedCount: 0,
        },
      },
      runtime,
    } as Parameters<typeof executePreparedAgentControlGraphTurn>[0],
  };
}

describe('prepared graph turn directive consumption', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolvePreparedAgentControlGraphModelTurnResult.mockResolvedValue('continued');
  });

  it('retains forced-text and token directives when the provider fails over', async () => {
    mockExecuteAgentControlGraphModelTurn.mockRejectedValueOnce(
      new Error('LLM API error 503: provider unavailable'),
    );
    const fixture = buildParams();

    const result = await executePreparedAgentControlGraphTurn(fixture.params);

    expect(result.status).toBe('continued');
    expect(result.runtime.activeProvider.id).toBe(backupProvider.id);
    expect(result.runtime.activeModel).toBe(backupProvider.model);
    expect(fixture.consumeOneShotTurnDirectives).not.toHaveBeenCalled();

    const retainedDirectives = fixture.params.iterationParams.graph.getCurrentTurnDirectives();
    expect(retainedDirectives).toMatchObject({
      forceFinalText: true,
      forcedTextReason: 'empty_delivery_recovery',
      maxTokensOverride: 8192,
    });

    const alternateRequest = resolveModelTurnIterationRequest({
      activeModel: result.runtime.activeModel,
      activeProvider: result.runtime.activeProvider,
      iteration: 3,
      maxTokens: 4096,
      requestFrame: fixture.params.iterationParams.requestFrame,
      thinkingLevel: 'off',
      turnDirectives: retainedDirectives,
      workingMessages: [],
    });
    const alternatePreparedTurn = prepareAgentTurn({
      allowSessionCoordinationTools: true,
      effectiveForceTextThisTurn: alternateRequest.effectiveForceTextThisTurn,
      groundedRequestScopedTools: [writeTool],
      promptBundleContext: {
        effectiveForceTextReasonThisTurn: alternateRequest.effectiveForceTextReasonThisTurn,
        groundedRequestScopedTools: [writeTool],
        iteration: 3,
        maxToolIterations: 6,
        resolvedPrompt: 'System prompt',
        runtimeContext: null,
        skillPrompts: '',
      },
      toolingEnabledForProvider: alternateRequest.toolingEnabledForProvider,
    });

    expect(alternateRequest.effectiveForceTextThisTurn).toBe(true);
    expect(alternateRequest.effectiveForceTextReasonThisTurn).toBe('empty_delivery_recovery');
    expect(alternateRequest.requestMaxTokens).toBe(8192);
    expect(alternatePreparedTurn.selectedTools).toEqual([]);
    expect(alternatePreparedTurn.toolsForIteration).toBeUndefined();
  });

  it('consumes one-shot directives after a successful model turn', async () => {
    mockExecuteAgentControlGraphModelTurn.mockResolvedValueOnce({
      completion: { completionStatus: 'complete', finishReason: 'stop' },
      contextWindow: 8192,
      fullContent: 'Recovered answer.',
      memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
      pendingToolCalls: [],
      providerReplay: undefined,
      reasoning: '',
      requestMaxTokens: 8192,
      workingMessages: [],
    });
    const fixture = buildParams();

    await executePreparedAgentControlGraphTurn(fixture.params);

    expect(fixture.consumeOneShotTurnDirectives).toHaveBeenCalledTimes(1);
    expect(fixture.consumeOneShotTurnDirectives).toHaveBeenCalledWith('model_turn_completed');
    expect(mockResolvePreparedAgentControlGraphModelTurnResult).toHaveBeenCalledTimes(1);
  });

  it('does not fail over a code-owned cancellation whose text resembles a transport failure', async () => {
    const cancellation = createAgentRunAbortError('Network request failed');
    mockExecuteAgentControlGraphModelTurn.mockRejectedValueOnce(cancellation);
    const fixture = buildParams();

    await expect(executePreparedAgentControlGraphTurn(fixture.params)).rejects.toBe(cancellation);

    expect(fixture.params.runtime.activeProvider.id).toBe(primaryProvider.id);
    expect(fixture.consumeOneShotTurnDirectives).not.toHaveBeenCalled();
  });

  it('does not fail over after the exact admitted execution signal is aborted', async () => {
    const providerError = new Error('Failed to fetch');
    mockExecuteAgentControlGraphModelTurn.mockRejectedValueOnce(providerError);
    const fixture = buildParams();
    const signal = new AbortController();
    signal.abort(new Error('Stopped by the user.'));
    fixture.params.iterationParams.signal = signal;

    await expect(executePreparedAgentControlGraphTurn(fixture.params)).rejects.toBe(providerError);

    expect(fixture.params.runtime.activeProvider.id).toBe(primaryProvider.id);
    expect(fixture.consumeOneShotTurnDirectives).not.toHaveBeenCalled();
  });
});
