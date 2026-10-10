import type { AssistantCompletionMetadata } from '../../types/message';
import {
  buildIncompleteTextContinuationNote,
  shouldResumeIncompleteFinalTextTurn,
} from '../../services/llm/support/completionRecovery';
import type { ToolCallRecord } from '../loopDetection';
import { normalizeToolName } from '../tools/toolNameNormalization';
import {
  parseReadFileContinuationResult,
  READ_FILE_CONTINUATION_TOOL,
} from '../../utils/readFileContinuation';
import type { AgentControlTurnDirectives } from './agentControlGraph';
import type { CompletionGateDecision } from './completionGateTypes';

export function evaluateIncompleteToolContinuationHold(params: {
  toolingEnabledForProvider: boolean;
  selectedToolCount: number;
  selectedToolNames?: ReadonlySet<string>;
  forceTextThisTurn: boolean;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
}): CompletionGateDecision | null {
  if (
    !params.toolingEnabledForProvider ||
    params.selectedToolCount <= 0 ||
    params.forceTextThisTurn ||
    (params.selectedToolNames && !params.selectedToolNames.has(READ_FILE_CONTINUATION_TOOL))
  ) {
    return null;
  }

  const latest = params.toolCallHistory?.at(-1);
  if (
    !latest ||
    latest.status !== 'completed' ||
    normalizeToolName(latest.name) !== READ_FILE_CONTINUATION_TOOL ||
    typeof latest.result !== 'string'
  ) {
    return null;
  }

  const continuation = parseReadFileContinuationResult(latest.result);
  if (!continuation) return null;
  const requiredOffset = continuation.rereadOffset ?? continuation.nextOffset;
  if (
    continuation.rereadOffset === undefined &&
    (continuation.complete || requiredOffset === null)
  ) {
    return null;
  }

  return {
    type: 'hold',
    reason: 'incomplete_tool_continuation',
    graphEvent: {
      type: 'FINALIZATION_HELD',
      reason: 'incomplete_tool_continuation',
    },
    systemPrompts: [
      [
        '[SYSTEM TOOL CONTINUATION HOLD]',
        continuation.rereadOffset !== undefined
          ? 'The latest durable read_file checkpoint omitted the chunk body.'
          : 'The latest successful read_file result is a code-owned partial chunk.',
        `Continue with read_file using path ${JSON.stringify(continuation.path)} and offset ${requiredOffset}.`,
        continuation.rereadOffset !== undefined
          ? 'Do not finalize from checkpoint metadata alone. Reread the omitted chunk before relying on it or advancing.'
          : 'Do not finalize from a partial chunk. Continue until read_file returns complete:true or a concrete non-recoverable tool error occurs.',
      ].join('\n'),
    ],
    missingRequiredEvidenceLabels: [],
  };
}

export function evaluateDeliveryIncompleteHold(params: {
  fullContent: string;
  recoveryDirectives: AgentControlTurnDirectives;
  completion?: AssistantCompletionMetadata;
  nextFinalizationMaxTokens: number;
}): CompletionGateDecision | null {
  if (
    !shouldResumeIncompleteFinalTextTurn({
      completion: params.completion,
      fullContent: params.fullContent,
      recoveryCount: params.recoveryDirectives.incompleteFinalTextRecoveryCount,
    })
  ) {
    return null;
  }

  return {
    type: 'hold',
    reason: 'incomplete_delivery_continuation',
    graphEvent: {
      type: 'FINALIZATION_HELD',
      reason: 'incomplete_delivery_continuation',
    },
    systemPrompts: [buildIncompleteTextContinuationNote(params.completion?.finishReason)],
    missingRequiredEvidenceLabels: [],
    assistantContent: params.fullContent,
    turnDirectives: {
      forceFinalText: true,
      forcedTextReason: 'incomplete_delivery_continuation',
      maxTokensOverride: params.nextFinalizationMaxTokens,
      incompleteFinalTextRecoveryCount:
        params.recoveryDirectives.incompleteFinalTextRecoveryCount + 1,
      incompleteFinalTextContinuationPrefix: params.fullContent,
    },
  };
}
