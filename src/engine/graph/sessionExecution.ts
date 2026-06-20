import { emitSessionEvent } from '../../services/events/bus';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import {
  getAgentControlGraphFinalizationBlocker,
  selectAgentControlGraphRuntimeCommand,
} from './agentControlGraph';
import { executeAgentControlGraphIteration } from './iterationExecution';
import type {
  AgentControlGraphIterationRuntimeState,
  ExecuteAgentControlGraphIterationParams,
} from './iterationExecutionTypes';

export interface ExecuteAgentControlGraphSessionParams
  extends Omit<ExecuteAgentControlGraphIterationParams, 'iteration' | 'runtime'> {
  initialRuntime: AgentControlGraphIterationRuntimeState;
}

function buildMaxIterationMessage(finalizationBlocker?: string): string {
  if (!finalizationBlocker) {
    return "I've reached the maximum number of tool iterations. Here's what I've accomplished so far with the tools I've used.";
  }

  return [
    "I've reached the maximum number of tool iterations before completing the active goals.",
    finalizationBlocker,
  ].join('\n');
}

export async function executeAgentControlGraphSession(
  params: ExecuteAgentControlGraphSessionParams,
): Promise<void> {
  let iteration = 0;
  let runtime: AgentControlGraphIterationRuntimeState = {
    ...params.initialRuntime,
    workingMessages: [...params.initialRuntime.workingMessages],
  };

  await emitSessionEvent('start', { conversationId: params.conversationId });

  try {
    while (iteration < params.maxToolIterations) {
      iteration += 1;

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

      const iterationExecution = await executeAgentControlGraphIteration({
        ...params,
        iteration,
        runtime,
      });
      runtime = iterationExecution.runtime;
      if (iterationExecution.status === 'finalized') {
        return;
      }
    }

    const maxIterationFinalizationBlocker = getAgentControlGraphFinalizationBlocker(
      params.graph.getGraphSnapshot(),
    );
    await params.graph.finishWithGraphTerminalEvent({
      graphEvent: {
        type: 'FINALIZED',
        reason: 'max_iterations',
      },
      content: buildMaxIterationMessage(maxIterationFinalizationBlocker),
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: 'max_iterations',
      }),
      sessionEndReason: 'max_iterations',
    });
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
