import type { AgentRun } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import type { SubAgentSnapshot } from '../../types/subAgent';
import { getSubAgentsForAgentRun } from '../../services/agents/lifecycle/stateMachine';
import {
  getAgentRunPendingAsyncOperations,
  isAgentRunAwaitingBackgroundWorkers,
} from '../../services/agents/agentRunAsyncState';
import {
  mergeAgentRunSummary,
  skipRemainingAgentRunPhases,
  transitionAgentRunPhases,
} from '../../services/agents/agentRunStateModel';
import { updateAgentRunControlGraphAsyncWorkState } from '../../services/agents/agentControlGraphState';
import { buildRecoveredAgentRunStateAfterAppRestart } from '../../engine/graph/interruptedRunRecovery';
import { appendAgentCheckpoint } from './shared';
import { settleActiveToolCallsInAgentRunMessages } from './toolCalls';

const INTERRUPTED_TOOL_CALL_ERROR =
  'Tool call was interrupted because the app restarted before completion.';

export function recoverInterruptedAgentRunsInConversation(
  conversation: Conversation,
  activeSubAgents: SubAgentSnapshot[],
  params?: { timestamp?: number },
): Conversation {
  const timestamp = params?.timestamp ?? Date.now();
  let didUpdateConversation = false;
  let nextMessages = conversation.messages;

  const nextRuns = (conversation.agentRuns ?? []).map((run) => {
    if (run.status !== 'running') {
      return run;
    }

    const recoveredWorkers = getSubAgentsForAgentRun(conversation, run.id, activeSubAgents);
    const recoveredState = buildRecoveredAgentRunStateAfterAppRestart({
      messages: conversation.messages,
      run,
      subAgents: recoveredWorkers,
    });
    if (!recoveredState) {
      return run;
    }

    didUpdateConversation = true;
    let interruptedToolCount = 0;

    if (recoveredState.status === 'running') {
      const reviewPhase = recoveredState.phase ?? 'review';
      const recoveredAwaitingBackgroundWorkers =
        recoveredState.awaitingBackgroundWorkers ?? isAgentRunAwaitingBackgroundWorkers(run);
      const recoveredPendingAsyncOperations = getAgentRunPendingAsyncOperations(run);
      const nextControlGraph = updateAgentRunControlGraphAsyncWorkState(run.controlGraph, {
        awaitingBackgroundWorkers: recoveredAwaitingBackgroundWorkers,
        pendingOperations: recoveredPendingAsyncOperations,
        updatedAt: timestamp,
      });

      return appendAgentCheckpoint(
        {
          ...run,
          status: 'running',
          controlGraph: nextControlGraph,
          currentPhase: reviewPhase,
          updatedAt: Math.max(run.updatedAt, timestamp),
          latestSummary: recoveredState.latestSummary,
          summary: mergeAgentRunSummary(run.summary, {
            durationMs: Math.max(0, timestamp - run.createdAt),
          }),
          phases: transitionAgentRunPhases(
            run.phases,
            reviewPhase,
            'active',
            timestamp,
            recoveredState.latestSummary,
          ),
        },
        {
          timestamp,
          kind: 'run',
          title: recoveredState.checkpointTitle,
          detail: recoveredState.checkpointDetail,
        },
      );
    }

    const interruptedToolUpdate = settleActiveToolCallsInAgentRunMessages({
      messages: nextMessages,
      run,
      timestamp,
      errorMessage: INTERRUPTED_TOOL_CALL_ERROR,
    });
    if (interruptedToolUpdate.settledCount > 0) {
      nextMessages = interruptedToolUpdate.messages;
      interruptedToolCount = interruptedToolUpdate.settledCount;
    }

    const finalPhase = recoveredState.status === 'completed' ? 'deliver' : run.currentPhase;
    const nextControlGraph = updateAgentRunControlGraphAsyncWorkState(run.controlGraph, {
      awaitingBackgroundWorkers: false,
      pendingOperations: [],
      updatedAt: timestamp,
    });
    let nextRun: AgentRun = {
      ...run,
      status: recoveredState.status,
      controlGraph: nextControlGraph,
      currentPhase: finalPhase,
      completedAt: timestamp,
      updatedAt: Math.max(run.updatedAt, timestamp),
      latestSummary: recoveredState.latestSummary,
      summary: mergeAgentRunSummary(run.summary, {
        failedTools:
          interruptedToolCount > 0
            ? mergeAgentRunSummary(run.summary).failedTools + interruptedToolCount
            : undefined,
        durationMs: Math.max(0, timestamp - run.createdAt),
      }),
      phases: transitionAgentRunPhases(
        run.phases,
        finalPhase,
        recoveredState.status === 'completed'
          ? 'completed'
          : recoveredState.status === 'failed'
            ? 'failed'
            : 'skipped',
        timestamp,
        recoveredState.latestSummary,
      ),
    };

    if (recoveredState.status !== 'completed') {
      nextRun = {
        ...nextRun,
        phases: skipRemainingAgentRunPhases(nextRun.phases, finalPhase, timestamp),
      };
    }

    return appendAgentCheckpoint(nextRun, {
      timestamp,
      kind: 'run',
      title: recoveredState.checkpointTitle,
      detail: recoveredState.checkpointDetail,
    });
  });

  const nextActiveAgentRunId =
    conversation.activeAgentRunId &&
    nextRuns.some((run) => run.id === conversation.activeAgentRunId && run.status === 'running')
      ? conversation.activeAgentRunId
      : undefined;

  if (!didUpdateConversation && nextActiveAgentRunId === conversation.activeAgentRunId) {
    return conversation;
  }

  return {
    ...conversation,
    updatedAt: Math.max(conversation.updatedAt, timestamp),
    messages: nextMessages,
    agentRuns: nextRuns,
    activeAgentRunId: nextActiveAgentRunId,
  };
}
