import type {
  AssistantCompletionMetadata,
  Message,
  MessageProviderReplay,
} from '../../types/message';
import {
  isTokenBudgetExhaustedCompletion,
  MAX_EMPTY_FINAL_TEXT_RECOVERIES,
  normalizeCompletionFinishReason,
} from '../../services/llm/support/completionRecovery';
import { containsRawProviderToolCallMarkup } from '../../utils/assistantTextSanitizer';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import {
  getPendingTrackedAsyncOperations,
  type TrackedAsyncOperation,
} from '../pendingAsyncOperations';
import type { ToolCallRecord } from '../loopDetection';
import { normalizeToolName } from '../tools/toolNameNormalization';
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

function requiresAgenticProgressValidation(controlGraph: AgentControlGraphSnapshot): boolean {
  const routing = controlGraph.requestUnderstanding?.routing;
  return (
    routing?.status === 'known' && routing.mode === 'agentic' && routing.decisionAction === 'act'
  );
}

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

const MAX_RECOVERY_COMPLETED_TOOL_NAMES = 8;

function resolveRecentCompletedToolNames(
  toolCallHistory: ReadonlyArray<ToolCallRecord> | undefined,
): string[] {
  const names: string[] = [];
  const observed = new Set<string>();

  for (let index = (toolCallHistory?.length ?? 0) - 1; index >= 0; index -= 1) {
    const entry = toolCallHistory?.[index];
    if (!entry || entry.status !== 'completed') {
      continue;
    }
    const name = normalizeToolName(entry.name);
    if (!name || observed.has(name)) {
      continue;
    }
    observed.add(name);
    names.unshift(name);
    if (names.length >= MAX_RECOVERY_COMPLETED_TOOL_NAMES) {
      break;
    }
  }

  return names;
}

function buildCompletedToolRecoveryLines(completedToolNames: ReadonlyArray<string>): string[] {
  if (completedToolNames.length === 0) {
    return [];
  }

  return [
    `Code-owned execution already recorded these tools as completed: ${completedToolNames.join(', ')}.`,
    'Treat their tool-result messages as the source of truth; do not claim a completed tool was unavailable or failed.',
  ];
}

function buildEmptyResponseRetryPrompt(params: {
  completedToolNames: ReadonlyArray<string>;
  rawToolCallMarkup: boolean;
  selectedToolNames: ReadonlySet<string>;
  finishReason: string;
  toolsMayBeUsed: boolean;
}): string {
  const completedToolLines = buildCompletedToolRecoveryLines(params.completedToolNames);
  if (params.rawToolCallMarkup) {
    if (params.toolsMayBeUsed) {
      const toolNames = Array.from(params.selectedToolNames).filter(Boolean).sort();
      return [
        '[SYSTEM INVALID TOOL CALL RETRY]',
        'The previous response exposed provider tool-call markup as visible chat text instead of issuing a native tool call.',
        `Available structural tools: ${toolNames.join(', ') || 'none'}.`,
        ...completedToolLines,
        'Reissue the intended action now as one native structured tool call with valid JSON arguments.',
        'Do not output tool-call tags, function blocks, XML-like tool syntax, or explanatory prose.',
      ].join('\n');
    }
    return [
      '[SYSTEM INVALID FINAL RESPONSE RETRY]',
      'The previous response exposed provider tool-call markup as visible chat text.',
      'Return one concise user-facing answer from the verified tool results and graph state.',
      ...completedToolLines,
      'Do not emit tool-call tags, function blocks, XML-like tool syntax, or another tool request.',
      'Tools are unavailable for this recovery turn.',
    ].join('\n');
  }
  const toolNames = Array.from(params.selectedToolNames).filter(Boolean).sort();
  const reason = params.finishReason || 'empty_tool_response';
  if (!params.toolsMayBeUsed) {
    return [
      '[SYSTEM EMPTY RESPONSE RETRY]',
      `The provider ended the previous response without visible text (${reason}).`,
      'Return one concise, visible user-facing answer now.',
      ...completedToolLines,
      'State the verified outcome or the concrete blocker. Do not return an empty response.',
      'Tools are unavailable for this recovery turn.',
    ].join('\n');
  }

  return [
    '[SYSTEM TOOL CALL RETRY]',
    `The provider ended the previous response without visible text or a usable tool call (${reason}).`,
    `Available structural tools: ${toolNames.join(', ') || 'none'}.`,
    ...completedToolLines,
    'Continue the current request with a valid JSON tool call when work remains.',
    'Otherwise return a concise visible answer that states the verified outcome or concrete blocker.',
    'Do not return an empty response.',
  ].join('\n');
}

