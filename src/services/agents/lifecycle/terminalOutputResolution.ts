import type { LlmProviderConfig } from '../../../types/provider';
import type { Message } from '../../../types/message';
import type { SubAgentCompletionState, SubAgentResult } from '../../../types/subAgent';
import type { TokenUsage } from '../../../types/usage';
import { normalizeFinalizationOutputText } from '../finalizationText';
import { synthesizeSubAgentFinalAnswer } from '../subAgentFinalization';
import {
  enforceExecutionWorkerOutputContract,
  type EnforcedExecutionWorkerOutput,
  type SubAgentToolResultPreview,
} from '../subAgentOutputContract';
import {
  buildSubAgentFinalizationPrompt,
  buildToolResultFallback,
} from './terminalOutputFallback';

export async function resolveSubAgentRunOutput(params: {
  status: SubAgentResult['status'];
  provider: LlmProviderConfig;
  model: string;
  systemPrompt: string;
  currentTaskPrompt: string;
  outputText: string;
  lastNonEmptyContent: string;
  finalNonEmptyContent: string;
  lastSubstantiveToolResult: string;
  toolsUsed: string[];
  toolResultPreviews: SubAgentToolResultPreview[];
  transcriptMessages: Message[];
  iterations: number;
  startedAt: number;
  timeoutMs?: number;
  outputTruncation: number;
  requireStructuredExecutionEvidence: boolean;
  maxToolResultPreviewChars: number;
  finalizationMaxTranscriptMessages: number;
  finalizationMessageCharLimit: number;
  finalizationToolContentCharLimit: number;
  finalizationMinRemainingMs: number;
  finalizationTimeoutCapMs: number;
  reportUsage: (usage: TokenUsage) => void;
  onFinalizationStart: () => void;
  onFinalizedOutput: (output: string) => void;
}): Promise<EnforcedExecutionWorkerOutput> {
  const enforceOutputContract = (
    output: string,
    terminalStatus: SubAgentResult['status'] = 'completed',
    completionState?: SubAgentCompletionState,
  ): EnforcedExecutionWorkerOutput =>
    enforceExecutionWorkerOutputContract({
      output,
      completionState,
      toolsUsed: params.toolsUsed,
      toolResultPreviews: params.toolResultPreviews,
      requireStructuredExecutionEvidence: params.requireStructuredExecutionEvidence,
      terminalStatus,
      outputTruncation: params.outputTruncation,
    });

  if (params.finalNonEmptyContent) {
    return enforceOutputContract(params.finalNonEmptyContent, params.status);
  }

  const directOutput =
    params.toolsUsed.length === 0 ? normalizeFinalizationOutputText(params.outputText) : undefined;
  if (directOutput) {
    return enforceOutputContract(directOutput, params.status);
  }

  const hasToolEvidence =
    params.toolResultPreviews.length > 0 ||
    !!params.lastSubstantiveToolResult ||
    !!params.lastNonEmptyContent ||
    params.transcriptMessages.length > 1 ||
    params.transcriptMessages.some((message) => message.role === 'tool') ||
    params.transcriptMessages.some(
      (message) => message.role === 'assistant' && (message.toolCalls?.length || 0) > 0,
    );
  const shouldAttemptFinalization =
    params.status === 'completed'
      ? params.toolsUsed.length > 0
      : params.status !== 'cancelled' && params.toolsUsed.length > 0 && hasToolEvidence;
  if (shouldAttemptFinalization) {
    const remainingBudgetMs =
      params.timeoutMs == null
        ? params.finalizationTimeoutCapMs
        : Math.max(0, params.timeoutMs - (Date.now() - params.startedAt) - 250);
    params.onFinalizationStart();
    const finalizedOutput = await synthesizeSubAgentFinalAnswer({
      provider: params.provider,
      model: params.model,
      systemPrompt: params.systemPrompt,
      userPrompt: buildSubAgentFinalizationPrompt({
        originalPrompt: params.currentTaskPrompt,
        transcriptMessages: params.transcriptMessages,
        toolsUsed: params.toolsUsed,
        iterations: params.iterations,
        finalizationMaxTranscriptMessages: params.finalizationMaxTranscriptMessages,
        finalizationMessageCharLimit: params.finalizationMessageCharLimit,
        finalizationToolContentCharLimit: params.finalizationToolContentCharLimit,
      }),
      remainingBudgetMs,
      finalizationMinRemainingMs: params.finalizationMinRemainingMs,
      finalizationTimeoutCapMs: params.finalizationTimeoutCapMs,
      outputTruncation: params.outputTruncation,
      reportUsage: params.reportUsage,
    });

    if (finalizedOutput) {
      const contractSafeOutput = enforceOutputContract(
        finalizedOutput.report,
        params.status,
        finalizedOutput.completionState,
      );
      params.onFinalizedOutput(contractSafeOutput.output);
      return contractSafeOutput;
    }
  }

  if (params.lastNonEmptyContent) {
    return enforceOutputContract(params.lastNonEmptyContent, params.status);
  }

  if (params.lastSubstantiveToolResult && !params.outputText.trim()) {
    return enforceOutputContract(params.lastSubstantiveToolResult, params.status);
  }

  return enforceExecutionWorkerOutputContract({
    output:
      buildToolResultFallback({
        status: params.status,
        lastNonEmptyContent: params.lastNonEmptyContent,
        toolResultPreviews: params.toolResultPreviews,
        toolsUsed: params.toolsUsed,
        iterations: params.iterations,
        maxToolResultPreviewChars: params.maxToolResultPreviewChars,
        outputTruncation: params.outputTruncation,
      }) || '',
    toolsUsed: params.toolsUsed,
    toolResultPreviews: params.toolResultPreviews,
    requireStructuredExecutionEvidence: params.requireStructuredExecutionEvidence,
    terminalStatus: params.status,
    outputTruncation: params.outputTruncation,
  });
}
