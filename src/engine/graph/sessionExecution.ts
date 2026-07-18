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
import type { Message } from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import {
  admitSessionMemoryContext,
  isAdmittedSessionMemoryContextFresh,
  type SessionMemoryAccessCandidate,
} from './sessionMemoryContext';
import type { AgentControlGraphSnapshot } from './agentControlGraph';
import { removeLivingMemoryCompactionMessages } from './modelTurn/memoryPromptDispatchFence';
import {
  assertModelTurnMemoryPolicyBindingDurablyCurrent,
  isMemoryPromptEpochExpiredError,
} from '../authority/modelTurnMemoryPolicyBinding';
import { attachModelTurnMemoryAttribution } from './modelTurnMemoryAttribution';

export interface ExecuteAgentControlGraphSessionParams extends Omit<
  ExecuteAgentControlGraphIterationParams,
  'iteration' | 'runtime'
> {
  initialRuntime: AgentControlGraphIterationRuntimeState;
  refreshSessionMemoryContext: (params: {
    activeModel: string;
    activeProvider: LlmProviderConfig;
    graphSnapshot: AgentControlGraphSnapshot;
    workingMessages: Message[];
  }) => Promise<SessionMemoryAccessCandidate>;
}

export const MAX_MEMORY_AUTHORITY_REPREPARATIONS_PER_ITERATION = 2;
export const MEMORY_AUTHORITY_UNSTABLE_TERMINAL_REASON = 'memory_authority_unstable';

const MEMORY_AUTHORITY_UNSTABLE_MESSAGE =
  'Memory changed repeatedly while this response was being prepared. Please retry the request.';

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
  let iteration = 1;
  let authorityRepreparationCount = 0;
  let restrictiveRefreshRequested = false;
  let runtime: AgentControlGraphIterationRuntimeState = {
    ...params.initialRuntime,
    workingMessages: [...params.initialRuntime.workingMessages],
  };
  const finishMaxIterationSession = async (): Promise<void> => {
    const maxIterationMemoryPolicyBinding = runtime.lastModelTurnMemoryPolicyBinding;
    const maxIterationFinalizationBlocker = getAgentControlGraphFinalizationBlocker(
      params.graph.getGraphSnapshot(),
    );
    await params.graph.finishWithGraphTerminalEvent({
      graphEvent: {
        type: 'FINALIZED',
        reason: 'max_iterations',
      },
      content: buildMaxIterationMessage(maxIterationFinalizationBlocker),
      assistantMetadata: attachModelTurnMemoryAttribution(
        buildAssistantMessageMetadata('final', {
          completionStatus: 'complete',
          finishReason: 'max_iterations',
        }),
        runtime.lastModelTurnMemoryRetrievalEventId,
      ),
      beforeAssistantDelivery: () =>
        assertModelTurnMemoryPolicyBindingDurablyCurrent(maxIterationMemoryPolicyBinding),
      sessionEndReason: 'max_iterations',
    });
  };

  await emitSessionEvent('start', {
    conversationId: params.conversationId,
    agentRunId: params.agentRunId,
    executionSignal: params.signal,
  });

  try {
    while (iteration <= params.maxToolIterations) {
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

      if (
        restrictiveRefreshRequested ||
        !isAdmittedSessionMemoryContextFresh(runtime.admittedMemoryContext)
      ) {
        if (authorityRepreparationCount >= MAX_MEMORY_AUTHORITY_REPREPARATIONS_PER_ITERATION) {
          await params.graph.finishWithGraphTerminalEvent({
            graphEvent: {
              type: 'BLOCKED',
              reason: MEMORY_AUTHORITY_UNSTABLE_TERMINAL_REASON,
            },
            content: MEMORY_AUTHORITY_UNSTABLE_MESSAGE,
            assistantMetadata: buildAssistantMessageMetadata('final', {
              completionStatus: 'incomplete',
              finishReason: 'response_failed',
              terminalReason: MEMORY_AUTHORITY_UNSTABLE_TERMINAL_REASON,
            }),
            sessionEndReason: MEMORY_AUTHORITY_UNSTABLE_TERMINAL_REASON,
          });
          return;
        }

        runtime.workingMessages = removeLivingMemoryCompactionMessages(runtime.workingMessages);
        const refreshedCandidate = await params.refreshSessionMemoryContext({
          activeModel: runtime.activeModel,
          activeProvider: runtime.activeProvider,
          graphSnapshot: params.graph.getGraphSnapshot(),
          workingMessages: runtime.workingMessages,
        });
        runtime.admittedMemoryContext = admitSessionMemoryContext(refreshedCandidate);
        authorityRepreparationCount += 1;
        restrictiveRefreshRequested = false;
        if (!isAdmittedSessionMemoryContextFresh(runtime.admittedMemoryContext)) {
          restrictiveRefreshRequested = true;
          continue;
        }
      }

      const iterationExecution = await executeAgentControlGraphIteration({
        ...params,
        iteration,
        runtime,
      });
      runtime = iterationExecution.runtime;
      if (iterationExecution.status === 'retry_current_iteration') {
        restrictiveRefreshRequested = true;
        continue;
      }
      if (iterationExecution.status === 'finalized') {
        return;
      }
      if (iterationExecution.status === 'waiting') {
        return;
      }
      if (iteration === params.maxToolIterations) {
        try {
          assertModelTurnMemoryPolicyBindingDurablyCurrent(
            runtime.lastModelTurnMemoryPolicyBinding,
          );
          await finishMaxIterationSession();
          return;
        } catch (authorityError: unknown) {
          if (!isMemoryPromptEpochExpiredError(authorityError)) throw authorityError;
          params.graph.applyAgentControlGraphEvents([
            {
              type: 'MODEL_TURN_INVALIDATED',
              iteration,
              reason: 'memory_authority_changed',
            },
          ]);
          params.callbacks.onAssistantStreamReset?.();
          params.callbacks.onStateChange('thinking');
          await params.yieldToUiFrame();
          restrictiveRefreshRequested = true;
          continue;
        }
      }
      iteration += 1;
      authorityRepreparationCount = 0;
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