function resolveEmptyResponseRetryReason(params: {
  completion: AssistantCompletionMetadata | undefined;
  effectiveForceTextThisTurn: boolean;
  rawToolCallMarkup: boolean;
  recoveryCount: number;
  selectedToolCount: number;
  turnAssistantContent: string;
}): CompletionGateHoldReason | undefined {
  if (params.recoveryCount >= MAX_EMPTY_FINAL_TEXT_RECOVERIES) {
    return undefined;
  }
  if (params.rawToolCallMarkup) {
    return 'malformed_tool_call_retry';
  }
  if (params.turnAssistantContent.trim().length > 0) return undefined;

  const toolsMayBeUsed = !params.effectiveForceTextThisTurn && params.selectedToolCount > 0;
  if (toolsMayBeUsed && isMalformedToolCallCompletion(params.completion)) {
    return 'malformed_tool_call_retry';
  }

  if (toolsMayBeUsed && isTokenBudgetExhaustedCompletion(params.completion)) {
    return 'empty_tool_call_retry';
  }

  return 'empty_response_retry';
}

const EMPTY_FINAL_TEXT_FAILURE_REASON = 'empty_final_text_after_recovery';
const EMPTY_FINAL_TEXT_FAILURE_MESSAGE =
  "I couldn't complete this request because the model returned no usable response after bounded recovery attempts. Please retry or choose another model.";

