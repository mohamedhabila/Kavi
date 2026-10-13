// ---------------------------------------------------------------------------
// Kavi — Context Compaction Engine (Tiered)
// ---------------------------------------------------------------------------
// Implements graduated context management based on Anthropic's context
// engineering guidance. A request over its working window tries the tiers in
// order until it fits (agentTurnRequestBudget):
//
//   Tier 1 — Tool result clearing
//            "One of the safest lightest touch forms of compaction"
//   Tier 2 — Selective compaction
//            Summarize older messages, keep adaptive recent tail
//   Tier 3 — Aggressive compaction
//            Full structured summary with minimal recent tail
//
// Summary format follows Anthropic's SDK compaction prompt structure while the
// deterministic fallback avoids language-specific keyword extraction:
//   1. Task Overview     2. Current State     3. Context to Preserve
//   4. Active Focus      5. Open Threads

import type { Message } from '../../types/message';
import type {
  CompactParams,
  CompactResult,
  CompactionContext,
  CompactionEngine,
  CompactionTier,
} from './types';
import { estimateTokens, estimateMessageTokens } from './tokenCounter';
import { emitSessionEvent } from '../events/bus';
import { buildCompactionSummary } from './compactionSummarizer';
import { resolveCompactionSummarizerConfig } from './compactionModelResolver';
import { COMPACTION_SUMMARY_MARKER, getMessageContentForContext } from './compactionSummary';
import { buildToolResultPlaceholder, isToolResultPlaceholder } from '../../utils/toolResultSummary';

// ── Constants ────────────────────────────────────────────────────────────

/** Tool results older than this many messages from the tail are clearing candidates */
const TOOL_CLEARING_KEEP_RECENT = 6;

/** Minimum tool results to keep during Tier 1 clearing */
const TOOL_CLEARING_MIN_KEEP = 3;

/** Share of non-system messages to keep as verbatim tail during Tier 2 */
const SELECTIVE_RECENT_SHARE = 0.2;
const SELECTIVE_MIN_RECENT = 8;
const SELECTIVE_MAX_RECENT = 16;

/** Share of non-system messages to keep as verbatim tail during Tier 3 */
const AGGRESSIVE_RECENT_SHARE = 0.1;
const AGGRESSIVE_MIN_RECENT = 4;
const AGGRESSIVE_MAX_RECENT = 8;

/** Prefix used to identify cleared tool results (Tier 1). */
export const TOOL_CLEARED_PLACEHOLDER = '[cleared:';

/**
 * Ensures the compaction tail boundary doesn't split an atomic tool-call group.
 * If the boundary lands on a tool-result message, walk back to include the
 * preceding assistant tool_call message that initiated the group.
 */
export function alignCompactionTailStart(messages: Message[], startIndex: number): number {
  if (messages.length === 0) return 0;

  let alignedIndex = Math.max(0, Math.min(startIndex, messages.length - 1));
  if (messages[alignedIndex]?.role !== 'tool') return alignedIndex;

  // Walk past consecutive tool results
  while (alignedIndex > 0 && messages[alignedIndex - 1]?.role === 'tool') {
    alignedIndex -= 1;
  }

  // Include the assistant message that initiated the tool call group
  const precedingMessage = alignedIndex > 0 ? messages[alignedIndex - 1] : undefined;
  if (precedingMessage?.role === 'assistant' && precedingMessage.toolCalls?.length) {
    return alignedIndex - 1;
  }

  return alignedIndex;
}

// ── Tier 1: Tool Result Clearing ─────────────────────────────────────────

/**
 * Clear old tool results to free context — Anthropic's "safest lightest-touch"
 * form of compaction.  Replaces tool result content with a compact placeholder
 * while preserving the tool call metadata (name, key params).  Keeps the most
 * recent tool results intact for reasoning continuity.
 *
 * Returns the modified messages array and how many tokens were freed.
 */
export function clearOldToolResults(
  messages: Message[],
  keepRecent: number = TOOL_CLEARING_KEEP_RECENT,
  family?: string,
): { messages: Message[]; cleared: number; tokensFreed: number } {
  const effectiveKeepRecent = Math.max(TOOL_CLEARING_MIN_KEEP, keepRecent);

  // Find tool-result messages (non-system, role === 'tool')
  const toolIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool' && !isToolResultPlaceholder(messages[i].content, 'cleared')) {
      toolIndices.push(i);
    }
  }

  if (toolIndices.length <= effectiveKeepRecent) {
    return { messages, cleared: 0, tokensFreed: 0 };
  }

  // Determine which tool results to clear (keep the most recent N)
  const toClearIndices = new Set(toolIndices.slice(0, toolIndices.length - effectiveKeepRecent));

  let tokensFreed = 0;
  let cleared = 0;

  const result = messages.map((msg, idx) => {
    if (!toClearIndices.has(idx)) return msg;

    const originalTokens = estimateTokens(getMessageContentForContext(msg), family);
    const toolName = msg.toolCalls?.[0]?.name || msg.toolCallId || 'tool';
    const placeholder = buildToolResultPlaceholder('cleared', toolName, msg.content);
    const newTokens = estimateTokens(placeholder, family);
    tokensFreed += Math.max(0, originalTokens - newTokens);
    cleared++;

    return { ...msg, content: placeholder };
  });

  return { messages: result, cleared, tokensFreed };
}

