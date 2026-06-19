import type {
  AssistantCompletionMetadata,
  Message,
  MessageProviderReplay,
} from '../../types/message';
import {
  isTokenBudgetExhaustedCompletion,
  normalizeCompletionFinishReason,
} from '../../services/llm/support/completionRecovery';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import { isToolResultErrorLike } from '../../utils/toolResultErrors';
import type { ToolDefinition } from '../../types/tool';
import {
  getPendingTrackedAsyncOperations,
  type TrackedAsyncOperation,
} from '../pendingAsyncOperations';
import type { ToolCallRecord } from '../loopDetection';
import { normalizeToolName } from '../tools/toolNameNormalization';
import {
  normalizeToolWorkflowContract,
  type ToolWorkflowProduction,
  workflowProductionSatisfiesConsumption,
} from '../tools/toolWorkflowContracts';
import type {
  AgentControlGraphEvent,
  AgentControlGraphSnapshot,
  AgentControlTurnDirectives,
} from './agentControlGraph';
import { getAgentControlGraphMissingToolResultIds } from './agentControlGraph';
import { evaluateCompletionGate, type CompletionGateHoldReason } from './completionGate';
import {
  buildCompletionGateObservabilityDetail,
  buildGraphObservabilityRecordedEvent,
  GRAPH_OBSERVABILITY_AUDIT_TYPES,
} from './graphObservability';

type FinalCandidateEvent = Extract<AgentControlGraphEvent, { type: 'FINAL_CANDIDATE_READY' }>;

type NoToolTurnResolutionResult =
  | {
      status: 'continued';
      nextConsecutivePendingAsyncNoToolTurns: number;
    }
  | {
      status: 'finalized';
    };

function appendTrailingSystemMessage(
  workingMessages: Message[],
  content: string,
  id: string,
): void {
  const previousMessage = workingMessages[workingMessages.length - 1];
  if (previousMessage?.role === 'system' && previousMessage.content === content) {
    return;
  }

  workingMessages.push({
    id,
    role: 'system',
    content,
    timestamp: Date.now(),
  });
}

function isMalformedToolCallCompletion(
  completion: AssistantCompletionMetadata | undefined,
): boolean {
  const normalizedReason = normalizeCompletionFinishReason(completion?.finishReason);
  return (
    normalizedReason === 'malformed_function_call' || normalizedReason === 'malformed_tool_call'
  );
}

function buildEmptyToolCallRetryPrompt(params: {
  selectedToolNames: ReadonlySet<string>;
  finishReason: string;
}): string {
  const toolNames = Array.from(params.selectedToolNames).filter(Boolean).sort();
  const reason = params.finishReason || 'empty_tool_response';
  return [
    '[SYSTEM TOOL CALL RETRY]',
    `The provider ended the previous response without a usable tool call (${reason}).`,
    `Available structural tools: ${toolNames.join(', ') || 'none'}.`,
    'Retry the turn with a valid JSON tool call when tool execution is required.',
    'Do not finalize with empty text while a selected tool is still required for this turn.',
  ].join('\n');
}

function resolveEmptyToolCallRetryReason(params: {
  completion: AssistantCompletionMetadata | undefined;
  effectiveForceTextThisTurn: boolean;
  selectedToolCount: number;
  turnAssistantContent: string;
}): CompletionGateHoldReason | undefined {
  if (
    params.effectiveForceTextThisTurn ||
    params.selectedToolCount <= 0 ||
    params.turnAssistantContent.trim().length > 0
  ) {
    return undefined;
  }

  if (isMalformedToolCallCompletion(params.completion)) {
    return 'malformed_tool_call_retry';
  }

  if (isTokenBudgetExhaustedCompletion(params.completion)) {
    return 'empty_tool_call_retry';
  }

  return undefined;
}

function resolvePendingWorkflowContinuationToolNames(params: {
  selectedTools: ReadonlyArray<ToolDefinition>;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
}): string[] {
  const selectedToolByName = new Map(
    params.selectedTools
      .map((tool): [string, ToolDefinition] => [normalizeToolName(tool.name), tool])
      .filter(([toolName]) => Boolean(toolName)),
  );
  if (selectedToolByName.size === 0) {
    return [];
  }

  const successfulToolNames = new Set<string>();
  const observedProductions: ToolWorkflowProduction[] = [];
  for (const entry of params.toolCallHistory ?? []) {
    const toolName = normalizeToolName(entry.name);
    const tool = selectedToolByName.get(toolName);
    if (!tool || isToolResultErrorLike(entry.result)) {
      continue;
    }
    successfulToolNames.add(toolName);
    for (const production of normalizeToolWorkflowContract(tool.contract).produces) {
      observedProductions.push(production);
    }
  }
  if (observedProductions.length === 0) {
    return [];
  }

  const pendingToolNames: string[] = [];
  for (const tool of params.selectedTools) {
    const toolName = normalizeToolName(tool.name);
    if (!toolName || successfulToolNames.has(toolName)) {
      continue;
    }
    const consumesObservedResource = normalizeToolWorkflowContract(tool.contract).consumes.some(
      (consumption) =>
        observedProductions.some((production) =>
          workflowProductionSatisfiesConsumption(production, consumption),
        ),
    );
    if (consumesObservedResource) {
      pendingToolNames.push(toolName);
    }
  }

  return Array.from(new Set(pendingToolNames));
}

