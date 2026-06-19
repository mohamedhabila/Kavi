import { estimateAllToolTokens } from '../tools/toolManagerTokenBudget';
import { estimateMessageTokens, estimateTokens } from '../../services/context/tokenCounter';
import type { TokenUsage, UsagePromptCacheTelemetry, UsageTokenBuckets } from '../../types/usage';
import type { ToolDefinition } from '../../types/tool';

export function createModelTurnUsageTracker(params: {
  getContentSnapshot: () => { fullContent: string; reasoning: string };
  reportUsage: (usage: TokenUsage) => void;
  requestModel: string;
  usageTelemetry?: {
    tokenBuckets?: UsageTokenBuckets;
    promptCache?: UsagePromptCacheTelemetry;
  };
}) {
  let latestUsage: TokenUsage | null = null;
  let usageReported = false;

  return {
    reset() {
      latestUsage = null;
      usageReported = false;
    },
    mergeSnapshot(usage: Partial<TokenUsage>) {
      const inputTokens = Math.max(latestUsage?.inputTokens ?? 0, usage.inputTokens ?? 0);
      const outputTokens = Math.max(latestUsage?.outputTokens ?? 0, usage.outputTokens ?? 0);
      const cacheReadTokens = Math.max(
        latestUsage?.cacheReadTokens ?? 0,
        usage.cacheReadTokens ?? 0,
      );
      const cacheWriteTokens = Math.max(
        latestUsage?.cacheWriteTokens ?? 0,
        usage.cacheWriteTokens ?? 0,
      );
      const totalTokens = Math.max(
        latestUsage?.totalTokens ?? 0,
        usage.totalTokens ?? 0,
        inputTokens + outputTokens,
      );

      latestUsage = {
        model: usage.model || latestUsage?.model || params.requestModel,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
        ...((usage.tokenDetails ?? latestUsage?.tokenDetails)
          ? { tokenDetails: usage.tokenDetails ?? latestUsage?.tokenDetails }
          : {}),
      };
    },
    flush(options: {
      allowFallback: boolean;
      budgetTools: ReadonlyArray<ToolDefinition>;
      requestMessages: Array<{ role: string; content: any }>;
    }) {
      if (usageReported) {
        return;
      }

      if (!latestUsage && options.allowFallback) {
        const snapshot = params.getContentSnapshot();
        latestUsage = {
          model: params.requestModel,
          inputTokens:
            estimateMessageTokens(
              options.requestMessages.map((message) => ({
                role: message.role,
                content:
                  typeof message.content === 'string'
                    ? message.content
                    : JSON.stringify(message.content),
              })),
            ) + estimateAllToolTokens([...options.budgetTools]),
          outputTokens: estimateTokens(snapshot.fullContent) + estimateTokens(snapshot.reasoning),
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
        };
        latestUsage.totalTokens = latestUsage.inputTokens + latestUsage.outputTokens;
      }

      if (!latestUsage) {
        return;
      }

      usageReported = true;
      params.reportUsage({
        ...latestUsage,
        ...(params.usageTelemetry?.tokenBuckets
          ? { tokenBuckets: params.usageTelemetry.tokenBuckets }
          : {}),
        ...(params.usageTelemetry?.promptCache
          ? { promptCache: params.usageTelemetry.promptCache }
          : {}),
      });
    },
  };
}
