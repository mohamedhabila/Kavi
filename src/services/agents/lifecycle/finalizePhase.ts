import { AgentRunStatus } from '../../../types/agentRun';
import { Message } from '../../../types/message';
import { SubAgentSnapshot } from '../../../types/subAgent';
import {
  FINALIZATION_RESULT_PREVIEW_CHARS,
  normalizeFinalizationOutputText,
  normalizeFinalizationPreviewText,
  summarizeFinalizationToolResultPreview,
} from '../finalizationText';
import { type AgentRunMessageScope, getAgentRunMessageSlice } from './agentRunStateMachine';
import {
  collectTerminalDeliverableFromSubAgent,
  collectTerminalDeliverablesFromToolResult,
  selectSingleTerminalDeliverableOutput,
  type AgentRunTerminalDeliverable,
} from '../finalizationDeliverables';
import type { AgentRunFinalizationEvidence, AgentRunResultPreview } from './finalizePhaseTypes';
import { isSessionToolSourceName } from '../approvalSignals';
import { buildSubAgentEvidenceActivityLines } from '../subAgentEvidence';
import { getAgentRunFinalizationToolNameForMessage } from '../agentRunFinalizationMessages';
import {
  buildAgentControlGraphFinalResponseRecoveryDecision,
  hasAgentControlGraphVerifiedFinalizationEvidence,
} from '../../../engine/graph/finalResponseRecovery';
export {
  buildAgentRunCompletionFallbackOutput,
  buildMissingFinalResponseFallback,
} from '../agentRunFinalizationFallbacks';
export {
  buildAgentRunFinalizationPrompt,
  synthesizeAgentRunFinalAnswer,
} from '../agentRunFinalizationSynthesis';

const MAX_RESULT_PREVIEW_CHARS = FINALIZATION_RESULT_PREVIEW_CHARS;

function updateLastSubstantiveResult(
  state: { value: string; sourceName?: string },
  result: string | undefined,
  sourceName: string | undefined,
): void {
  const normalizedResult = normalizeFinalizationOutputText(result);
  const normalizedSourceName = sourceName?.trim() || undefined;
  if (!normalizedResult) {
    return;
  }

  const nextIsSessionTool = isSessionToolSourceName(normalizedSourceName);
  const currentIsSessionTool = isSessionToolSourceName(state.sourceName);
  if (state.value && !currentIsSessionTool && nextIsSessionTool) {
    return;
  }

  state.value = normalizedResult;
  state.sourceName = normalizedSourceName;
}

function recordTerminalDeliverables(
  deliverables: AgentRunTerminalDeliverable[],
  state: { value: string; sourceName?: string },
  nextDeliverables: ReadonlyArray<AgentRunTerminalDeliverable>,
): void {
  for (const deliverable of nextDeliverables) {
    if (deliverables.some((existing) => existing.output === deliverable.output)) {
      continue;
    }

    deliverables.push(deliverable);
    updateLastSubstantiveResult(state, deliverable.output, deliverable.sourceName);
  }
}

