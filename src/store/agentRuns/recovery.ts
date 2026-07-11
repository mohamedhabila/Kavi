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
import type { ResolveToolEffectRestartDisposition } from '../../services/executionJournal/toolEffectRestartDisposition';
import { appendAgentCheckpoint } from './shared';
import { recoverActiveToolCallsAfterRestart } from './toolCalls';

const INTERRUPTED_TOOL_CALL_ERROR =
  'Tool call was interrupted because the app restarted before completion.';

export function recoverInterruptedAgentRunsInConversation(
  conversation: Conversation,
  activeSubAgents: SubAgentSnapshot[],
  params?: {
    timestamp?: number;
    resolveToolEffect?: ResolveToolEffectRestartDisposition;
  },
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
    let recoveredCompletedToolCount = 0;
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

    const interruptedToolUpdate = recoverActiveToolCallsAfterRestart({
      conversationId: conversation.id,
      messages: nextMessages,
      run,
      timestamp,
      interruptedErrorMessage: INTERRUPTED_TOOL_CALL_ERROR,
      resolveToolEffect: params?.resolveToolEffect ?? (() => ({ kind: 'not_dispatched' })),
    });
    if (interruptedToolUpdate.completedCount > 0 || interruptedToolUpdate.failedCount > 0) {
      nextMessages = interruptedToolUpdate.messages;
      recoveredCompletedToolCount = interruptedToolUpdate.completedCount;
      interruptedToolCount = interruptedToolUpdate.failedCount;
    }

    const terminalRecoveredState =
      recoveredState.status === 'completed' && interruptedToolCount > 0
        ? {
            ...recoveredState,
            status: 'failed' as const,
            latestSummary:
              'A final response was preserved, but an active tool lacked a verified terminal effect after restart.',
            checkpointTitle: 'Run effect requires recovery',
            checkpointDetail:
              'The run cannot remain completed until the interrupted tool effect is reconciled.',
          }
        : recoveredState;

    const finalPhase = terminalRecoveredState.status === 'completed' ? 'deliver' : run.currentPhase;
    const nextControlGraph = updateAgentRunControlGraphAsyncWorkState(run.controlGraph, {
      awaitingBackgroundWorkers: false,
      pendingOperations: [],
      updatedAt: timestamp,
    });
    let nextRun: AgentRun = {
      ...run,
      status: terminalRecoveredState.status,
      controlGraph: nextControlGraph,
      currentPhase: finalPhase,
      completedAt: timestamp,
      updatedAt: Math.max(run.updatedAt, timestamp),
      latestSummary: terminalRecoveredState.latestSummary,
      summary: mergeAgentRunSummary(run.summary, {
        completedTools:
          recoveredCompletedToolCount > 0
            ? mergeAgentRunSummary(run.summary).completedTools + recoveredCompletedToolCount
            : undefined,
        failedTools:
          interruptedToolCount > 0
            ? mergeAgentRunSummary(run.summary).failedTools + interruptedToolCount
            : undefined,
        durationMs: Math.max(0, timestamp - run.createdAt),
      }),
      phases: transitionAgentRunPhases(
        run.phases,
        finalPhase,
        terminalRecoveredState.status === 'completed'
          ? 'completed'
          : terminalRecoveredState.status === 'failed'
            ? 'failed'
            : 'skipped',
        timestamp,
        terminalRecoveredState.latestSummary,
      ),
    };

    if (terminalRecoveredState.status !== 'completed') {
      nextRun = {
        ...nextRun,
        phases: skipRemainingAgentRunPhases(nextRun.phases, finalPhase, timestamp),
      };
    }

    return appendAgentCheckpoint(nextRun, {
      timestamp,
      kind: 'run',
      title: terminalRecoveredState.checkpointTitle,
      detail: terminalRecoveredState.checkpointDetail,
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
