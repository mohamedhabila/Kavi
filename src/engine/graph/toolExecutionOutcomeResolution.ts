import type { LivingMemoryBridgeOutput } from '../../services/memory/livingMemoryBridge';
import type { AgentRunControlGraphState } from '../../types/agentRun';
import type { Message } from '../../types/message';
import type { ToolEffectReceipt } from '../../types/toolEffectReceipt';
import type { ToolDefinition } from '../../types/tool';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import { type TrackedAsyncOperation } from '../pendingAsyncOperations';
import { type OrchestratorCompactionEvent } from '../orchestratorCompaction';
import type { ToolCallRecord } from '../loopDetection';
import { resolveToolEffectPolicy } from '../durability/toolEffectPolicy';
import { type AgentTurnCompactionEngine } from './agentTurnRequestBudget';
import type { AgentControlGraphEvent, AgentControlTurnDirectives } from './agentControlGraph';
import { agentControlGraphToolMessageShowsAsyncTerminalResolution } from './asyncTerminalResolution';
import { finalizeAgentControlGraphToolExecutionOutcomes } from './toolExecutionOutcomePostProcessing';
import type { AgentControlGraphWorkflowToolResultProgress } from './workflowToolResultProgress';
import { normalizeToolName, resolveRegisteredToolName } from '../tools/toolNameNormalization';
import { buildToolGoalEvidenceStrings } from '../goals/toolEvidence';
import { routeToolEvidenceToActiveGoals } from '../goals/evidenceRouting';
import {
  buildToolEffectReceiptEvidence,
  effectReceiptEvidenceTargetsCriterion,
  parseEffectCompletionCriterion,
  parseToolEffectReceiptEvidence,
} from '../goals/effectCompletionEvidence';
import {
  isBlockingGoal,
  isCodeOwnedEffectCompletionGoal,
  type AgentGoal,
} from '../goals/types';
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
import type { CodeOwnedCurrentUserMessage } from '../tools/toolExecutionContext';
import {
  buildToolMessageOutcome,
  type ToolMessageOutcome,
} from '../toolExecution/toolMessageOutcome';
import {
  parseRequestClarificationToolResult,
  REQUEST_CLARIFICATION_TOOL_NAME,
  type RequestClarificationToolResult,
} from '../../services/agents/requestClarification';
import {
  REQUEST_FRAME_VERSION,
  type RequestFrame,
} from '../../services/agents/requestFrame';
import { resolveRequestDecision } from '../../services/agents/requestDecisionPolicy';
import {
  projectRequestUnderstanding,
  summarizeRequestUnderstanding,
} from '../../services/agents/requestUnderstandingProjection';

export interface ToolExecutionOutcome {
  index: number;
  toolCallId: string;
  toolMessage: Message;
  yieldedMessage?: string;
  forceFinalText?: boolean;
  yieldCompletionNoteMessage?: string;
  skipWorkflowProgress?: boolean;
  effectReceipt?: ToolEffectReceipt;
  effectReconciliationRequired?: boolean;
}