export function collectAgentRunFinalizationEvidence(
  messages: Message[],
  scope: string | AgentRunMessageScope,
  iterations: number,
  options?: {
    liveSubAgentSnapshots?: ReadonlyArray<SubAgentSnapshot>;
    originalPromptOverride?: string;
  },
): AgentRunFinalizationEvidence {
  const runMessages = getAgentRunMessageSlice(messages, scope);
  const userMessageId = typeof scope === 'string' ? scope : scope.userMessageId;
  const transcriptMessages = [...runMessages];
  const originalPrompt =
    normalizeFinalizationOutputText(options?.originalPromptOverride) ||
    normalizeFinalizationOutputText(
      runMessages.find((message) => message.id === userMessageId && message.role === 'user')
        ?.content,
    ) ||
    normalizeFinalizationOutputText(
      runMessages.find((message) => message.role === 'user')?.content,
    ) ||
    'Complete the current task.';

  let lastNonEmptyAssistantContent = '';
  const lastSubstantiveResultState: { value: string; sourceName?: string } = { value: '' };
  const resultPreviews: AgentRunResultPreview[] = [];
  const terminalDeliverables: AgentRunTerminalDeliverable[] = [];
  const toolsUsed: string[] = [];
  const seenSubAgentSessionIds = new Set<string>();
  let hasIncompleteToolCalls = false;

  for (const message of runMessages) {
    if (message.role === 'assistant') {
      if (
        (message.toolCalls ?? []).some(
          (toolCall) =>
            toolCall.status === 'pending' ||
            toolCall.status === 'running' ||
            (toolCall.status === 'failed' &&
              !normalizeFinalizationOutputText(toolCall.error || toolCall.result)),
        )
      ) {
        hasIncompleteToolCalls = true;
      }

      const assistantContent = normalizeFinalizationOutputText(message.content);
      if (!message.subAgentEvent && assistantContent) {
        lastNonEmptyAssistantContent = assistantContent;
      }

      if (message.subAgentEvent) {
        const snapshot = message.subAgentEvent.snapshot;
        seenSubAgentSessionIds.add(snapshot.sessionId);
        for (const toolName of snapshot.toolsUsed ?? []) {
          if (toolName?.trim()) {
            toolsUsed.push(toolName.trim());
          }
        }
        const workerName = snapshot.name?.trim() || snapshot.sessionId;
        const preview = normalizeFinalizationPreviewText(
          snapshot.output ||
            snapshot.lastToolResultPreview ||
            snapshot.currentActivity ||
            message.content,
          MAX_RESULT_PREVIEW_CHARS,
        );
        if (preview) {
          resultPreviews.push({ sourceName: workerName, preview });
        }
        for (const activityLine of buildSubAgentEvidenceActivityLines(snapshot)) {
          resultPreviews.push({ sourceName: workerName, preview: activityLine });
        }
        const terminalDeliverable = collectTerminalDeliverableFromSubAgent({
          status: snapshot.status,
          output: snapshot.output,
          sourceName: workerName,
        });
        if (terminalDeliverable) {
          recordTerminalDeliverables(terminalDeliverables, lastSubstantiveResultState, [
            terminalDeliverable,
          ]);
        }
        if (snapshot.output && snapshot.output.trim().length > 30) {
          updateLastSubstantiveResult(lastSubstantiveResultState, snapshot.output, workerName);
        }
      }

      for (const toolCall of message.toolCalls ?? []) {
        if (toolCall.name?.trim()) {
          toolsUsed.push(toolCall.name.trim());
        }

        const preview = summarizeFinalizationToolResultPreview(toolCall.result || toolCall.error);
        if (preview) {
          resultPreviews.push({
            sourceName: toolCall.name?.trim() || 'tool',
            preview,
          });
        }

        recordTerminalDeliverables(
          terminalDeliverables,
          lastSubstantiveResultState,
          collectTerminalDeliverablesFromToolResult(
            toolCall.result,
            toolCall.name?.trim() || 'tool',
          ),
        );

        if (toolCall.result && toolCall.status !== 'failed' && toolCall.result.trim().length > 30) {
          updateLastSubstantiveResult(
            lastSubstantiveResultState,
            toolCall.result,
            toolCall.name?.trim() || 'tool',
          );
        }
      }
      continue;
    }

    if (message.role === 'tool') {
      const toolName = getAgentRunFinalizationToolNameForMessage(message);
      toolsUsed.push(toolName);
      const preview = summarizeFinalizationToolResultPreview(message.content);
      if (preview) {
        resultPreviews.push({ sourceName: toolName, preview });
      }
      recordTerminalDeliverables(
        terminalDeliverables,
        lastSubstantiveResultState,
        collectTerminalDeliverablesFromToolResult(message.content, toolName),
      );
      if (!message.isError && message.content.trim().length > 30) {
        updateLastSubstantiveResult(lastSubstantiveResultState, message.content, toolName);
      }
    }
  }

  for (const snapshot of options?.liveSubAgentSnapshots ?? []) {
    if (seenSubAgentSessionIds.has(snapshot.sessionId)) {
      continue;
    }

    for (const toolName of snapshot.toolsUsed ?? []) {
      if (toolName?.trim()) {
        toolsUsed.push(toolName.trim());
      }
    }
    const workerName = snapshot.name?.trim() || snapshot.sessionId;
    const preview = normalizeFinalizationPreviewText(
      snapshot.output || snapshot.lastToolResultPreview || snapshot.currentActivity,
      MAX_RESULT_PREVIEW_CHARS,
    );
    if (preview) {
      resultPreviews.push({ sourceName: workerName, preview });
    }
    for (const activityLine of buildSubAgentEvidenceActivityLines(snapshot)) {
      resultPreviews.push({ sourceName: workerName, preview: activityLine });
    }
    const terminalDeliverable = collectTerminalDeliverableFromSubAgent({
      status: snapshot.status,
      output: snapshot.output,
      sourceName: workerName,
    });
    if (terminalDeliverable) {
      recordTerminalDeliverables(terminalDeliverables, lastSubstantiveResultState, [
        terminalDeliverable,
      ]);
    } else if (snapshot.output && snapshot.output.trim().length > 30) {
      updateLastSubstantiveResult(lastSubstantiveResultState, snapshot.output, workerName);
    }
    seenSubAgentSessionIds.add(snapshot.sessionId);
  }

  return {
    originalPrompt,
    transcriptMessages,
    lastNonEmptyAssistantContent,
    lastSubstantiveResult: lastSubstantiveResultState.value,
    lastSubstantiveResultSourceName: lastSubstantiveResultState.sourceName,
    resultPreviews,
    terminalDeliverables,
    toolsUsed,
    iterations,
    hasIncompleteToolCalls,
  };
}

export function selectAgentRunDirectTerminalFinalOutput(
  evidence: Pick<AgentRunFinalizationEvidence, 'terminalDeliverables'>,
): string | undefined {
  return selectSingleTerminalDeliverableOutput(evidence.terminalDeliverables ?? []);
}

export function hasVerifiedFinalizationEvidence(evidence: AgentRunFinalizationEvidence): boolean {
  return hasAgentControlGraphVerifiedFinalizationEvidence(evidence);
}

export function canRecoverAgentRunFinalResponse(params: {
  evidence: AgentRunFinalizationEvidence;
  hasProviderContext: boolean;
  status: Exclude<AgentRunStatus, 'running'>;
}): boolean {
  return buildAgentControlGraphFinalResponseRecoveryDecision(params).type === 'recover';
}

export function hasCompletedExecutionRecoveryEvidence(params: {
  evidence: AgentRunFinalizationEvidence;
  liveSubAgentSnapshots?: ReadonlyArray<Pick<SubAgentSnapshot, 'status'>>;
  pendingAsyncOperationCount?: number;
}): boolean {
  if (!hasVerifiedFinalizationEvidence(params.evidence)) {
    return false;
  }

  if (params.evidence.hasIncompleteToolCalls) {
    return false;
  }

  if ((params.pendingAsyncOperationCount ?? 0) > 0) {
    return false;
  }

  if ((params.liveSubAgentSnapshots ?? []).some((snapshot) => snapshot.status === 'running')) {
    return false;
  }

  return true;
}
