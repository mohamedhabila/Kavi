// ---------------------------------------------------------------------------
// Kavi — Token Counter (approximate)
// ---------------------------------------------------------------------------
// Fast heuristic token counting using character/word ratios.
// ~4 characters per token for English text (GPT models).

// Kavi uses chars/4 with a 1.2× safety margin for estimateTokens inaccuracy.
export const CHARS_PER_TOKEN = 4;
export const SAFETY_MARGIN = 1.2;
export const LARGE_MODEL_WORKING_CONTEXT_SHARE = 0.25;
export const MIN_LARGE_MODEL_WORKING_CONTEXT = 48_000;
export const MAX_LARGE_MODEL_WORKING_CONTEXT = 200_000;
export const LARGE_MODEL_WORKING_CONTEXT_THRESHOLD = 64_000;
export const MAX_ROUTINE_COMPACTION_WORKING_CONTEXT = 96_000;

// ── Tiered compaction thresholds ─────────────────────────────────────────
// Based on Anthropic's context engineering guidance: graduated response is
// far more effective than a single cliff-edge compaction.
//
// Tier 1 (TOOL_CLEARING):   Clear old tool results — "safest lightest-touch"
// Tier 2 (SELECTIVE):       Summarize older messages, keep recent context
// Tier 3 (AGGRESSIVE):      Full summarization with minimal recent tail

/** Tier 1: clear old tool results when context exceeds this share */
export const TOOL_CLEARING_THRESHOLD_SHARE = 0.6;

/** Tier 2: selective compaction — summarize old, keep recent messages */
export const SELECTIVE_COMPACTION_THRESHOLD_SHARE = 0.75;

/** Tier 3: aggressive compaction — full summary, minimal recent tail */
export const AGGRESSIVE_COMPACTION_THRESHOLD_SHARE = 0.85;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil((text.length / CHARS_PER_TOKEN) * SAFETY_MARGIN);
}

export function estimateMessageTokens(messages: Array<{ role: string; content: string }>): number {
  let total = 0;
  for (const msg of messages) {
    total += 4; // message framing overhead
    total += estimateTokens(msg.role);
    total += estimateTokens(msg.content);
  }
  total += 2; // conversation priming
  return total;
}

// Model context window sizes (in tokens)
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-5.5': 1000000,
  'gpt-5.4': 1000000,
  'gpt-5.4-mini': 400000,
  'gpt-5-mini': 400000,
  'o3': 200000,
  'o4-mini': 200000,
  'claude-opus-4-7': 1000000,
  'claude-sonnet-4-6': 1000000,
  'claude-haiku-4-5': 200000,
  'gemini-3.5-flash': 1000000,
  'gemini-3.1-pro-preview': 1000000,
  'gemini-3.1-flash-lite': 1000000,
  'gemini-3-flash-preview': 1000000,
  'gemini-2.5-pro': 1000000,
  'gemini-2.5-flash': 1000000,
  'gemini-2.5-flash-lite': 1000000,
  'llama4': 256000,
  'qwen3': 128000,
  'mistral-large-3': 128000,
  'gemma3': 128000,
  'phi4': 16384,
};

export function getContextWindow(model: string): number {
  // Check exact match
  if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model];

  // Check prefix match
  const lower = model.toLowerCase();
  for (const [key, window] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (lower.includes(key.toLowerCase())) return window;
  }

  // Family-level fallback so newer minor revisions inherit safe defaults.
  if (lower.includes('gpt-5')) {
    return lower.includes('mini') ? 400000 : 1000000;
  }

  if (lower === 'o3' || lower.startsWith('o3-') || lower.includes('o4')) {
    return 200000;
  }

  if (lower.includes('claude-opus-4') || lower.includes('claude-sonnet-4')) {
    return 1000000;
  }

  if (lower.includes('claude-haiku-4')) {
    return 200000;
  }

  if (lower.includes('gemini') && (lower.includes('pro') || lower.includes('flash') || lower.includes('lite'))) {
    return 1000000;
  }

  // Default
  return 128000;
}

export function getWorkingContextWindow(model: string): number {
  const hardWindow = getContextWindow(model);

  // Avoid routinely filling very large context windows with low-value history.
  // Long-context research consistently shows weaker utilization in the middle
  // of oversized prompts, so we keep a smaller working target and rely on
  // compaction/pruning to preserve the high-salience parts.
  if (hardWindow <= LARGE_MODEL_WORKING_CONTEXT_THRESHOLD) {
    return hardWindow;
  }

  return Math.min(
    hardWindow,
    MAX_LARGE_MODEL_WORKING_CONTEXT,
    Math.max(
      MIN_LARGE_MODEL_WORKING_CONTEXT,
      Math.floor(hardWindow * LARGE_MODEL_WORKING_CONTEXT_SHARE),
    ),
  );
}

export function getCompactionWorkingContextWindow(model: string): number {
  return Math.min(getWorkingContextWindow(model), MAX_ROUTINE_COMPACTION_WORKING_CONTEXT);
}

export function getCompactionThreshold(model: string): number {
  return Math.floor(
    getCompactionWorkingContextWindow(model) * SELECTIVE_COMPACTION_THRESHOLD_SHARE,
  );
}

/**
 * Returns tiered compaction thresholds (in tokens) for graduated context management.
 * Based on Anthropic's context engineering guidance.
 */
export function getCompactionThresholds(model: string): {
  toolClearing: number;
  selective: number;
  aggressive: number;
} {
  const working = getCompactionWorkingContextWindow(model);
  return {
    toolClearing: Math.floor(working * TOOL_CLEARING_THRESHOLD_SHARE),
    selective: Math.floor(working * SELECTIVE_COMPACTION_THRESHOLD_SHARE),
    aggressive: Math.floor(working * AGGRESSIVE_COMPACTION_THRESHOLD_SHARE),
  };
}
