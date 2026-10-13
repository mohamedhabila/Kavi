// ---------------------------------------------------------------------------
// Kavi — Compaction Types
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';

// ── Compaction tiers (Anthropic-style graduated context management) ───────

/**
 * Graduated compaction tiers — from lightest-touch to most aggressive. A request over its
 * working window tries them in this order until it fits.
 * Based on Anthropic's context engineering guidance:
 * "One of the safest lightest touch forms of compaction is tool result clearing"
 */
export type CompactionTier = 'tool_clearing' | 'selective' | 'aggressive';

export type CompactResult = {
  ok: boolean;
  compacted: boolean;
  reason?: string;
  /** Which tier was applied */
  tier?: CompactionTier;
  result?: {
    summary?: string;
    firstKeptEntryId?: string;
    tokensBefore: number;
    tokensAfter?: number;
    /** Number of tool results cleared (Tier 1) */
    clearedToolResults?: number;
    details?: unknown;
  };
};

/** Code-owned inputs that let a compaction summary preserve unfinished work. */
export type CompactionContext = {
  /** The run's plan steps and in-flight external operations, bounded by the caller. */
  openThreads?: string[];
  /** Active request model, used to route model-backed summarization. */
  requestModel?: string;
  /** True when the active provider runs on-device and must not summarize. */
  onDeviceProvider?: boolean;
  /** Provider family for the online token-calibration EMA (see `tokenCounter.ts`). */
  requestFamily?: string;
};

export type CompactParams = {
  sessionId: string;
  messages: Message[];
  tier: CompactionTier;
  currentTokenCount?: number;
  /**
   * Code-owned pending-work state and summarizer routing for this compaction.
   * Supplying it lets the summary carry the task forward; omitting it falls back
   * to a transcript-only summary.
   */
  compactionContext?: CompactionContext;
};

/** Compacts a run's working messages at one tier. */
export interface CompactionEngine {
  compact(params: CompactParams): Promise<CompactResult>;
}
