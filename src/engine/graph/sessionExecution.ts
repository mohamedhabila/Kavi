import { emitSessionEvent } from '../../services/events/bus';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import { selectAgentControlGraphRuntimeCommand } from './agentControlGraph';
import { executeAgentControlGraphIteration } from './iterationExecution';
import type {
  AgentControlGraphIterationRuntimeState,
  ExecuteAgentControlGraphIterationParams,
} from './iterationExecutionTypes';
import { isSessionMemoryReadCurrent } from '../../services/memory/memoryAccessGateway';
import { resolveNextLongHorizonIterationLimit } from './longHorizonIterationBudget';
import { GRAPH_OBSERVABILITY_AUDIT_TYPES } from './graphObservability';
import { buildRunStoppedMessage } from './runStoppedMessage';
import { deliverSteeringMessages } from './sessionSteering';

export interface ExecuteAgentControlGraphSessionParams extends Omit<
  ExecuteAgentControlGraphIterationParams,
  'iteration' | 'runtime'
> {
  allowLongHorizonIterationExtensions?: boolean;
  initialRuntime: AgentControlGraphIterationRuntimeState;
}

export async function executeAgentControlGraphSession(
  params: ExecuteAgentControlGraphSessionParams,
): Promise<void> {
  let iteration = 1;
  const iterationExtensionSize = params.maxToolIterations;
  let iterationLimit = params.maxToolIterations;
  let runtime: AgentControlGraphIterationRuntimeState = {
    ...params.initialRuntime,
    workingMessages: [...params.initialRuntime.workingMessages],
  };
  let toolRuntime = params.toolRuntime;
  const finishMaxIterationSession = async (): Promise<void> => {
    await params.graph.finishWithGraphTerminalEvent({
      graphEvent: {
        type: 'FINALIZED',
        reason: 'max_iterations',
      },
      content: buildRunStoppedMessage('step_limit', params.graph.getGraphSnapshot()?.plan),
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: 'max_iterations',
      }),
      sessionEndReason: 'max_iterations',
    });
  };

  await emitSessionEvent('start', {
    conversationId: params.conversationId,
    agentRunId: params.agentRunId,
    executionSignal: params.signal,
  });

  try {
    while (iteration <= iterationLimit) {
      const initialRuntimeCommand = selectAgentControlGraphRuntimeCommand(
        params.graph.getGraphSnapshot(),
      );
      if (initialRuntimeCommand.type === 'terminal') {
        await params.graph.finishExistingTerminalSession(initialRuntimeCommand.reason);
        return;
      }
      if (initialRuntimeCommand.type === 'blocked') {
        throw new Error(
          `Invariant violation before model turn ${iteration}: ${initialRuntimeCommand.reason}`,
        );
      }

      ({ runtime, toolRuntime } = deliverSteeringMessages({
        takeSteeringMessages: params.callbacks.takeSteeringMessages,
        runtime,
        toolRuntime,
        recordDelivery: (count) =>
          params.graph.recordObservability({
            observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.STEERING_DELIVERED,
            iteration,
            detail: `count:${count}`,
          }),
      }));

      // Memory turned on or off, or rounds compaction replaced, apply from this iteration on.
      if (!isSessionMemoryReadCurrent(runtime.memory, runtime.workingMessages)) {
        runtime.memory = params.refreshSessionMemory(runtime.workingMessages);
      }

      const iterationExecution = await executeAgentControlGraphIteration({
        ...params,
        maxToolIterations: iterationLimit,
        promptContextSupport: {
          ...params.promptContextSupport,
          maxToolIterations: iterationLimit,
        },
        iteration,
        runtime,
        toolRuntime,
      });
      runtime = iterationExecution.runtime;
      if (iterationExecution.status === 'finalized') {
        return;
      }
      if (iterationExecution.status === 'waiting') {
        return;
      }
      const extensionCheckpoint = Math.max(1, iterationLimit - 1);
      if (iteration === extensionCheckpoint) {
        const nextIterationLimit = resolveNextLongHorizonIterationLimit({
          enabled: params.allowLongHorizonIterationExtensions === true,
          currentLimit: iterationLimit,
          extensionSize: iterationExtensionSize,
          toolCallHistory: params.toolRuntime.toolCallHistory,
          isForegroundRun: params.isForegroundRun === true,
        });
        if (nextIterationLimit !== null) {
          params.graph.recordObservability({
            observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.LONG_HORIZON_BUDGET_EXTENDED,
            iteration,
            detail: `from:${iterationLimit},to:${nextIterationLimit}`,
          });
          iterationLimit = nextIterationLimit;
        }
      }
      if (iteration === iterationLimit) {
        await finishMaxIterationSession();
        return;
      }
      iteration += 1;
    }
    await finishMaxIterationSession();
  } catch (error: unknown) {
    if (params.signal?.signal.aborted) {
      try {
        await params.graph.finishCancelled();
      } catch (finalizationError: unknown) {
        params.warn('Agent control graph cancellation finalization failed', finalizationError);
      }
      return;
    }
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    try {
      await params.graph.finishFailure(normalizedError);
    } catch (finalizationError: unknown) {
      params.warn('Agent control graph failure finalization failed', finalizationError);
    }
    throw normalizedError;
  }
}