async function continueNoToolTurn(params: {
  commandReason: CompletionGateHoldReason;
  nextConsecutivePendingAsyncNoToolTurns: number;
  onContinueThinking: (reason: CompletionGateHoldReason) => Promise<void>;
}): Promise<NoToolTurnResolutionResult> {
  await params.onContinueThinking(params.commandReason);
  return {
    status: 'continued',
    nextConsecutivePendingAsyncNoToolTurns: params.nextConsecutivePendingAsyncNoToolTurns,
  };
}

export async function resolveAgentControlGraphNoToolTurn(params: {
  iteration: number;
  trackedAsyncOperations: ReadonlyMap<string, TrackedAsyncOperation>;
  consecutivePendingAsyncNoToolTurns: number;
  turnAssistantContent: string;
  reasoning: string;
  providerReplay?: MessageProviderReplay;
  completion?: AssistantCompletionMetadata;
  controlGraph: AgentControlGraphSnapshot;
  toolingEnabledForProvider: boolean;
  selectedToolCount: number;
  selectedToolNames: ReadonlySet<string>;
  selectedTools: ReadonlyArray<ToolDefinition>;
  effectiveForceTextThisTurn: boolean;
  recoveryDirectives: AgentControlTurnDirectives;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
  nextFinalizationMaxTokens: number;
  workingMessages: Message[];
  applyGraphEvents: (events: ReadonlyArray<AgentControlGraphEvent>) => void;
  resetIncompleteFinalTextRecovery: (reason: string) => void;
  recordTurnDirectives: (directives: Partial<AgentControlTurnDirectives>, reason: string) => void;
  finishWithGraphFinalCandidateEvent: (params: {
    graphEvent: FinalCandidateEvent;
    content: string;
    providerReplay?: MessageProviderReplay;
    assistantMetadata: ReturnType<typeof buildAssistantMessageMetadata>;
    sessionEndReason?: string;
  }) => Promise<void>;
  onContinueThinking: (reason: CompletionGateHoldReason) => Promise<void>;
  onFinalizationHeld?: (params: {
    iteration: number;
    holdReason: string;
    missingRequiredEvidenceLabels: string[];
  }) => void;
}): Promise<NoToolTurnResolutionResult> {
  const missingToolResultIds = getAgentControlGraphMissingToolResultIds(params.controlGraph);
  if (missingToolResultIds.length > 0) {
    params.applyGraphEvents([
      buildGraphObservabilityRecordedEvent({
        observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.TOOL_BATCH_INCOMPLETE,
        iteration: params.iteration,
        detail: `unsettled_tool_results:${missingToolResultIds.join(',')}`,
      }),
    ]);
    return continueNoToolTurn({
      commandReason: 'unsettled_tool_results',
      nextConsecutivePendingAsyncNoToolTurns: params.consecutivePendingAsyncNoToolTurns,
      onContinueThinking: params.onContinueThinking,
    });
  }

  const emptyToolCallRetryReason = resolveEmptyToolCallRetryReason({
    completion: params.completion,
    effectiveForceTextThisTurn: params.effectiveForceTextThisTurn,
    selectedToolCount: params.selectedToolCount,
    turnAssistantContent: params.turnAssistantContent,
  });
  if (emptyToolCallRetryReason) {
    params.applyGraphEvents([
      {
        type: 'FINALIZATION_HELD',
        reason: emptyToolCallRetryReason,
      },
    ]);
    params.onFinalizationHeld?.({
      iteration: params.iteration,
      holdReason: emptyToolCallRetryReason,
      missingRequiredEvidenceLabels: [],
    });
    if (emptyToolCallRetryReason === 'empty_tool_call_retry') {
      params.recordTurnDirectives(
        { maxTokensOverride: params.nextFinalizationMaxTokens },
        emptyToolCallRetryReason,
      );
    }
    appendTrailingSystemMessage(
      params.workingMessages,
      buildEmptyToolCallRetryPrompt({
        selectedToolNames: params.selectedToolNames,
        finishReason: normalizeCompletionFinishReason(params.completion?.finishReason),
      }),
      `msg_${Date.now()}_${emptyToolCallRetryReason}_${params.iteration}`,
    );
    return continueNoToolTurn({
      commandReason: emptyToolCallRetryReason,
      nextConsecutivePendingAsyncNoToolTurns: params.consecutivePendingAsyncNoToolTurns,
      onContinueThinking: params.onContinueThinking,
    });
  }

  const pendingAsyncOperations = getPendingTrackedAsyncOperations(params.trackedAsyncOperations);
  const evaluateGate = (goals: typeof params.controlGraph.goals) =>
    evaluateCompletionGate({
      trackedOperations: params.trackedAsyncOperations,
      pendingOperations: pendingAsyncOperations,
      consecutivePendingAsyncNoToolTurns: params.consecutivePendingAsyncNoToolTurns,
      hasDraftContent: params.turnAssistantContent.trim().length > 0,
      goals: goals ?? [],
      toolingEnabledForProvider: params.toolingEnabledForProvider,
      selectedToolCount: params.selectedToolCount,
      selectedToolNames: params.selectedToolNames,
      forceTextThisTurn: params.effectiveForceTextThisTurn,
      fullContent: params.turnAssistantContent,
      recoveryDirectives: params.recoveryDirectives,
      toolCallHistory: params.toolCallHistory,
      pendingWorkflowContinuationToolNames: resolvePendingWorkflowContinuationToolNames({
        selectedTools: params.selectedTools,
        toolCallHistory: params.toolCallHistory,
      }),
      completion: params.completion,
      nextFinalizationMaxTokens: params.nextFinalizationMaxTokens,
    });

  let gateDecision = evaluateGate(params.controlGraph.goals);

  params.applyGraphEvents([
    buildGraphObservabilityRecordedEvent({
      observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.COMPLETION_GATE,
      iteration: params.iteration,
      detail: buildCompletionGateObservabilityDetail(gateDecision),
    }),
  ]);

  if (gateDecision.type === 'auto_complete_goals') {
    params.applyGraphEvents([gateDecision.graphEvent]);
    gateDecision = evaluateGate(gateDecision.graphEvent.goals);
    params.applyGraphEvents([
      buildGraphObservabilityRecordedEvent({
        observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.COMPLETION_GATE,
        iteration: params.iteration,
        detail: buildCompletionGateObservabilityDetail(gateDecision),
      }),
    ]);
  }

  if (gateDecision.type === 'hold') {
    params.applyGraphEvents([gateDecision.graphEvent]);
    params.resetIncompleteFinalTextRecovery(gateDecision.reason);

    if (gateDecision.reason === 'incomplete_delivery_continuation') {
      if (gateDecision.turnDirectives) {
        params.recordTurnDirectives(gateDecision.turnDirectives, gateDecision.reason);
      }
      params.workingMessages.push({
        id: `msg_${Date.now()}_incomplete_final_text_${params.iteration}`,
        role: 'assistant',
        content: gateDecision.assistantContent ?? params.turnAssistantContent,
        timestamp: Date.now(),
        ...(params.reasoning ? { reasoning: params.reasoning } : {}),
        ...(params.providerReplay ? { providerReplay: params.providerReplay } : {}),
        assistantMetadata: buildAssistantMessageMetadata('intermediate', params.completion),
      });
      for (const [promptIndex, systemPrompt] of gateDecision.systemPrompts.entries()) {
        appendTrailingSystemMessage(
          params.workingMessages,
          systemPrompt,
          `msg_${Date.now()}_incomplete_final_text_note_${params.iteration}_${promptIndex}`,
        );
      }
    } else {
      params.onFinalizationHeld?.({
        iteration: params.iteration,
        holdReason: gateDecision.reason,
        missingRequiredEvidenceLabels: gateDecision.missingRequiredEvidenceLabels,
      });
      for (const [promptIndex, systemPrompt] of gateDecision.systemPrompts.entries()) {
        appendTrailingSystemMessage(
          params.workingMessages,
          systemPrompt,
          `msg_${Date.now()}_completion_hold_${params.iteration}_${promptIndex}`,
        );
      }
    }

    return continueNoToolTurn({
      commandReason: gateDecision.reason,
      nextConsecutivePendingAsyncNoToolTurns:
        gateDecision.nextConsecutivePendingAsyncNoToolTurns ?? 0,
      onContinueThinking: params.onContinueThinking,
    });
  }

  params.resetIncompleteFinalTextRecovery('finalization_complete');
  await params.finishWithGraphFinalCandidateEvent({
    graphEvent: {
      type: 'FINAL_CANDIDATE_READY',
      reason: params.completion?.finishReason ?? 'final_candidate_ready',
    },
    content: params.turnAssistantContent,
    providerReplay: params.providerReplay,
    assistantMetadata: buildAssistantMessageMetadata('final', params.completion),
    sessionEndReason: 'final_candidate_ready',
  });
  return { status: 'finalized' };
}
