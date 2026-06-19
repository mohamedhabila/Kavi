import type { LivingMemoryBridgeOutput } from '../../services/memory/livingMemoryBridge';
import type { AgentRunControlGraphState } from '../../types/agentRun';
import type { Message } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import { type TrackedAsyncOperation } from '../pendingAsyncOperations';
import { type OrchestratorCompactionEvent } from '../orchestratorCompaction';
import type { ToolCallRecord } from '../loopDetection';
import { type AgentTurnCompactionEngine } from './agentTurnRequestBudget';
import type { AgentControlGraphEvent, AgentControlTurnDirectives } from './agentControlGraph';
import { agentControlGraphToolMessageShowsAsyncTerminalResolution } from './asyncTerminalResolution';
import { finalizeAgentControlGraphToolExecutionOutcomes } from './toolExecutionOutcomePostProcessing';
import type { AgentControlGraphWorkflowToolResultProgress } from './workflowToolResultProgress';
import { normalizeToolName, resolveRegisteredToolName } from '../tools/toolNameNormalization';
import { buildToolGoalEvidenceStrings } from '../goals/toolEvidence';
import { routeToolEvidenceToActiveGoals } from '../goals/evidenceRouting';
import { isBlockingGoal, type AgentGoal } from '../goals/types';
import { buildDelegationToolTerminalGraphEvents } from './delegationToolTerminalGraphEffects';
import {
  buildDelegationEvidenceAutoCompleteEvent,
  buildEvidenceSatisfiedGoalAutoCompleteEvent,
  findEvidenceSatisfiedGoals,
} from './completionGateGoalAutoComplete';
import { extractActivatedToolNamesFromDiscoveryToolResult } from './discoveryToolActivation';
import {
  canonicalizeToolExecutionOutcome,
  type CanonicalToolExecutionOutcome,
} from './toolExecutionOutcomeCanonicalization';

export interface ToolExecutionOutcome {
  index: number;
  toolCallId: string;
  toolMessage: Message;
  yieldedMessage?: string;
  forceFinalText?: boolean;
  yieldCompletionNoteMessage?: string;
  skipWorkflowProgress?: boolean;
}

function updateToolCallHistoryResult(params: {
  history: ToolCallRecord[] | undefined;
  toolCallId: string;
  toolName: string;
  argumentsText: string | undefined;
  result: string;
}): void {
  if (!params.history) {
    return;
  }

  for (let index = params.history.length - 1; index >= 0; index -= 1) {
    const entry = params.history[index];
    const idMatches = entry?.id && entry.id === params.toolCallId;
    const callMatches =
      !entry?.id &&
      entry?.name === params.toolName &&
      entry.arguments === (params.argumentsText ?? '{}');
    if (!entry || (!idMatches && !callMatches)) {
      continue;
    }

    params.history[index] = {
      ...entry,
      result: params.result,
    };
    return;
  }
}

function buildDeferredAfterGraphMutationOutcome(
  outcome: CanonicalToolExecutionOutcome,
): CanonicalToolExecutionOutcome {
  const toolName = outcome.toolMessage.toolCalls?.[0]?.name || outcome.toolCallId;
  const content = JSON.stringify(
    {
      status: 'deferred',
      reason: 'graph_mutation_boundary',
      tool: toolName,
    },
    null,
    2,
  );

  return {
    ...outcome,
    skipWorkflowProgress: true,
    toolMessage: {
      ...outcome.toolMessage,
      content,
      isError: false,
      toolCalls: outcome.toolMessage.toolCalls?.map((toolCall) =>
        toolCall.id === outcome.toolCallId
          ? { ...toolCall, result: content, status: 'completed' as const, error: undefined }
          : { ...toolCall },
      ),
    },
  };
}

function collectCompletedBlockingGoalIds(
  goals: ReadonlyArray<AgentGoal> | undefined,
): Set<string> {
  return new Set(
    (goals ?? [])
      .filter((goal) => isBlockingGoal(goal) && goal.status === 'completed')
      .map((goal) => goal.id),
  );
}