function updateToolCallHistoryResult(params: {
  history: ToolCallRecord[] | undefined;
  toolCallId: string;
  toolName: string;
  argumentsText: string | undefined;
  result: string;
  status: ToolMessageOutcome['status'];
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
      status: params.status,
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

function collectCompletedBlockingGoalIds(goals: ReadonlyArray<AgentGoal> | undefined): Set<string> {
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
      !isCodeOwnedEffectCompletionGoal(goal) &&
      goal.status === 'completed' &&
      !params.before.has(goal.id),
  );
}

function buildTerminalFailedEffectGuardRemovalEvent(params: {
  goals: ReadonlyArray<AgentGoal>;
  receiptEvidence: string | undefined;
}): AgentControlGraphEvent | null {
  const receipt = params.receiptEvidence
    ? parseToolEffectReceiptEvidence(params.receiptEvidence)
    : null;
  if (
    !receipt ||
    (receipt.effectState !== 'failed' && receipt.effectState !== 'cancelled')
  ) {
    return null;
  }

  const removableGoalIds = new Set(
    params.goals
      .filter(
        (goal) =>
          isCodeOwnedEffectCompletionGoal(goal) &&
          (goal.status === 'active' || goal.status === 'blocked') &&
          (goal.successCriteria ?? []).some((criterion) => {
            const effectCriterion = parseEffectCompletionCriterion(criterion);
            return effectCriterion
              ? effectReceiptEvidenceTargetsCriterion(receipt, effectCriterion)
              : false;
          }),
      )
      .map((goal) => goal.id),
  );
  if (removableGoalIds.size === 0) {
    return null;
  }

  return {
    type: 'GOALS_UPDATED',
    goals: params.goals.filter((goal) => !removableGoalIds.has(goal.id)),
    reason: 'effect_completion_contract:terminal_failed_retired',
    projectToMemoryTasks: false,
    timestamp: Date.now(),
  };
}

function buildAppliedUnverifiedEffectGoalBlockEvent(params: {
  goals: ReadonlyArray<AgentGoal>;
  receiptEvidence: string | undefined;
}): AgentControlGraphEvent | null {
  const receipt = params.receiptEvidence
    ? parseToolEffectReceiptEvidence(params.receiptEvidence)
    : null;
  if (!receipt || receipt.effectState !== 'applied' || receipt.verificationState === 'verified') {
    return null;
  }

  const timestamp = Date.now();
  const targetGoalIds = new Set(
    params.goals
      .filter(
        (goal) =>
          goal.status === 'active' &&
          (goal.successCriteria ?? []).some((criterion) => {
            const effectCriterion = parseEffectCompletionCriterion(criterion);
            return effectCriterion
              ? effectReceiptEvidenceTargetsCriterion(receipt, effectCriterion)
              : false;
          }),
      )
      .map((goal) => goal.id),
  );
  if (targetGoalIds.size === 0) {
    return null;
  }

  return {
    type: 'GOALS_UPDATED',
    goals: params.goals.map((goal) =>
      targetGoalIds.has(goal.id)
        ? {
            ...goal,
            status: 'blocked' as const,
            blockedReason: `Effect applied but verification was incomplete (${receipt.receiptId}). Do not repeat the mutation.`,
            updatedAt: timestamp,
          }
        : goal,
    ),
    reason: 'effect_verification_incomplete',
    timestamp,
  };
}

function buildClarificationRequestUnderstanding(params: {
  graphSnapshot: AgentRunControlGraphState;
  request: RequestClarificationToolResult;
}) {
  const routing = params.graphSnapshot.requestUnderstanding?.routing;
  if (!routing || routing.status !== 'known') {
    return undefined;
  }
  const baseFrame: RequestFrame = {
    version: REQUEST_FRAME_VERSION,
    mode: routing.mode,
    input: {
      kind: routing.inputKind,
      attachmentCount: routing.attachmentCount,
    },
    continuation: routing.continuation,
    requiredInformation: [],
    decision: {
      action: 'act',
      reason: 'actionable_input',
    },
  };
  const clarificationFrame = resolveRequestDecision({
    frame: baseFrame,
    requiredInformation: params.request.requiredInformation,
    policyDisposition: 'allowed',
    permissionState: 'not_required',
    awaitingExternalOperation: false,
  });
  return summarizeRequestUnderstanding(
    projectRequestUnderstanding({
      requestFrame: clarificationFrame,
      goals: params.graphSnapshot.goals,
    }),
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
  currentUserMessage?: CodeOwnedCurrentUserMessage;
  compactionEngine: AgentTurnCompactionEngine;
  livingMemory?: LivingMemoryBridgeOutput | null;
  onCompaction?: (event: OrchestratorCompactionEvent) => void;
  warn: (message: string, error: unknown) => void;
  onToolMessage: (outcome: ToolMessageOutcome) => void | Promise<void>;
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
    graphEvent: Extract<
      AgentControlGraphEvent,
      { type: 'BLOCKED' } | { type: 'FINALIZED' } | { type: 'YIELDED' }
    >;
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
  let clarificationRequest: RequestClarificationToolResult | undefined;

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
        currentUserMessage: params.currentUserMessage,
        warn: params.warn,
      });
    }
    const toolName = resolveRegisteredToolName(
      canonicalOutcome.toolMessage.toolCalls?.[0]?.name ||
        executableToolCall?.name ||
        canonicalOutcome.toolCallId,
    );
    if (
      toolName === REQUEST_CLARIFICATION_TOOL_NAME &&
      !canonicalOutcome.toolMessage.isError
    ) {
      const parsedClarification = parseRequestClarificationToolResult(
        canonicalOutcome.toolMessage.content,
      );
      if (!parsedClarification) {
        throw new Error('request_clarification_result_invalid');
      }
      clarificationRequest ??= parsedClarification;
    }
    const toolResultCanAdvanceWorkflow =
      toolName !== 'update_goals' && toolName !== REQUEST_CLARIFICATION_TOOL_NAME;
    updateToolCallHistoryResult({
      history: params.toolCallHistory,
      toolCallId: canonicalOutcome.toolCallId,
      toolName,
      argumentsText: executableToolCall?.arguments,
      result: canonicalOutcome.toolMessage.content,
      status: canonicalOutcome.toolMessage.isError === true ? 'failed' : 'completed',
    });
    canonicalToolExecutionOutcomes.push(canonicalOutcome);

    workingMessages.push(canonicalOutcome.toolMessage);
    await params.onToolMessage(
      buildToolMessageOutcome({
        toolCallId: canonicalOutcome.toolCallId,
        toolMessage: canonicalOutcome.toolMessage,
      }),
    );

    const graphToolCall = canonicalOutcome.toolMessage.toolCalls?.[0];
    const effectPolicy = resolveToolEffectPolicy(toolName);
    const isCodeOwnedEffectFreeTool =
      effectPolicy.source !== 'unknown' &&
      effectPolicy.effects.every((effect) => effect === 'none');
    const structuralGoalEvidenceStrings =
      !canonicalOutcome.toolMessage.isError &&
      toolResultCanAdvanceWorkflow &&
      (canonicalOutcome.effectReceipt?.effectState === 'none' || isCodeOwnedEffectFreeTool)
        ? buildToolGoalEvidenceStrings({
            toolName,
            content: canonicalOutcome.toolMessage.content,
          })
        : [];
    const effectReceiptEvidenceStrings = canonicalOutcome.effectReceipt
      ? [buildToolEffectReceiptEvidence(canonicalOutcome.effectReceipt)]
      : [];
    const toolGoalEvidenceStrings = [
      ...structuralGoalEvidenceStrings,
      ...effectReceiptEvidenceStrings,
    ];
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
    let delegationEvidenceApplied = false;
    if (!canonicalOutcome.toolMessage.isError && toolResultCanAdvanceWorkflow) {
      const snapshot = params.getGraphSnapshot();
      const delegationTerminal = buildDelegationToolTerminalGraphEvents({
        toolName,
        resultContent: canonicalOutcome.toolMessage.content,
        run: { controlGraph: snapshot },
      });
      if (delegationTerminal.events.length > 0) {
        params.applyGraphEvents(delegationTerminal.events);
        delegationEvidenceApplied = delegationTerminal.applied;
        if (delegationTerminal.applied) {
          const delegationAutoCompleteEvent = buildDelegationEvidenceAutoCompleteEvent({
            goals: params.getGraphSnapshot().goals ?? [],
          });
          if (delegationAutoCompleteEvent) {
            params.applyGraphEvents([delegationAutoCompleteEvent]);
          }
        }
      }
    }

    if (toolResultCanAdvanceWorkflow) {
      const evidenceRoutableGoals = (params.getGraphSnapshot().goals ?? []).filter(
        (goal) => goal.status === 'active' || goal.status === 'blocked',
      );
      const routableEvidenceStrings = delegationEvidenceApplied
        ? effectReceiptEvidenceStrings
        : toolGoalEvidenceStrings;
      if (routableEvidenceStrings.length > 0 && evidenceRoutableGoals.length > 0) {
        const routedEvidence = routeToolEvidenceToActiveGoals({
          toolName,
          toolDefinitions: params.groundedRequestScopedTools,
          goals: evidenceRoutableGoals,
          evidenceStrings: routableEvidenceStrings,
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
        const unverifiedEffectBlockEvent = buildAppliedUnverifiedEffectGoalBlockEvent({
          goals: params.getGraphSnapshot().goals ?? [],
          receiptEvidence: effectReceiptEvidenceStrings[0],
        });
        if (unverifiedEffectBlockEvent) {
          params.applyGraphEvents([unverifiedEffectBlockEvent]);
        }
        const terminalFailedEffectGuardRemovalEvent =
          buildTerminalFailedEffectGuardRemovalEvent({
            goals: params.getGraphSnapshot().goals ?? [],
            receiptEvidence: effectReceiptEvidenceStrings[0],
          });
        if (terminalFailedEffectGuardRemovalEvent) {
          params.applyGraphEvents([terminalFailedEffectGuardRemovalEvent]);
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

    if (
      !canonicalOutcome.skipWorkflowProgress &&
      toolName !== REQUEST_CLARIFICATION_TOOL_NAME
    ) {
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

  if (clarificationRequest) {
    const requestUnderstanding = buildClarificationRequestUnderstanding({
      graphSnapshot: params.getGraphSnapshot(),
      request: clarificationRequest,
    });
    if (requestUnderstanding) {
      params.applyGraphEvents([
        {
          type: 'REQUEST_UNDERSTANDING_PROJECTED',
          projection: requestUnderstanding,
          iteration: params.iteration,
        },
      ]);
    }
    await params.finishWithGraphTerminalEvent({
      graphEvent: {
        type: 'FINALIZED',
        reason: 'request_clarification',
      },
      content: clarificationRequest.question,
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: 'request_clarification',
      }),
      sessionEndReason: 'request_clarification',
    });
    return {
      status: 'finalized',
      lastPendingAsyncSignature: params.lastPendingAsyncSignature,
      workingMessages,
    };
  }

  if (canonicalToolExecutionOutcomes.some((outcome) => outcome.effectReconciliationRequired)) {
    await params.finishWithGraphTerminalEvent({
      graphEvent: {
        type: 'BLOCKED',
        reason: 'tool_effect_reconciliation_required',
      },
      content:
        'A tool may have changed external state, but its outcome could not be verified. ' +
        'This execution is stopped to prevent a duplicate mutation. Reconcile the external state or make a new explicit request before continuing.',
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'incomplete',
        finishReason: 'tool_effect_reconciliation_required',
      }),
      sessionEndReason: 'tool_effect_reconciliation_required',
    });
    return {
      status: 'finalized',
      lastPendingAsyncSignature: params.lastPendingAsyncSignature,
      workingMessages,
    };
  }

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
    (goal) => isBlockingGoal(goal) && (goal.status === 'active' || goal.status === 'pending'),
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
