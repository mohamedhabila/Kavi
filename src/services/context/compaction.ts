// ---------------------------------------------------------------------------
// Kavi — Context Compaction Engine (Tiered)
// ---------------------------------------------------------------------------
// Implements graduated context management based on Anthropic's context
// engineering guidance:
//
//   Tier 1 — Tool result clearing  (60% of working context)
//            "One of the safest lightest touch forms of compaction"
//   Tier 2 — Selective compaction   (75% of working context)
//            Summarize older messages, keep adaptive recent tail
//   Tier 3 — Aggressive compaction  (85% of working context)
//            Full structured summary with minimal recent tail
//
// Summary format follows Anthropic's SDK compaction prompt structure while the
// deterministic fallback avoids language-specific keyword extraction:
//   1. Task Overview     2. Current State     3. Context to Preserve
//   4. Active Focus      5. Open Threads

import type { Message } from '../../types/message';
import type {
  CompactionContext,
  ContextEngine,
  ContextEngineInfo,
  AssembleResult,
  CompactResult,
  CompactionTier,
  ForcedCompactionTier,
  IngestResult,
  BootstrapResult,
} from './types';
import { registerContextEngine } from './registry';
import {
  estimateTokens,
  estimateMessageTokens,
  TOOL_CLEARING_THRESHOLD_SHARE,
  SELECTIVE_COMPACTION_THRESHOLD_SHARE,
  AGGRESSIVE_COMPACTION_THRESHOLD_SHARE,
} from './tokenCounter';
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
 * Idle window required to trigger compaction during a non-forced, non-pressure
 * call. "avoid running compaction mid-burst by gating it on
 * idleSinceLastTurn > 90s unless the budget is genuinely exceeded."
 */
export const COMPACTION_IDLE_GUARD_MS = 45_000;

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

// ── Tier determination ───────────────────────────────────────────────────

/**
 * Determine which compaction tier to apply based on current token usage
 * relative to the working context window budget.
 */
export function determineCompactionTier(tokenCount: number, budget: number): CompactionTier {
  const thresholds = {
    toolClearing: Math.floor(budget * TOOL_CLEARING_THRESHOLD_SHARE),
    selective: Math.floor(budget * SELECTIVE_COMPACTION_THRESHOLD_SHARE),
    aggressive: Math.floor(budget * AGGRESSIVE_COMPACTION_THRESHOLD_SHARE),
  };

  if (tokenCount >= thresholds.aggressive) return 'aggressive';
  if (tokenCount >= thresholds.selective) return 'selective';
  if (tokenCount >= thresholds.toolClearing) return 'tool_clearing';
  return 'none';
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

    const originalTokens = estimateTokens(getMessageContentForContext(msg));
    const toolName = msg.toolCalls?.[0]?.name || msg.toolCallId || 'tool';
    const placeholder = buildToolResultPlaceholder('cleared', toolName, msg.content);
    const newTokens = estimateTokens(placeholder);
    tokensFreed += Math.max(0, originalTokens - newTokens);
    cleared++;

    return { ...msg, content: placeholder };
  });

  return { messages: result, cleared, tokensFreed };
}

// ── Main Engine ──────────────────────────────────────────────────────────

