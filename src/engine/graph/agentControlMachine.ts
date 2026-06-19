import { setup } from 'xstate';
import { createAgentControlGraphActions } from './agentControlGraphActions';
import {
  buildInitialContext,
  normalizeToolCallRefs,
  willObserveAllToolResults,
} from './agentControlGraphInternals';
import type {
  AgentControlGraphEvent,
  AgentControlGraphMachineContext,
  AgentControlGraphSnapshot,
} from './agentControlGraphTypes';

const TERMINAL_TRANSITIONS = {
  BLOCKED: {
    target: 'blocked',
    actions: 'recordBlocked',
  },
  FINALIZED: {
    target: 'finalized',
    actions: 'recordFinalized',
  },
  YIELDED: {
    target: 'yielded',
    actions: 'recordYielded',
  },
  CANCELLED: {
    target: 'cancelled',
    actions: 'recordCancelled',
  },
  FAILED: {
    target: 'failed',
    actions: 'recordFailed',
  },
} as const;

export function createAgentControlMachine(snapshot?: Partial<AgentControlGraphSnapshot>) {
  const initialContext = buildInitialContext(snapshot);

  return setup({
    types: {} as {
      context: AgentControlGraphMachineContext;
      events: AgentControlGraphEvent;
    },
    actions: createAgentControlGraphActions(),
    guards: {
      hasToolCalls: ({ event }: { event: AgentControlGraphEvent }) =>
        event.type === 'MODEL_TURN_COMPLETED' && normalizeToolCallRefs(event.toolCalls).length > 0,
      willCompleteToolBoundary: ({
        context,
        event,
      }: {
        context: AgentControlGraphMachineContext;
        event: AgentControlGraphEvent;
      }) =>
        event.type === 'TOOL_RESULT_RECORDED'
          ? willObserveAllToolResults(context, [event.result])
          : event.type === 'TOOL_RESULTS_RECORDED'
            ? willObserveAllToolResults(context, event.results)
            : false,
      hasPendingAsyncWork: ({ event }: { event: AgentControlGraphEvent }) =>
        event.type === 'ASYNC_WAITING'
          ? event.pendingOperations !== undefined
            ? event.pendingOperations.length > 0
            : event.pendingAsyncCount > 0
          : false,
    },
  }).createMachine({
    id: 'agent-control-graph',
    initial: initialContext.status,
    context: initialContext,
    on: {
      GOALS_UPDATED: {
        actions: 'recordGoalsUpdated',
      },
      SESSION_ACTIVATED_TOOLS_UPDATED: {
        actions: 'recordSessionActivatedToolsUpdated',
      },
      GOAL_EVIDENCE_ADDED: {
        actions: 'recordGoalEvidenceAdded',
      },
      PERFORMANCE_METRICS_RECORDED: {
        actions: 'recordPerformanceMetrics',
      },
      GRAPH_OBSERVABILITY_RECORDED: {
        actions: 'recordObservabilityAudit',
      },
      TURN_DIRECTIVES_RECORDED: {
        actions: 'recordTurnDirectives',
      },
      TURN_DIRECTIVES_CONSUMED: {
        actions: 'consumeTurnDirectives',
      },
    },
    states: {
      ready: {
        on: {
          MODEL_TURN_STARTED: {
            target: 'model_turn',
            actions: 'recordModelTurnStarted',
          },
          ASYNC_WAITING: [
            {
              guard: 'hasPendingAsyncWork',
              target: 'waiting_async',
              actions: 'recordAsyncWaiting',
            },
            {
              actions: 'recordAsyncWaiting',
            },
          ],
          FINALIZATION_HELD: {
            target: 'recovering',
            actions: 'recordFinalizationHold',
          },
          FINAL_CANDIDATE_READY: {
            target: 'awaiting_review',
            actions: 'recordFinalCandidateReady',
          },
          ...TERMINAL_TRANSITIONS,
        },
      },
      model_turn: {
        on: {
          MODEL_TURN_COMPLETED: [
            {
              guard: 'hasToolCalls',
              target: 'awaiting_tool_results',
              actions: 'recordModelTurnCompletedWithTools',
            },
            {
              target: 'ready',
              actions: 'recordModelTurnCompletedWithoutTools',
            },
          ],
          MODEL_TURN_FAILED: {
            target: 'ready',
            actions: 'recordModelTurnFailed',
          },
          FINAL_CANDIDATE_READY: {
            target: 'awaiting_review',
            actions: 'recordFinalCandidateReady',
          },
          ...TERMINAL_TRANSITIONS,
        },
      },
      awaiting_tool_results: {
        on: {
          TOOL_RESULT_RECORDED: [
            {
              guard: 'willCompleteToolBoundary',
              target: 'ready',
              actions: ['recordToolResult', 'clearCompletedToolBoundary'],
            },
            {
              actions: 'recordToolResult',
            },
          ],
          TOOL_RESULTS_RECORDED: [
            {
              guard: 'willCompleteToolBoundary',
              target: 'ready',
              actions: ['recordToolResults', 'clearCompletedToolBoundary'],
            },
            {
              actions: 'recordToolResults',
            },
          ],
          ...TERMINAL_TRANSITIONS,
        },
      },
      recovering: {
        on: {
          MODEL_TURN_STARTED: {
            target: 'model_turn',
            actions: 'recordModelTurnStarted',
          },
          FINALIZATION_HELD: {
            actions: 'recordFinalizationHold',
          },
          ...TERMINAL_TRANSITIONS,
        },
      },
      waiting_async: {
        on: {
          MODEL_TURN_STARTED: {
            target: 'model_turn',
            actions: 'recordModelTurnStarted',
          },
          ASYNC_WAITING: [
            {
              guard: 'hasPendingAsyncWork',
              actions: 'recordAsyncWaiting',
            },
            {
              target: 'ready',
              actions: 'recordAsyncWaiting',
            },
          ],
          ...TERMINAL_TRANSITIONS,
        },
      },
      awaiting_review: {
        on: TERMINAL_TRANSITIONS,
      },
      blocked: {
        type: 'final',
      },
      finalized: {
        type: 'final',
      },
      yielded: {
        type: 'final',
      },
      cancelled: {
        type: 'final',
      },
      failed: {
        type: 'final',
      },
    },
  });
}

export function projectAgentControlGraphSnapshot(
  snapshot: ReturnType<ReturnType<typeof createAgentControlMachine>['getInitialSnapshot']>,
): AgentControlGraphSnapshot {
  return {
    ...snapshot.context,
    status: snapshot.value as AgentControlGraphSnapshot['status'],
  };
}
