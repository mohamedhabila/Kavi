import type { Message } from '../types/message';
import { clearOldToolResults } from '../services/context/compaction';
import { buildPostCompactionSystemContent } from '../services/context/postCompactionReinject';
import type { CompactResult, CompactionTier } from '../services/context/types';
import { estimateMessageTokens } from '../services/context/tokenCounter';

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
      content:
        message.role === 'user' ? message.enrichedContent || message.content : message.content,
    })),
  );
}

export function applyCompactionResultToWorkingMessages(
  messages: Message[],
  compactResult: CompactResult,
  reinject?: {
    goalsPromptSection?: string | null;
    profileSections?: ReadonlyArray<string>;
  },
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
  const systemContent = buildPostCompactionSystemContent({
    summary,
    goalsPromptSection: reinject?.goalsPromptSection,
    profileSections: reinject?.profileSections,
  });

  return {
    notice:
      summary || (tier === 'aggressive' ? 'Context compacted aggressively' : 'Context compacted'),
    messages: [
      {
        id: `compact_${Date.now()}`,
        role: 'system' as const,
        content: systemContent,
        timestamp: Date.now(),
      },
      ...kept,
    ],
    tier,
    tokensBefore: compactResult.result.tokensBefore,
    tokensAfter: compactResult.result.tokensAfter,
    summary,
  };
}