export class DefaultContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: 'default',
    name: 'Default Context Engine',
    version: '2.0.0',
    ownsCompaction: true,
  };

  async bootstrap(): Promise<BootstrapResult> {
    return { bootstrapped: true };
  }

  async ingest(_params: { sessionId: string; message: Message }): Promise<IngestResult> {
    return { ingested: true };
  }

  async assemble(params: {
    sessionId: string;
    messages: Message[];
    tokenBudget?: number;
  }): Promise<AssembleResult> {
    const budget = params.tokenBudget ?? 128000;
    let totalTokens = 0;
    const systemMessages: Message[] = [];
    const keptNonSystem: Message[] = [];

    // Always include system messages
    for (const msg of params.messages) {
      if (msg.role === 'system') {
        const tokens = estimateTokens(msg.content);
        totalTokens += tokens;
        systemMessages.push(msg);
      }
    }

    // Include messages from recent to old until budget exceeded
    const nonSystem = params.messages.filter((m) => m.role !== 'system');
    for (let index = nonSystem.length - 1; index >= 0; index -= 1) {
      const msg = nonSystem[index];
      const tokens = estimateTokens(getMessageContentForContext(msg)) + 4;
      if (totalTokens + tokens > budget) break;
      totalTokens += tokens;
      keptNonSystem.unshift(msg);
    }

    return {
      messages: [...systemMessages, ...keptNonSystem],
      estimatedTokens: totalTokens,
    };
  }

  async compact(params: {
    sessionId: string;
    messages: Message[];
    tokenBudget?: number;
    force?: boolean;
    forceTier?: ForcedCompactionTier;
    currentTokenCount?: number;
    /**
     * Milliseconds since the last user turn ended. When the call is not
     * forced and the conversation is still actively bursting (idle below
     * `COMPACTION_IDLE_GUARD_MS`), tier-2/tier-3 compaction is skipped
     * unless the budget is genuinely exceeded.
     */
    idleSinceLastTurnMs?: number;
    focusBlock?: string;
    openThreads?: string[];
    compactionContext?: CompactionContext;
  }): Promise<CompactResult> {
    const tokenCount =
      params.currentTokenCount ??
      estimateMessageTokens(
        params.messages.map((m) => ({ role: m.role, content: getMessageContentForContext(m) })),
      );
    const budget = params.tokenBudget ?? 128000;

    // Determine compaction tier
    const tier: CompactionTier =
      params.forceTier ??
      (params.force ? 'selective' : determineCompactionTier(tokenCount, budget));

    if (tier === 'none') {
      return { ok: true, compacted: false, tier: 'none', reason: 'Below all thresholds' };
    }

    // ── Tier 1: Tool Result Clearing ─────────────────────────────────
    if (tier === 'tool_clearing') {
      return this.applyToolClearing(params, tokenCount);
    }

    // ── Tier 2 & 3: Summarization ────────────────────────────────────
    // An explicit compactionContext wins over the legacy top-level fields so a
    // caller only has to supply pending-work state in one place.
    return this.applySummarizationCompaction(
      {
        ...params,
        focusBlock: params.compactionContext?.focusBlock ?? params.focusBlock,
        openThreads: params.compactionContext?.openThreads ?? params.openThreads,
        idleSinceLastTurnMs:
          params.compactionContext?.idleSinceLastTurnMs ?? params.idleSinceLastTurnMs,
      },
      tokenCount,
      tier,
    );
  }

  private async applyToolClearing(
    params: { sessionId: string; messages: Message[]; tokenBudget?: number },
    tokenCount: number,
  ): Promise<CompactResult> {
    const { messages: cleared, cleared: count, tokensFreed } = clearOldToolResults(params.messages);

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
      tokenBudget?: number;
      currentTokenCount?: number;
      force?: boolean;
      forceTier?: ForcedCompactionTier;
      idleSinceLastTurnMs?: number;
      focusBlock?: string;
      openThreads?: string[];
      compactionContext?: CompactionContext;
    },
    tokenCount: number,
    tier: 'selective' | 'aggressive',
  ): Promise<CompactResult> {
    // Idle gate: skip mid-burst compaction unless explicitly
    // forced or the budget is genuinely exceeded.
    const budget = params.tokenBudget ?? 128000;
    const overBudget = tokenCount > budget;
    const explicitlyForced = params.force === true || params.forceTier !== undefined;
    const idleMs = params.idleSinceLastTurnMs;
    if (
      !explicitlyForced &&
      !overBudget &&
      typeof idleMs === 'number' &&
      idleMs < COMPACTION_IDLE_GUARD_MS
    ) {
      return {
        ok: true,
        compacted: false,
        tier,
        reason: `Skipped: mid-burst (idle ${idleMs}ms < ${COMPACTION_IDLE_GUARD_MS}ms guard)`,
      };
    }

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
      hints: {
        focusBlock: params.focusBlock,
        openThreads: params.openThreads,
      },
      summarizer,
    });
    const tokensAfter =
      estimateTokens(summary) +
      estimateMessageTokens(
        toKeep.map((m) => ({ role: m.role, content: getMessageContentForContext(m) })),
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

// Register the default engine
registerContextEngine('default', () => new DefaultContextEngine());