function hasNewlyCompletedBlockingGoal(params: {
  before: ReadonlySet<string>;
  after: ReadonlyArray<AgentGoal> | undefined;
}): boolean {
  return (params.after ?? []).some(
    (goal) =>
      isBlockingGoal(goal) &&
      goal.status === 'completed' &&
      !params.before.has(goal.id),
  );
}

export async function resolveAgentControlGraphToolExecutionOutcomes(params: {
  iteration: number;
  executableToolCalls: ReadonlyArray<{ name: string; arguments: string }>;
  toolExecutionOutcomes: ReadonlyArray<ToolExecutionOutcome>;
  groundedRequestScopedTools: ToolDefinition[];
  getGraphSnapshot: () => AgentRunControlGraphState;
  completedWorkflowToolNames: Set<string>;
  trackedAsyncOperations: ReadonlyMap<string, TrackedAsyncOperation>;
  toolCallHistory?: ToolCallRecord[];
  pendingAsyncMonitorToolNames: ReadonlySet<string>;
  lastPendingAsyncSignature: string;
  contextWindow: number;
  conversationId: string;
  compactionEngine: AgentTurnCompactionEngine;
  livingMemory?: LivingMemoryBridgeOutput | null;
  onCompaction?: (event: OrchestratorCompactionEvent) => void;
  warn: (message: string, error: unknown) => void;
  onToolMessage: (toolCallId: string, result: string) => void | Promise<void>;
  onStateChange: (state: 'thinking') => void;
  yieldToUiFrame: () => Promise<void>;
  applyGraphEvents: (events: ReadonlyArray<AgentControlGraphEvent>) => void;
  publishWorkflowToolResultProgress: (params: {
    toolMessage: Message;
    tools: ToolDefinition[];
    reason: string;
  }) => AgentControlGraphWorkflowToolResultProgress;
  syncPendingAsyncOperationsToGraph: () => void;
  recordTurnDirectives: (
    directives: Partial<AgentControlTurnDirectives>,
    reason: string,
  ) => unknown;
  recordPostToolFinalTextDirective: (params: {
    pendingAsyncCount: number;
    hasAsyncTerminalResolution?: boolean;
    hasActivePersistentGoal?: boolean;
    hasCompletedBlockingGoal?: boolean;
    hasIncompleteBlockingGoal?: boolean;
  }) => boolean;
  getModelTurnBlocker: () => string | undefined;
  finishWithGraphTerminalEvent: (params: {
    graphEvent: Extract<AgentControlGraphEvent, { type: 'YIELDED' }>;
    content: string;
    assistantMetadata: ReturnType<typeof buildAssistantMessageMetadata>;
    sessionEndReason?: string;
  }) => Promise<void>;
  workingMessages: Message[];
}): Promise<{
  status: 'continued' | 'finalized';
  lastPendingAsyncSignature: string;
  workingMessages: Message[];
}> {
  const completedBlockingGoalIdsBeforeTools = collectCompletedBlockingGoalIds(
    params.getGraphSnapshot().goals,
  );
  let yieldedTurnMessage: string | undefined;
  let forceFinalTextFromYieldThisTurn = false;
  let yieldCompletionNoteMessage: string | undefined;
  let workingMessages = params.workingMessages;
  const canonicalToolExecutionOutcomes: CanonicalToolExecutionOutcome[] = [];
  let graphMutationBoundaryReached = false;

  for (const outcome of [...params.toolExecutionOutcomes].sort(
    (left, right) => left.index - right.index,
  )) {
    const rawGraphToolCall = outcome.toolMessage.toolCalls?.[0];
    const executableToolCall = params.executableToolCalls[outcome.index];
    const rawToolName = resolveRegisteredToolName(
      rawGraphToolCall?.name || executableToolCall?.name || outcome.toolCallId,
    );
    let canonicalOutcome: CanonicalToolExecutionOutcome;
    if (graphMutationBoundaryReached && rawToolName === 'update_goals') {
      canonicalOutcome = buildDeferredAfterGraphMutationOutcome({
        ...outcome,
        canonicalized: false,
        graphApplied: false,
      });
    } else {
      canonicalOutcome = canonicalizeToolExecutionOutcome({
        outcome,
        toolName: rawToolName,
        executableToolCalls: params.executableToolCalls,
        toolCallHistory: params.toolCallHistory,
        getGraphSnapshot: params.getGraphSnapshot,
        applyGraphEvents: params.applyGraphEvents,
        conversationId: params.conversationId,
        warn: params.warn,
      });
    }
    const toolName = resolveRegisteredToolName(
      canonicalOutcome.toolMessage.toolCalls?.[0]?.name ||
        executableToolCall?.name ||
        canonicalOutcome.toolCallId,
    );
    updateToolCallHistoryResult({
      history: params.toolCallHistory,
      toolCallId: canonicalOutcome.toolCallId,
      toolName,
      argumentsText: executableToolCall?.arguments,
      result: canonicalOutcome.toolMessage.content,
    });
    canonicalToolExecutionOutcomes.push(canonicalOutcome);

    workingMessages.push(canonicalOutcome.toolMessage);
    await params.onToolMessage(canonicalOutcome.toolCallId, canonicalOutcome.toolMessage.content);

    const graphToolCall = canonicalOutcome.toolMessage.toolCalls?.[0];
    const toolGoalEvidenceStrings =
      !canonicalOutcome.toolMessage.isError && toolName !== 'update_goals'
        ? buildToolGoalEvidenceStrings({
            toolName,
            content: canonicalOutcome.toolMessage.content,
          })
        : [];
    params.applyGraphEvents([
      {
        type: 'TOOL_RESULT_RECORDED',
        result: {
          id: canonicalOutcome.toolCallId,
          name: graphToolCall?.name || executableToolCall?.name || canonicalOutcome.toolCallId,
          ...(canonicalOutcome.toolMessage.isError ? { failed: true } : {}),
          ...(canonicalOutcome.canonicalized ? { canonicalized: true } : {}),
          ...(canonicalOutcome.graphApplied ? { graphApplied: true } : {}),
          ...(toolGoalEvidenceStrings.length > 0 ? { evidence: toolGoalEvidenceStrings } : {}),
        },
      },
    ]);

    if (!canonicalOutcome.toolMessage.isError) {
      const discoveryActivatedToolNames = extractActivatedToolNamesFromDiscoveryToolResult(
        toolName,
        canonicalOutcome.toolMessage.content,
      );
      if (discoveryActivatedToolNames.length > 0) {
        params.applyGraphEvents([
          {
            type: 'SESSION_ACTIVATED_TOOLS_UPDATED',
            toolNames: discoveryActivatedToolNames,
            reason: `${toolName}:discovery`,
            timestamp: Date.now(),
          },
        ]);
      }
    }

    // ── Auto-link tool results to active goal evidence ───────────────────
    if (!canonicalOutcome.toolMessage.isError && toolName !== 'update_goals') {
      const snapshot = params.getGraphSnapshot();
      const delegationTerminal = buildDelegationToolTerminalGraphEvents({
        toolName,
        resultContent: canonicalOutcome.toolMessage.content,
        run: { controlGraph: snapshot },
      });
      if (delegationTerminal.events.length > 0) {
        params.applyGraphEvents(delegationTerminal.events);
        if (delegationTerminal.applied) {
          const delegationAutoCompleteEvent = buildDelegationEvidenceAutoCompleteEvent({
            goals: params.getGraphSnapshot().goals ?? [],
          });
          if (delegationAutoCompleteEvent) {
            params.applyGraphEvents([delegationAutoCompleteEvent]);
          }
        }
      }

      const evidenceRoutableGoals = (params.getGraphSnapshot().goals ?? []).filter(
        (goal) => goal.status === 'active' || goal.status === 'blocked',
      );
      const skipGenericEvidence = delegationTerminal.applied;
      if (!skipGenericEvidence && evidenceRoutableGoals.length > 0) {
        const routedEvidence = routeToolEvidenceToActiveGoals({
          toolName,
          toolDefinitions: params.groundedRequestScopedTools,
          goals: evidenceRoutableGoals,
          evidenceStrings: toolGoalEvidenceStrings,
        });
        for (const routed of routedEvidence) {
          params.applyGraphEvents([
            {
              type: 'GOAL_EVIDENCE_ADDED',
              goalId: routed.goalId,
              evidence: routed.evidence,
              timestamp: Date.now(),
            },
          ]);
        }
        if (routedEvidence.length > 0) {
          const satisfiedGoals = findEvidenceSatisfiedGoals(params.getGraphSnapshot().goals ?? []);
          if (satisfiedGoals.length > 0) {
            const autoCompleteEvent = buildEvidenceSatisfiedGoalAutoCompleteEvent({
              goals: params.getGraphSnapshot().goals ?? [],
              goalIds: satisfiedGoals.map((goal) => goal.id),
            });
            if (autoCompleteEvent) {
              params.applyGraphEvents([autoCompleteEvent]);
            }
          }
        }
      }
    }

    if (!canonicalOutcome.skipWorkflowProgress) {
      params.publishWorkflowToolResultProgress({
        toolMessage: canonicalOutcome.toolMessage,
        tools: params.groundedRequestScopedTools,
        reason: 'tool_result',
      });
    }

    if (!yieldedTurnMessage && canonicalOutcome.yieldedMessage) {
      yieldedTurnMessage = canonicalOutcome.yieldedMessage;
    }
    if (canonicalOutcome.forceFinalText) {
      forceFinalTextFromYieldThisTurn = true;
      yieldCompletionNoteMessage =
        canonicalOutcome.yieldCompletionNoteMessage || yieldCompletionNoteMessage;
    }
    if (toolName === 'update_goals' && canonicalOutcome.graphApplied) {
      graphMutationBoundaryReached = true;
    }
  }

  await params.yieldToUiFrame();

  const postToolGraphBlocker = params.getModelTurnBlocker();
  if (postToolGraphBlocker) {
    throw new Error(
      `Invariant violation after tool execution ${params.iteration}: ${postToolGraphBlocker}`,
    );
  }

  const latestGoals = params.getGraphSnapshot().goals ?? [];
  const hasActivePersistentGoal = latestGoals.some(
    (goal) => goal.status === 'active' && !isBlockingGoal(goal),
  );
  const hasCompletedBlockingGoal = hasNewlyCompletedBlockingGoal({
    before: completedBlockingGoalIdsBeforeTools,
    after: latestGoals,
  });
  const hasIncompleteBlockingGoal = latestGoals.some(
    (goal) =>
      isBlockingGoal(goal) && (goal.status === 'active' || goal.status === 'pending'),
  );

  return finalizeAgentControlGraphToolExecutionOutcomes({
    iteration: params.iteration,
    trackedAsyncOperations: params.trackedAsyncOperations,
    lastPendingAsyncSignature: params.lastPendingAsyncSignature,
    contextWindow: params.contextWindow,
    conversationId: params.conversationId,
    compactionEngine: params.compactionEngine,
    livingMemory: params.livingMemory,
    onCompaction: params.onCompaction,
    warn: params.warn,
    onStateChange: params.onStateChange,
    applyGraphEvents: params.applyGraphEvents,
    syncPendingAsyncOperationsToGraph: params.syncPendingAsyncOperationsToGraph,
    recordTurnDirectives: params.recordTurnDirectives,
    recordPostToolFinalTextDirective: params.recordPostToolFinalTextDirective,
    finishWithGraphTerminalEvent: params.finishWithGraphTerminalEvent,
    yieldedTurnMessage,
    forceFinalTextFromYieldThisTurn,
    yieldCompletionNoteMessage,
    hasAsyncTerminalResolution:
      canonicalToolExecutionOutcomes.some((outcome) =>
        agentControlGraphToolMessageShowsAsyncTerminalResolution(outcome.toolMessage),
      ) &&
      params.executableToolCalls.some((toolCall) =>
        params.pendingAsyncMonitorToolNames.has(normalizeToolName(toolCall.name)),
      ),
    hasActivePersistentGoal,
    hasCompletedBlockingGoal,
    hasIncompleteBlockingGoal,
    workingMessages,
  });
}
