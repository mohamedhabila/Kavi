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
import {
  isAgentRunControlGraphTerminal,
  prepareAgentRunControlGraphForResume,
  updateAgentRunControlGraphAsyncWorkState,
} from '../../services/agents/agentControlGraphState';
import { buildRecoveredAgentRunStateAfterAppRestart } from '../../engine/graph/interruptedRunRecovery';
import type { ResolveToolEffectRestartDisposition } from '../../services/executionJournal/toolEffectRestartDisposition';
import { appendAgentCheckpoint } from './shared';
import {
  recoverActiveToolCallsAfterRestart,
  settleActiveToolCallsInAgentRunMessages,
} from './toolCalls';
import { buildAgentControlGraphAfterPersistedFinalDelivery } from '../../engine/graph/persistedFinalDelivery';
import { reduceAgentControlGraph } from '../../engine/graph/agentControlGraph';
import { buildAgentControlGraphTerminalEventForCompletion } from '../../engine/graph/runCompletion';

const INTERRUPTED_TOOL_CALL_ERROR =
  'Tool call was interrupted because the app restarted before completion.';
const EFFECT_RECONCILIATION_PENDING_SUMMARY =
  'Waiting for durable tool-effect reconciliation after app restart. No tool or model execution will be replayed.';
const EFFECT_RECONCILIATION_PENDING_TITLE = 'Tool effect reconciliation pending';

function controlGraphMatchesRecoveredTerminalStatus(
  controlGraph: AgentRun['controlGraph'],
  status: Extract<AgentRun['status'], 'cancelled' | 'failed'>,
): boolean {
  if (!controlGraph) return false;
  return status === 'cancelled'
    ? controlGraph.status === 'cancelled'
    : controlGraph.status === 'failed' || controlGraph.status === 'blocked';
}

function prepareControlGraphForRecoveredFailure(params: {
  controlGraph: AgentRun['controlGraph'];
  timestamp: number;
}): AgentRun['controlGraph'] {
  const graph = params.controlGraph;
  if (!graph || !isAgentRunControlGraphTerminal(graph)) return graph;

  return prepareAgentRunControlGraphForResume(graph, {
    reason: 'reconciling a mismatched persisted terminal graph after app restart',
    updatedAt: params.timestamp,
  });
}