async function continueNoToolTurn(params: {
  commandReason: CompletionGateHoldReason;
  commit?: () => void;
  nextConsecutivePendingAsyncNoToolTurns: number;
  onContinueThinking: (reason: CompletionGateHoldReason) => Promise<void>;
}): Promise<NoToolTurnResolutionResult> {
  await params.onContinueThinking(params.commandReason);
  params.commit?.();
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
  modelTurnAssistantContent: string;
  reasoning: string;
  providerReplay?: MessageProviderReplay;
  completion?: AssistantCompletionMetadata;
  controlGraph: AgentControlGraphSnapshot;
  toolingEnabledForProvider: boolean;
  selectedToolCount: number;
  selectedToolNames: ReadonlySet<string>;
  effectiveForceTextThisTurn: boolean;
  recoveryDirectives: AgentControlTurnDirectives;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
  nextFinalizationMaxTokens: number;
  workingMessages: Message[];
  commitModelTurn: () => void;
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
  finishWithGraphTerminalEvent: (params: {
    graphEvent: Extract<AgentControlGraphEvent, { type: 'BLOCKED' }>;
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
      commit: params.commitModelTurn,
      nextConsecutivePendingAsyncNoToolTurns: params.consecutivePendingAsyncNoToolTurns,
      onContinueThinking: params.onContinueThinking,
    });
  }

  const pendingAsyncOperations = getPendingTrackedAsyncOperations(params.trackedAsyncOperations);
  const rawToolCallMarkup = containsRawProviderToolCallMarkup(params.modelTurnAssistantContent);
  const emptyResponseRetryReason =
    pendingAsyncOperations.length === 0
      ? resolveEmptyResponseRetryReason({
          completion: params.completion,
          effectiveForceTextThisTurn: params.effectiveForceTextThisTurn,
          rawToolCallMarkup,
          recoveryCount: params.recoveryDirectives.incompleteFinalTextRecoveryCount,
          selectedToolCount: params.selectedToolCount,
          turnAssistantContent: params.modelTurnAssistantContent,
        })
      : undefined;
  if (emptyResponseRetryReason) {
    const toolsMayBeUsed = !params.effectiveForceTextThisTurn && params.selectedToolCount > 0;
    const tokenBudgetExhausted = isTokenBudgetExhaustedCompletion(params.completion);
    return continueNoToolTurn({
      commandReason: emptyResponseRetryReason,
      commit: () => {
        params.commitModelTurn();
        params.applyGraphEvents([
          {
            type: 'FINALIZATION_HELD',
            reason: emptyResponseRetryReason,
          },
        ]);
        params.onFinalizationHeld?.({
          iteration: params.iteration,
          holdReason: emptyResponseRetryReason,
          missingRequiredEvidenceLabels: [],
        });
        params.recordTurnDirectives(
          {
            ...(!toolsMayBeUsed
              ? {
                  forceFinalText: true,
                  forcedTextReason: 'empty_delivery_recovery' as const,
                }
              : {}),
            ...(tokenBudgetExhausted
              ? { maxTokensOverride: params.nextFinalizationMaxTokens }
              : {}),
            incompleteFinalTextRecoveryCount:
              params.recoveryDirectives.incompleteFinalTextRecoveryCount + 1,
          },
          emptyResponseRetryReason,
        );
        appendTrailingSystemMessage(
          params.workingMessages,
          buildEmptyResponseRetryPrompt({
            completedToolNames: resolveRecentCompletedToolNames(params.toolCallHistory),
            rawToolCallMarkup,
            selectedToolNames: params.selectedToolNames,
            finishReason: normalizeCompletionFinishReason(params.completion?.finishReason),
            toolsMayBeUsed,
          }),
          `msg_${Date.now()}_${emptyResponseRetryReason}_${params.iteration}`,
        );
      },
      nextConsecutivePendingAsyncNoToolTurns: params.consecutivePendingAsyncNoToolTurns,
      onContinueThinking: params.onContinueThinking,
    });
  }

  if (
    pendingAsyncOperations.length === 0 &&
    (params.modelTurnAssistantContent.trim().length === 0 || rawToolCallMarkup)
  ) {
    params.commitModelTurn();
    await params.finishWithGraphTerminalEvent({
      graphEvent: {
        type: 'BLOCKED',
        reason: EMPTY_FINAL_TEXT_FAILURE_REASON,
      },
      content: EMPTY_FINAL_TEXT_FAILURE_MESSAGE,
      providerReplay: params.providerReplay,
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'incomplete',
        finishReason: EMPTY_FINAL_TEXT_FAILURE_REASON,
      }),
      sessionEndReason: EMPTY_FINAL_TEXT_FAILURE_REASON,
    });
    return { status: 'finalized' };
  }

  if (
    params.effectiveForceTextThisTurn &&
    params.recoveryDirectives.forcedTextReason === 'execution_loop_recovery'
  ) {
    params.commitModelTurn();
    await params.finishWithGraphTerminalEvent({
      graphEvent: {
        type: 'BLOCKED',
        reason: 'execution_loop_recovery',
      },
      content: params.turnAssistantContent,
      providerReplay: params.providerReplay,
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'incomplete',
        finishReason: 'execution_loop_recovery',
      }),
      sessionEndReason: 'execution_loop_recovery',
    });
    return { status: 'finalized' };
  }

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
      completion: params.completion,
      nextFinalizationMaxTokens: params.nextFinalizationMaxTokens,
      requiresAgenticProgressValidation: requiresAgenticProgressValidation(params.controlGraph),
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

  if (gateDecision.type === 'block') {
    params.commitModelTurn();
    await params.finishWithGraphTerminalEvent({
      graphEvent: gateDecision.graphEvent,
      content: gateDecision.content,
      providerReplay: params.providerReplay,
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'incomplete',
        finishReason: gateDecision.reason,
      }),
      sessionEndReason: gateDecision.reason,
    });
    return { status: 'finalized' };
  }

  if (gateDecision.type === 'hold') {
    return continueNoToolTurn({
      commandReason: gateDecision.reason,
      commit: () => {
        params.commitModelTurn();
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
      },
      nextConsecutivePendingAsyncNoToolTurns:
        gateDecision.nextConsecutivePendingAsyncNoToolTurns ?? 0,
      onContinueThinking: params.onContinueThinking,
    });
  }

  params.commitModelTurn();
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
