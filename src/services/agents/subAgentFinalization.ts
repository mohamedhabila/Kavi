import type { LlmProviderConfig } from '../../types/provider';
import type { SubAgentCompletionState } from '../../types/subAgent';
import type { TokenUsage } from '../../types/usage';
import { estimateMessageTokens, estimateTokens } from '../context/tokenCounter';
import { resolveFinalizationMaxTokens } from '../context/tokenOptimization';
import { LlmService } from '../llm/LlmService';
import { extractResponseTokenUsage } from '../usage/conversationUsage';
import { createLogger } from '../../utils/logger';
import { normalizeFinalizationOutputText } from './finalizationText';

const logger = createLogger('SubAgentFinalization');

const SUB_AGENT_FINALIZATION_OUTPUT = {
  name: 'worker_final_report',
  mimeType: 'application/json',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      report: {
        type: 'string',
        description: 'Concise visible worker report for the supervising agent.',
      },
      completionState: {
        type: 'string',
        enum: ['verified_success', 'blocked', 'incomplete'],
        description: 'Structured worker completion state.',
      },
    },
    required: ['report', 'completionState'],
  },
} as const;

export type SynthesizedSubAgentFinalAnswer = {
  report: string;
  completionState: SubAgentCompletionState;
};

function extractStructuredFinalizationOutput(
  response: unknown,
  outputTruncation: number,
): SynthesizedSubAgentFinalAnswer | undefined {
  const parsed = (response as { output_parsed?: unknown } | undefined)?.output_parsed;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }

  const report = normalizeFinalizationOutputText(
    typeof (parsed as { report?: unknown }).report === 'string'
      ? (parsed as { report?: string }).report
      : undefined,
    outputTruncation,
  );
  const completionState = (parsed as { completionState?: unknown }).completionState;
  if (
    !report ||
    (completionState !== 'verified_success' &&
      completionState !== 'blocked' &&
      completionState !== 'incomplete')
  ) {
    return undefined;
  }

  return {
    report,
    completionState,
  };
}

export async function synthesizeSubAgentFinalAnswer(params: {
  provider: LlmProviderConfig;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  remainingBudgetMs: number;
  finalizationMinRemainingMs: number;
  finalizationTimeoutCapMs: number;
  outputTruncation: number;
  reportUsage?: (usage: TokenUsage) => void;
}): Promise<SynthesizedSubAgentFinalAnswer | undefined> {
  if (params.remainingBudgetMs < params.finalizationMinRemainingMs) {
    return undefined;
  }

  const finalizationTimeoutMs = Math.min(
    params.finalizationTimeoutCapMs,
    Math.max(params.finalizationMinRemainingMs, params.remainingBudgetMs),
  );
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => {
    controller.abort();
  }, finalizationTimeoutMs);
  (timeoutTimer as any)?.unref?.();

  let finalAnswer: SynthesizedSubAgentFinalAnswer | undefined;
  let latestUsage: TokenUsage | undefined;
  let usageReported = false;
  const requestMessages = [
    {
      role: 'system' as const,
      content: `${params.systemPrompt}\n\n## Finalization Pass\nTools are unavailable for this pass. Produce the final worker report for the supervising agent using only the verified transcript and tool results provided. Return only the structured final worker output.`,
    },
    {
      role: 'user' as const,
      content: params.userPrompt,
    },
  ];

  const mergeUsageSnapshot = (usage: TokenUsage): void => {
    const nextInputTokens = Math.max(latestUsage?.inputTokens ?? 0, usage.inputTokens ?? 0);
    const nextOutputTokens = Math.max(latestUsage?.outputTokens ?? 0, usage.outputTokens ?? 0);
    latestUsage = {
      model: usage.model || latestUsage?.model || params.model,
      inputTokens: nextInputTokens,
      outputTokens: nextOutputTokens,
      cacheReadTokens: Math.max(latestUsage?.cacheReadTokens ?? 0, usage.cacheReadTokens ?? 0),
      cacheWriteTokens: Math.max(latestUsage?.cacheWriteTokens ?? 0, usage.cacheWriteTokens ?? 0),
      totalTokens: Math.max(
        latestUsage?.totalTokens ?? 0,
        usage.totalTokens ?? 0,
        nextInputTokens + nextOutputTokens,
      ),
    };
  };

  const flushUsage = (): void => {
    if (usageReported || !params.reportUsage) {
      return;
    }

    if (!latestUsage) {
      const inputTokens = estimateMessageTokens(requestMessages);
      const outputTokens = estimateTokens(finalAnswer?.report || '');
      latestUsage = {
        model: params.model,
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: inputTokens + outputTokens,
      };
    }

    usageReported = true;
    params.reportUsage(latestUsage);
  };

  try {
    const llm = new LlmService(params.provider);
    const response = await llm.sendMessage(requestMessages, {
      model: params.model,
      maxTokens: resolveFinalizationMaxTokens(params.model),
      signal: controller.signal,
      reasoning_effort: 'none',
      structuredOutput: SUB_AGENT_FINALIZATION_OUTPUT,
    });
    const usage = extractResponseTokenUsage(response, params.model);
    if (usage) {
      mergeUsageSnapshot(usage);
    }
    finalAnswer = extractStructuredFinalizationOutput(response, params.outputTruncation);
  } catch (error: unknown) {
    if (!controller.signal.aborted) {
      logger.devWarn(
        'Finalization pass failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
    return undefined;
  } finally {
    clearTimeout(timeoutTimer);
    flushUsage();
  }

  return finalAnswer;
}
