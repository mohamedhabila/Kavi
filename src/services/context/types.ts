// ---------------------------------------------------------------------------
// Kavi — Context Engine Types
// ---------------------------------------------------------------------------

import type { Message } from '../../types';

// ── Compaction tiers (Anthropic-style graduated context management) ───────

/**
 * Graduated compaction tiers — from lightest-touch to most aggressive.
 * Based on Anthropic's context engineering guidance:
 * "One of the safest lightest touch forms of compaction is tool result clearing"
 */
export type CompactionTier = 'none' | 'tool_clearing' | 'selective' | 'aggressive';

export type ForcedCompactionTier = 'tool_clearing' | 'selective' | 'aggressive';

export type AssembleResult = {
  messages: Message[];
  estimatedTokens: number;
  systemPromptAddition?: string;
};

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

export type IngestResult = {
  ingested: boolean;
};

export type BootstrapResult = {
  bootstrapped: boolean;
  importedMessages?: number;
  reason?: string;
};

export type ContextEngineInfo = {
  id: string;
  name: string;
  version?: string;
  ownsCompaction?: boolean;
};

/**
 * ContextEngine defines the pluggable contract for context management.
 */
export interface ContextEngine {
  readonly info: ContextEngineInfo;

  bootstrap?(params: { sessionId: string }): Promise<BootstrapResult>;

  ingest(params: { sessionId: string; message: Message }): Promise<IngestResult>;

  assemble(params: {
    sessionId: string;
    messages: Message[];
    tokenBudget?: number;
  }): Promise<AssembleResult>;

  compact(params: {
    sessionId: string;
    messages: Message[];
    tokenBudget?: number;
    force?: boolean;
    forceTier?: ForcedCompactionTier;
    currentTokenCount?: number;
  }): Promise<CompactResult>;

  dispose?(): Promise<void>;
}
