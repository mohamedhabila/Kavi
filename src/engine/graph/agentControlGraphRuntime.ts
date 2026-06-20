import type { AgentRunControlGraphState } from '../../types/agentRun';
import type { Message } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import { syncActiveGoalFocusFromGraphTransition } from '../../services/memory/tasks';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import {
  createInitialAgentControlGraphSnapshot,
  getAgentControlGraphTurnDirectives,
  reduceAgentControlGraph,
  type AgentControlGraphEvent,
  type AgentControlGraphSnapshot,
  type AgentControlPerformance,
  type AgentControlTurnDirectives,
} from './agentControlGraph';
import { createAgentControlGraphRuntimeTerminal } from './agentControlGraphRuntimeTerminal';
import type { RuntimeCallbacks } from './agentControlGraphRuntimeTypes';
import { buildAgentControlGraphAsyncWaitingEvent } from './asyncWorkEvents';
import {
  buildAgentControlGraphPostToolFinalTextDirectiveEvent,
  buildAgentControlGraphResetIncompleteFinalTextRecoveryEvent,
  buildAgentControlGraphTurnDirectivesConsumedEvent,
  buildAgentControlGraphTurnDirectivesRecordedEvent,
} from './turnDirectives';
import {
  collectAgentControlGraphCompletedWorkflowToolNames,
  selectWorkflowScopedMessagesForRun,
} from './workflowMessages';
import { buildAgentControlGraphWorkflowToolResultProgress } from './workflowToolResultProgress';
import {
  buildGraphObservabilityRecordedEvent,
  type GraphObservabilityAuditType,
} from './graphObservability';

export function createAgentControlGraphRuntime(params: {
  callbacks: RuntimeCallbacks;
  conversationId: string;
  initialMessages: ReadonlyArray<Message>;
  initialSnapshot?: AgentRunControlGraphState;
  warn?: (message: string, error: unknown) => void;
  workflowScopeUserMessageId?: string;
}) {
  let snapshot = createInitialAgentControlGraphSnapshot(params.initialSnapshot);
  const completedWorkflowToolNames = collectAgentControlGraphCompletedWorkflowToolNames(
    selectWorkflowScopedMessagesForRun(params.initialMessages, params.workflowScopeUserMessageId),
  );

  const applyEvents = (
    events: ReadonlyArray<AgentControlGraphEvent>,
  ): AgentControlGraphSnapshot => {
    const hadGoalsUpdated = events.some((event) => event.type === 'GOALS_UPDATED');
    snapshot = reduceAgentControlGraph(snapshot, events);
    if (hadGoalsUpdated) {
      try {
        syncActiveGoalFocusFromGraphTransition({
          threadId: params.conversationId,
          goals: snapshot.goals ?? [],
        });
      } catch {
        // Goal focus sync is best-effort; graph events must not fail.
      }
    }
    params.callbacks.onAgentControlGraphStateChange?.(snapshot);
    return snapshot;
  };

  const terminalRuntime = createAgentControlGraphRuntimeTerminal({
    callbacks: params.callbacks,
    conversationId: params.conversationId,
    applyEvents,
    warn: params.warn,
  });

  return {
    get snapshot(): AgentControlGraphSnapshot {
      return snapshot;
    },
    completedWorkflowToolNames,
    applyEvents,
    syncPendingAsyncOperations(trackedAsyncOperations: ReadonlyMap<string, TrackedAsyncOperation>) {
      applyEvents([buildAgentControlGraphAsyncWaitingEvent(trackedAsyncOperations)]);
    },
    recordPerformanceMetrics(metrics: Partial<AgentControlPerformance>, reason: string) {
      return applyEvents([
        {
          type: 'PERFORMANCE_METRICS_RECORDED',
          metrics,
          reason,
        },
      ]);
    },
    recordObservability(params: {
      observabilityType: GraphObservabilityAuditType;
      iteration?: number;
      detail?: string;
      timestamp?: number;
    }) {
      return applyEvents([buildGraphObservabilityRecordedEvent(params)]);
    },
    getCurrentTurnDirectives(): AgentControlTurnDirectives {
      return getAgentControlGraphTurnDirectives(snapshot);
    },
    recordTurnDirectives(directives: Partial<AgentControlTurnDirectives>, reason: string) {
      return applyEvents([buildAgentControlGraphTurnDirectivesRecordedEvent(directives, reason)]);
    },
    recordPostToolFinalTextDirective(args: {
      pendingAsyncCount: number;
      hasBackgroundLaunchWithoutWait?: boolean;
      hasAsyncTerminalResolution?: boolean;
      hasActivePersistentGoal?: boolean;
      hasCompletedBlockingGoal?: boolean;
      hasIncompleteBlockingGoal?: boolean;
    }): boolean {
      const event = buildAgentControlGraphPostToolFinalTextDirectiveEvent(args);
      if (!event) {
        return false;
      }

      applyEvents([event]);
      return true;
    },
    resetIncompleteFinalTextRecovery(reason: string) {
      return applyEvents([buildAgentControlGraphResetIncompleteFinalTextRecoveryEvent(reason)]);
    },
    consumeOneShotTurnDirectives(reason: string) {
      return applyEvents([buildAgentControlGraphTurnDirectivesConsumedEvent(reason)]);
    },
    publishWorkflowToolResultProgress(args: {
      toolMessage: Message;
      tools: ToolDefinition[];
      reason: string;
    }) {
      const progress = buildAgentControlGraphWorkflowToolResultProgress({
        toolMessage: args.toolMessage,
        tools: args.tools,
        completedToolNames: completedWorkflowToolNames,
        reason: args.reason,
      });
      completedWorkflowToolNames.clear();
      for (const completedToolName of progress.nextCompletedToolNames) {
        completedWorkflowToolNames.add(completedToolName);
      }
      return progress;
    },
    finishWithGraphTerminalEvent: terminalRuntime.finishWithGraphTerminalEvent,
    finishWithGraphFinalCandidateEvent: terminalRuntime.finishWithGraphFinalCandidateEvent,
    finishExistingTerminalSession: terminalRuntime.finishExistingTerminalSession,
    finishFailure: terminalRuntime.finishFailure,
    finishCancelled: terminalRuntime.finishCancelled,
  };
}