export function recoverInterruptedAgentRunsInConversation(
  conversation: Conversation,
  activeSubAgents: SubAgentSnapshot[],
  params?: {
    timestamp?: number;
    resolveToolEffect?: ResolveToolEffectRestartDisposition;
    executionRunIdByConversationAndAgentRun?: ReadonlyMap<string, ReadonlyMap<string, string>>;
  },
): Conversation {
  const timestamp = params?.timestamp ?? Date.now();
  let didUpdateConversation = false;
  let nextMessages = conversation.messages;
  const runningRuns = (conversation.agentRuns ?? []).filter((run) => run.status === 'running');
  const persistedActiveRunId = runningRuns.some((run) => run.id === conversation.activeAgentRunId)
    ? conversation.activeAgentRunId
    : undefined;
  const recoverableOrphanRunIds = persistedActiveRunId
    ? []
    : runningRuns
        .filter((run) => {
          const hasPendingAsyncOperation = getAgentRunPendingAsyncOperations(run).length > 0;
          const hasLiveWorker = getSubAgentsForAgentRun(conversation, run.id, activeSubAgents).some(
            (worker) => worker.status === 'running',
          );
          return hasPendingAsyncOperation || hasLiveWorker;
        })
        .map((run) => run.id);
  const resolvedActiveRunId =
    persistedActiveRunId ??
    (recoverableOrphanRunIds.length === 1 ? recoverableOrphanRunIds[0] : undefined);

  const nextRuns = (conversation.agentRuns ?? []).map((run) => {
    if (run.status !== 'running') {
      return run;
    }

    const recoveredWorkers = getSubAgentsForAgentRun(conversation, run.id, activeSubAgents);
    const interruptedToolUpdate = isAgentRunControlGraphTerminal(run.controlGraph)
      ? (() => {
          const settled = settleActiveToolCallsInAgentRunMessages({
            messages: nextMessages,
            run,
            timestamp,
            errorMessage: INTERRUPTED_TOOL_CALL_ERROR,
          });
          return {
            messages: settled.messages,
            completedCount: 0,
            failedCount: settled.settledCount,
            reconciliationPendingCount: 0,
          };
        })()
      : recoverActiveToolCallsAfterRestart({
          conversationId: conversation.id,
          executionRunId: params?.executionRunIdByConversationAndAgentRun
            ?.get(conversation.id)
            ?.get(run.id),
          messages: nextMessages,
          run,
          timestamp,
          interruptedErrorMessage: INTERRUPTED_TOOL_CALL_ERROR,
          resolveToolEffect: params?.resolveToolEffect ?? (() => ({ kind: 'not_dispatched' })),
        });
    const recoveredCompletedToolCount = interruptedToolUpdate.completedCount;
    const interruptedToolCount = interruptedToolUpdate.failedCount;
    const didRecoverTool = recoveredCompletedToolCount > 0 || interruptedToolCount > 0;
    if (didRecoverTool) {
      didUpdateConversation = true;
      nextMessages = interruptedToolUpdate.messages;
    }

    const recoveredState =
      run.id !== resolvedActiveRunId
        ? {
            status: 'failed' as const,
            latestSummary:
              'A historical run was interrupted because it no longer had the active conversation identity after restart.',
            checkpointTitle: 'Recovered orphaned run',
            checkpointDetail:
              'The run was finalized instead of being resumed without an active conversation identity.',
          }
        : buildRecoveredAgentRunStateAfterAppRestart({
            messages: nextMessages,
            run,
            subAgents: recoveredWorkers,
          });

    if (interruptedToolUpdate.reconciliationPendingCount > 0) {
      const alreadyPending =
        run.latestSummary === EFFECT_RECONCILIATION_PENDING_SUMMARY &&
        run.controlGraph?.status === 'recovering';
      if (alreadyPending) return run;

      didUpdateConversation = true;
      const reviewPhase = 'review';
      const nextControlGraph = updateAgentRunControlGraphAsyncWorkState(run.controlGraph, {
        awaitingBackgroundWorkers: isAgentRunAwaitingBackgroundWorkers(run),
        pendingOperations: getAgentRunPendingAsyncOperations(run),
        updatedAt: timestamp,
      });
      return appendAgentCheckpoint(
        {
          ...run,
          status: 'running',
          controlGraph: { ...nextControlGraph, status: 'recovering' },
          currentPhase: reviewPhase,
          updatedAt: Math.max(run.updatedAt, timestamp),
          latestSummary: EFFECT_RECONCILIATION_PENDING_SUMMARY,
          summary: mergeAgentRunSummary(run.summary, {
            durationMs: Math.max(0, timestamp - run.createdAt),
          }),
          phases: transitionAgentRunPhases(
            run.phases,
            reviewPhase,
            'active',
            timestamp,
            EFFECT_RECONCILIATION_PENDING_SUMMARY,
          ),
        },
        {
          timestamp,
          kind: 'run',
          title: EFFECT_RECONCILIATION_PENDING_TITLE,
          detail: EFFECT_RECONCILIATION_PENDING_SUMMARY,
        },
      );
    }

    if (!recoveredState) {
      if (!didRecoverTool) return run;
      const baseSummary = mergeAgentRunSummary(run.summary);
      return appendAgentCheckpoint(
        {
          ...run,
          updatedAt: Math.max(run.updatedAt, timestamp),
          summary: mergeAgentRunSummary(run.summary, {
            completedTools: baseSummary.completedTools + recoveredCompletedToolCount,
            failedTools: baseSummary.failedTools + interruptedToolCount,
            durationMs: Math.max(0, timestamp - run.createdAt),
          }),
        },
        {
          timestamp,
          kind: 'tool',
          title: 'Recovered interrupted tool effects',
          detail: `Recovered ${recoveredCompletedToolCount} verified and ${interruptedToolCount} failed tool effects while the run remains active.`,
        },
      );
    }

    didUpdateConversation = true;

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
            completedTools:
              mergeAgentRunSummary(run.summary).completedTools + recoveredCompletedToolCount,
            failedTools: mergeAgentRunSummary(run.summary).failedTools + interruptedToolCount,
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

    let terminalRecoveredState =
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

    let nextControlGraph = run.controlGraph;
    if (terminalRecoveredState.status === 'completed') {
      const finalizedControlGraph = nextControlGraph
        ? buildAgentControlGraphAfterPersistedFinalDelivery({
            messages: nextMessages,
            run: { ...run, controlGraph: nextControlGraph },
          })
        : undefined;
      if (finalizedControlGraph) {
        nextControlGraph = finalizedControlGraph;
      } else {
        terminalRecoveredState = {
          ...terminalRecoveredState,
          status: 'failed',
          latestSummary:
            'A final response was preserved, but its graph completion boundary could not be verified after restart.',
          checkpointTitle: 'Run completion requires recovery',
          checkpointDetail:
            'The persisted delivery could not be reconciled with required goals and constraint state.',
        };
      }
    }

    if (terminalRecoveredState.status !== 'completed') {
      const graphTerminalStatus =
        terminalRecoveredState.status === 'cancelled' ? 'cancelled' : 'failed';
      if (!controlGraphMatchesRecoveredTerminalStatus(nextControlGraph, graphTerminalStatus)) {
        const terminalEvent = buildAgentControlGraphTerminalEventForCompletion({
          status: graphTerminalStatus,
          terminalReason: run.terminalReason,
        });
        nextControlGraph = reduceAgentControlGraph(
          prepareControlGraphForRecoveredFailure({
            controlGraph: nextControlGraph,
            timestamp,
          }),
          [
            {
              ...terminalEvent,
              reason: terminalRecoveredState.latestSummary,
              timestamp,
            },
          ],
        );
      }
    }
    const finalPhase = terminalRecoveredState.status === 'completed' ? 'deliver' : run.currentPhase;
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
    resolvedActiveRunId &&
    nextRuns.some((run) => run.id === resolvedActiveRunId && run.status === 'running')
      ? resolvedActiveRunId
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
