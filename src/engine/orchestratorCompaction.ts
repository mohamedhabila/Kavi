import type { Message } from '../types/message';
import { clearOldToolResults } from '../services/context/compaction';
import type { CompactResult, CompactionTier } from '../services/context/types';
import { estimateMessageTokens } from '../services/context/tokenCounter';
import { repairReadFileContinuationSummary } from '../services/context/compactionSummary';

export interface OrchestratorCompactionEvent {
  notice: string;
  messages: Message[];
  tier: Exclude<CompactionTier, 'none'>;
  tokensBefore?: number;
  tokensAfter?: number;
  /** The compaction summary text, if any. */
  summary?: string;
}

export function estimateWorkingMessageTokens(messages: Message[]): number {
  return estimateMessageTokens(
    messages.map((message) => ({
      role: message.role,
      content: serializeWorkingMessageContent(message),
    })),
  );
}

function serializeWorkingMessageContent(message: Message): string {
  const content =
    message.role === 'user' ? message.enrichedContent || message.content : message.content;
  if (!message.toolCalls?.length) {
    return content;
  }

  const canonicalToolCalls = message.toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    arguments: toolCall.arguments,
  }));
  return `${content}\n${JSON.stringify(canonicalToolCalls)}`;
}

export function applyCompactionResultToWorkingMessages(
  messages: Message[],
  compactResult: CompactResult,
): OrchestratorCompactionEvent {
  if (!compactResult.compacted || !compactResult.result) {
    return {
      notice: '',
      messages,
      tier: 'tool_clearing',
    };
  }

  const tier: Exclude<CompactionTier, 'none'> =
    compactResult.tier === 'tool_clearing' || compactResult.tier === 'aggressive'
      ? compactResult.tier
      : 'selective';
  if (tier === 'tool_clearing') {
    const { messages: cleared } = clearOldToolResults(messages);
    return {
      notice: `Cleared ${compactResult.result.clearedToolResults ?? 0} old tool results`,
      messages: cleared,
      tier,
      tokensBefore: compactResult.result.tokensBefore,
      tokensAfter: compactResult.result.tokensAfter,
      summary: '',
    };
  }

  const summary = compactResult.result.summary || '';
  const firstKeptId = compactResult.result.firstKeptEntryId;
  const keptIdx = firstKeptId ? messages.findIndex((message) => message.id === firstKeptId) : -1;
  const kept = keptIdx >= 0 ? messages.slice(keptIdx) : messages.slice(-4);
  const systemContent = repairReadFileContinuationSummary(summary, messages);

  return {
    notice:
      systemContent ||
      (tier === 'aggressive' ? 'Context compacted aggressively' : 'Context compacted'),
    messages: [
      {
        id: `compact_${Date.now()}`,
        role: 'system' as const,
        content: systemContent,
        timestamp: Date.now(),
        compactionProvenance: {
          version: 1 as const,
          dependency: 'transcript_only' as const,
        },
      },
      ...kept,
    ],
    tier,
    tokensBefore: compactResult.result.tokensBefore,
    tokensAfter: compactResult.result.tokensAfter,
    summary: systemContent,
  };
}
