import {
  MAX_AGENT_RUN_CONTROL_GRAPH_AUDIT_EVENTS,
  normalizeAgentRunControlGraphGoals,
  normalizeAgentRunControlGraphSessionActivatedToolNames,
} from '../../services/agents/agentControlGraphState';
import { mergeSessionActivatedToolNames } from './discoveryToolActivation';
import {
  appendAudit,
  clearOneShotTurnDirectives,
  getTimestamp,
  mergePerformanceMetrics,
  mergeToolResults,
  mergeTurnDirectives,
  normalizeToolCallRefs,
} from './agentControlGraphInternals';
import {
  assignAgentControlGraph,
  recordAgentControlGraphTerminal,
  type AgentControlGraphAssignArgs,
} from './agentControlGraphAssign';
import { createRecordAsyncWaitingAction } from './agentControlGraphAsyncActions';
import { addGoalEvidence } from '../goals/graphState';
import { getActiveGoal } from '../goals/types';
import { normalizeRequestUnderstandingSnapshot } from '../../services/agents/requestUnderstandingProjection';
import { acknowledgeGoalUserConstraintDelivery } from '../goals/userConstraintDelivery';

export function createAgentControlGraphActions() {
  return {
    recordModelTurnStarted: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'MODEL_TURN_STARTED') {
        return {};
      }
      return {
        iteration: event.iteration,
        lastModelToolNames: Array.from(new Set(event.toolNames ?? [])),
        finalizationHoldReason: undefined,
        updatedAt: getTimestamp(event),
        audit: appendAudit(context.audit, event),
      };
    }),
    recordModelTurnCompletedWithTools: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'MODEL_TURN_COMPLETED') {
        return {};
      }
      const expectedToolCalls = normalizeToolCallRefs(event.toolCalls);
      return {
        iteration: event.iteration,
        expectedToolCalls,
        observedToolResults: [],
        updatedAt: getTimestamp(event),
        audit: appendAudit(
          context.audit,
          event,
          `${expectedToolCalls.length} tool call(s) expected`,
        ),
      };
    }),
    recordModelTurnCompletedWithoutTools: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'MODEL_TURN_COMPLETED') {
        return {};
      }
      return {
        iteration: event.iteration,
        expectedToolCalls: [],
        observedToolResults: [],
        updatedAt: getTimestamp(event),
        audit: appendAudit(context.audit, event, 'no tool calls'),
      };
    }),
    recordModelTurnFailed: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'MODEL_TURN_FAILED') {
        return {};
      }
      return {
        expectedToolCalls: [],
        observedToolResults: [],
        updatedAt: getTimestamp(event),
        audit: appendAudit(context.audit, event, event.reason),
      };
    }),
    recordModelTurnInvalidated: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'MODEL_TURN_INVALIDATED') {
        return {};
      }
      return {
        expectedToolCalls: [],
        observedToolResults: [],
        updatedAt: getTimestamp(event),
        audit: appendAudit(context.audit, event, event.reason),
      };
    }),
    recordToolResult: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'TOOL_RESULT_RECORDED') {
        return {};
      }
      const observedToolResults = mergeToolResults(context.observedToolResults, [event.result]);
      const detail = [
        event.result.name,
        event.result.canonicalized ? 'canonicalized' : undefined,
        event.result.graphApplied ? 'graph_applied' : undefined,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join(':');
      return {
        observedToolResults,
        updatedAt: getTimestamp(event),
        audit: appendAudit(context.audit, event, detail),
      };
    }),
    recordToolResults: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'TOOL_RESULTS_RECORDED') {
        return {};
      }
      const observedToolResults = mergeToolResults(context.observedToolResults, event.results);
      return {
        observedToolResults,
        updatedAt: getTimestamp(event),
        audit: appendAudit(context.audit, event, `${event.results.length} result(s)`),
      };
    }),
    clearCompletedToolBoundary: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => ({
      expectedToolCalls: [],
      observedToolResults: [],
      updatedAt: getTimestamp(event),
      audit: appendAudit(context.audit, event, 'all expected tool results observed'),
    })),
    recordFinalizationHold: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'FINALIZATION_HELD') {
        return {};
      }
      return {
        finalizationHoldReason: event.reason,
        updatedAt: getTimestamp(event),
        audit: appendAudit(context.audit, event, event.reason),
      };
    }),
    recordFinalCandidateReady: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'FINAL_CANDIDATE_READY') {
        return {};
      }
      const timestamp = getTimestamp(event);
      return {
        expectedToolCalls: [],
        observedToolResults: [],
        finalizationHoldReason: undefined,
        terminalReason: event.reason,
        updatedAt: timestamp,
        audit: appendAudit(context.audit, event, event.reason ?? 'final candidate ready'),
      };
    }),
    recordFinalCandidateInvalidated: assignAgentControlGraph(
      ({ context, event }: AgentControlGraphAssignArgs) => {
        if (event.type !== 'FINAL_CANDIDATE_INVALIDATED') {
          return {};
        }
        return {
          expectedToolCalls: [],
          observedToolResults: [],
          terminalReason: undefined,
          updatedAt: getTimestamp(event),
          audit: appendAudit(context.audit, event, event.reason),
        };
      },
    ),
    recordGoalsUpdated: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'GOALS_UPDATED') {
        return {};
      }
      const goals = normalizeAgentRunControlGraphGoals(event.goals);
      const activeGoal = getActiveGoal(goals);
      return {
        goals: goals.length > 0 ? goals : undefined,
        ...(activeGoal ? { activeTaskId: activeGoal.id } : {}),
        updatedAt: getTimestamp(event),
        audit: appendAudit(context.audit, event, event.reason),
      };
    }),
    recordUserConstraintDeliveryAcknowledged: assignAgentControlGraph(
      ({ context, event }: AgentControlGraphAssignArgs) => {
        if (event.type !== 'USER_CONSTRAINT_DELIVERY_ACKNOWLEDGED') return {};
        return {
          goals: acknowledgeGoalUserConstraintDelivery(context.goals),
          updatedAt: getTimestamp(event),
          audit: appendAudit(context.audit, event),
        };
      },
    ),
    recordRequestUnderstandingProjected: assignAgentControlGraph(
      ({ context, event }: AgentControlGraphAssignArgs) => {
        if (event.type !== 'REQUEST_UNDERSTANDING_PROJECTED') {
          return {};
        }
        const requestUnderstanding = normalizeRequestUnderstandingSnapshot(event.projection);
        if (!requestUnderstanding) {
          return {};
        }
        return {
          requestUnderstanding,
          updatedAt: getTimestamp(event),
          audit: appendAudit(
            context.audit,
            event,
            `integrity:${requestUnderstanding.integrity}`,
          ),
        };
      },
    ),
    recordSessionActivatedToolsUpdated: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'SESSION_ACTIVATED_TOOLS_UPDATED') {
        return {};
      }
      const sessionActivatedToolNames = normalizeAgentRunControlGraphSessionActivatedToolNames(
        mergeSessionActivatedToolNames(context.sessionActivatedToolNames, event.toolNames),
      );
      return {
        sessionActivatedToolNames:
          sessionActivatedToolNames.length > 0 ? sessionActivatedToolNames : undefined,
        updatedAt: getTimestamp(event),
        audit: appendAudit(context.audit, event, event.reason),
      };
    }),
    recordGoalEvidenceAdded: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'GOAL_EVIDENCE_ADDED') {
        return {};
      }
      const currentGoals = context.goals ?? [];
      if (currentGoals.length === 0) {
        return {};
      }
      const updatedGoals = addGoalEvidence(
        currentGoals,
        event.goalId,
        event.evidence,
        getTimestamp(event),
      );
      return {
        goals: updatedGoals,
        updatedAt: getTimestamp(event),
        audit: appendAudit(context.audit, event, `evidence:${event.goalId}`),
      };
    }),
    recordObservabilityAudit: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'GRAPH_OBSERVABILITY_RECORDED') {
        return {};
      }

      const observabilityType = event.observabilityType?.trim();
      if (!observabilityType) {
        return {};
      }

      const timestamp = getTimestamp(event);
      return {
        audit: [
          ...context.audit,
          {
            type: observabilityType,
            timestamp,
            ...(event.iteration !== undefined ? { iteration: event.iteration } : {}),
            ...(event.detail ? { detail: event.detail } : {}),
          },
        ].slice(-MAX_AGENT_RUN_CONTROL_GRAPH_AUDIT_EVENTS),
        updatedAt: timestamp,
      };
    }),
    recordPerformanceMetrics: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'PERFORMANCE_METRICS_RECORDED') {
        return {};
      }
      const performance = mergePerformanceMetrics(
        context.performance,
        event.metrics,
        getTimestamp(event),
      );
      return {
        performance,
        updatedAt: getTimestamp(event),
        audit: appendAudit(context.audit, event, event.reason),
      };
    }),
    recordTurnDirectives: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'TURN_DIRECTIVES_RECORDED') {
        return {};
      }
      return {
        turnDirectives: mergeTurnDirectives(context.turnDirectives, event.directives),
        updatedAt: getTimestamp(event),
        audit: appendAudit(context.audit, event, event.reason),
      };
    }),
    consumeTurnDirectives: assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
      if (event.type !== 'TURN_DIRECTIVES_CONSUMED') {
        return {};
      }
      return {
        turnDirectives: clearOneShotTurnDirectives(context.turnDirectives),
        updatedAt: getTimestamp(event),
        audit: appendAudit(context.audit, event, event.reason),
      };
    }),
    recordAsyncWaiting: createRecordAsyncWaitingAction(),
    recordBlocked: recordAgentControlGraphTerminal('BLOCKED'),
    recordFinalized: recordAgentControlGraphTerminal('FINALIZED'),
    recordYielded: recordAgentControlGraphTerminal('YIELDED'),
    recordCancelled: recordAgentControlGraphTerminal('CANCELLED'),
    recordFailed: recordAgentControlGraphTerminal('FAILED'),
  };
}