// ── Main Engine ──────────────────────────────────────────────────────────

export class DefaultCompactionEngine implements CompactionEngine {
  async compact(params: CompactParams): Promise<CompactResult> {
    const tokenCount =
      params.currentTokenCount ??
      estimateMessageTokens(
        params.messages.map((m) => ({ role: m.role, content: getMessageContentForContext(m) })),
        params.compactionContext?.requestFamily,
      );

    // ── Tier 1: Tool Result Clearing ─────────────────────────────────
    if (params.tier === 'tool_clearing') {
      return this.applyToolClearing(params, tokenCount);
    }

    // ── Tier 2 & 3: Summarization ────────────────────────────────────
    return this.applySummarizationCompaction(params, tokenCount, params.tier);
  }

  private async applyToolClearing(
    params: {
      sessionId: string;
      messages: Message[];
      compactionContext?: CompactionContext;
    },
    tokenCount: number,
  ): Promise<CompactResult> {
    const { messages: cleared, cleared: count, tokensFreed } = clearOldToolResults(
      params.messages,
      undefined,
      params.compactionContext?.requestFamily,
    );

    if (count === 0) {
      return {
        ok: true,
        compacted: false,
        tier: 'tool_clearing',
        reason: 'No tool results to clear',
      };
    }

    const tokensAfter = tokenCount - tokensFreed;

    await emitSessionEvent('compacted', {
      conversationId: params.sessionId,
      reason: `Tier 1: cleared ${count} old tool results, freed ~${tokensFreed} tokens`,
    });

    return {
      ok: true,
      compacted: true,
      tier: 'tool_clearing',
      result: {
        summary: undefined, // No summary for tool clearing
        firstKeptEntryId: cleared[0]?.id,
        tokensBefore: tokenCount,
        tokensAfter,
        clearedToolResults: count,
      },
    };
  }

  private async applySummarizationCompaction(
    params: {
      sessionId: string;
      messages: Message[];
      compactionContext?: CompactionContext;
    },
    tokenCount: number,
    tier: Exclude<CompactionTier, 'tool_clearing'>,
  ): Promise<CompactResult> {
    // Extract prior compaction summaries from system messages before filtering.
    // These would otherwise be silently dropped because buildStructuredSummary
    // only processes non-system messages.  Feeding them as priorContext ensures
    // multi-round compaction preserves earlier context.
    const priorSummaryContent = params.messages
      .filter((m) => m.role === 'system' && m.content?.includes(COMPACTION_SUMMARY_MARKER))
      .map((m) => m.content)
      .join('\n---\n');

    const nonSystem = params.messages.filter((m) => m.role !== 'system');

    // Adaptive recent message window based on tier
    const share = tier === 'aggressive' ? AGGRESSIVE_RECENT_SHARE : SELECTIVE_RECENT_SHARE;
    const minKeep = tier === 'aggressive' ? AGGRESSIVE_MIN_RECENT : SELECTIVE_MIN_RECENT;
    const maxKeep = tier === 'aggressive' ? AGGRESSIVE_MAX_RECENT : SELECTIVE_MAX_RECENT;

    const keepCount = Math.min(maxKeep, Math.max(minKeep, Math.floor(nonSystem.length * share)));
    const rawKeepStart = Math.max(0, nonSystem.length - keepCount);
    const keepStart = alignCompactionTailStart(nonSystem, rawKeepStart);
    const toSummarize = nonSystem.slice(0, keepStart);
    const toKeep = nonSystem.slice(keepStart);

    if (toSummarize.length === 0) {
      return { ok: true, compacted: false, tier, reason: 'Nothing to compact' };
    }

    const summarizer = await resolveCompactionSummarizerConfig({
      requestModel: params.compactionContext?.requestModel,
      onDeviceProvider: params.compactionContext?.onDeviceProvider === true,
    });
    const summary = await buildCompactionSummary({
      messages: toSummarize,
      tier,
      priorContext: priorSummaryContent || undefined,
      hints: { openThreads: params.compactionContext?.openThreads },
      summarizer,
    });
    const tokensAfter =
      estimateTokens(summary, params.compactionContext?.requestFamily) +
      estimateMessageTokens(
        toKeep.map((m) => ({ role: m.role, content: getMessageContentForContext(m) })),
        params.compactionContext?.requestFamily,
      );

    await emitSessionEvent('compacted', {
      conversationId: params.sessionId,
      reason: `Tier ${tier === 'aggressive' ? 3 : 2} (${tier}): compacted ${toSummarize.length} messages, kept ${toKeep.length}`,
    });

    return {
      ok: true,
      compacted: true,
      tier,
      result: {
        summary,
        firstKeptEntryId: toKeep[0]?.id,
        tokensBefore: tokenCount,
        tokensAfter,
      },
    };
  }
}
