// ---------------------------------------------------------------------------
// Kavi — 4-layer Context Budget Allocator
// ---------------------------------------------------------------------------
// Per the single-thread memory redesign, the prompt is a 4-layer stack:
//
//   L1 Tools          15%  (cap 12,000 tok)
//   L2 System         65%  (base + persona + profile blocks + summary +
//                            buffer-tail of older messages)
//   L3 Active focus + retrieved memory    5%  (cap 1,800 tok)
//   L4 Last 1–2 turns + new user message 15%  (cap 8,000 tok)
//   Output reserve    max(4096, maxTokens)
//
// When pressure exceeds budget the cascade is applied in order:
//   (1) drop optional retrieved facts
//   (2) window L2 buffer-tail
//   (3) compress profile/active_focus blocks
//   (4) tier-2 compaction (selective summarization)
//   (5) tier-3 compaction (aggressive summarization)
//
// This module is intentionally **pure** — it computes budgets and recommends
// adjustments. It never mutates the underlying stores or runs the LLM
// compactor. The orchestrator chains the recommendation list into the live
// services (compaction.ts, blocks.ts, etc.).
// ---------------------------------------------------------------------------

import { estimateTokens, getWorkingContextWindow } from './tokenCounter';
import { MIN_OUTPUT_RESERVE } from './budgetManager';
import { resolveModelOutputTokenBudget } from './outputTokenBudget';
import type { MemoryBlock } from '../memory/blocks';
import type { MemoryFact } from '../memory/facts/types';

// ── Layer shares (fractions of the working context window) ───────────────

export const LAYERED_L1_TOOLS_SHARE = 0.15;
export const LAYERED_L2_SYSTEM_SHARE = 0.65;
export const LAYERED_L3_FOCUS_SHARE = 0.05;
export const LAYERED_L4_USER_TURN_SHARE = 0.15;

// ── Hard caps ────────────────────────────────────────────────────────────

export const LAYERED_L1_TOOLS_CAP = 12_000;
export const LAYERED_L3_FOCUS_CAP = 1_800;
export const LAYERED_L4_USER_TURN_CAP = 8_000;

// L2 has no extra cap beyond `model · share` — it is intentionally the largest
// pool because it owns the durable conversation summary and buffer tail.

// ── Types ────────────────────────────────────────────────────────────────

export interface LayeredBudget {
  /** Underlying model context window (working portion). */
  contextWindow: number;
  /** Tokens reserved for completion output. */
  outputReserve: number;
  /** Total tokens left for input across all four layers. */
  totalAvailable: number;
  /** Per-layer caps in tokens. */
  l1Tools: number;
  l2System: number;
  l3Focus: number;
  l4UserTurn: number;
}

export interface LayeredCascadeInput {
  budget: LayeredBudget;
  /** Current measured input token usage by layer. */
  current: {
    l1Tools: number;
    l2System: number;
    l3Focus: number;
    l4UserTurn: number;
  };
  /**
   * Optional candidate retrieved facts available to L3. The cascade may drop
   * trailing facts to fit the L3 cap; pinned facts are never dropped.
   */
  retrievedFacts?: MemoryFact[];
  /**
   * Optional memory blocks contributing to L2. The cascade may flag profile
   * blocks for compression; pinned blocks are flagged last.
   */
  l2Blocks?: MemoryBlock[];
}

export type LayeredCascadeAction =
  | 'drop_retrieved_facts'
  | 'window_buffer_tail'
  | 'compress_l2_blocks'
  | 'tier2_compaction'
  | 'tier3_compaction';

export interface LayeredCascadeRecommendation {
  action: LayeredCascadeAction;
  /** Estimated tokens this action would free, when knowable. */
  estimatedSavingsTokens?: number;
  /** Human-readable reason for telemetry/logging. */
  reason: string;
}

export interface LayeredCascadeResult {
  withinBudget: boolean;
  /** Recommended actions in cascade order. */
  recommendations: LayeredCascadeRecommendation[];
  /**
   * The retrieved-fact subset that fits the L3 cap after step (1). When the
   * cascade did not need to drop facts, this is the original list.
   */
  retainedFacts: MemoryFact[];
  /** Sum of current input tokens across all layers. */
  totalInputTokens: number;
}

// ── Budget computation ───────────────────────────────────────────────────

/**
 * Compute per-layer budgets for the requested model. `maxTokens` is the
 * caller-supplied output budget — it sets the floor of the output reserve.
 */
export function computeLayeredBudget(
  model: string,
  maxTokens: number = resolveModelOutputTokenBudget(model),
): LayeredBudget {
  const contextWindow = getWorkingContextWindow(model);
  const outputReserve = Math.max(MIN_OUTPUT_RESERVE, maxTokens);
  const totalAvailable = Math.max(contextWindow - outputReserve, 0);

  const l1Tools = Math.min(
    Math.floor(totalAvailable * LAYERED_L1_TOOLS_SHARE),
    LAYERED_L1_TOOLS_CAP,
  );
  const l2System = Math.floor(totalAvailable * LAYERED_L2_SYSTEM_SHARE);
  const l3Focus = Math.min(
    Math.floor(totalAvailable * LAYERED_L3_FOCUS_SHARE),
    LAYERED_L3_FOCUS_CAP,
  );
  const l4UserTurn = Math.min(
    Math.floor(totalAvailable * LAYERED_L4_USER_TURN_SHARE),
    LAYERED_L4_USER_TURN_CAP,
  );

  return {
    contextWindow,
    outputReserve,
    totalAvailable,
    l1Tools,
    l2System,
    l3Focus,
    l4UserTurn,
  };
}

// ── Fact selection (cascade step 1) ──────────────────────────────────────

function estimateFactTokens(fact: MemoryFact): number {
  // Mirrors the rendering in promptAssembly.renderFact — short one-liner.
  const conf =
    typeof fact.confidence === 'number' && fact.confidence < 0.6 ? ` (confidence x.xx)` : '';
  return estimateTokens(`- ${fact.subjectId} ${fact.predicate}: ${fact.objectText}${conf}`);
}

/**
 * Select the top-N retrieved facts that fit within `budgetTokens`. Pinned
 * facts always make the cut even when they push the total above the cap —
 * the budget is an aspiration for the optional facts, not a hard wall for
 * the user's own pins. Order is preserved.
 */
export function selectFactsWithinBudget(
  facts: MemoryFact[],
  budgetTokens: number,
): { retained: MemoryFact[]; droppedCount: number; estimatedTokens: number } {
  if (facts.length === 0) {
    return { retained: [], droppedCount: 0, estimatedTokens: 0 };
  }

  let used = 0;
  const retained: MemoryFact[] = [];

  // Pass 1 — pinned facts are mandatory.
  for (const fact of facts) {
    if (!fact.pinned) continue;
    const cost = estimateFactTokens(fact);
    used += cost;
    retained.push(fact);
  }

  const seen = new Set(retained.map((f) => f.id));

  // Pass 2 — fill the remaining cap with non-pinned facts in their original
  // (caller-ranked) order, stopping once the next fact would breach the cap.
  for (const fact of facts) {
    if (seen.has(fact.id)) continue;
    const cost = estimateFactTokens(fact);
    if (used + cost > budgetTokens && retained.length > 0) continue;
    used += cost;
    retained.push(fact);
    seen.add(fact.id);
    if (used >= budgetTokens) break;
  }

  // Re-emit in caller-supplied order so prompt-assembly stays deterministic.
  const orderById = new Map(facts.map((f, idx) => [f.id, idx] as const));
  retained.sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0));

  return {
    retained,
    droppedCount: facts.length - retained.length,
    estimatedTokens: used,
  };
}

// ── Cascade ──────────────────────────────────────────────────────────────

/**
 * Apply the memory budget cascade. The function inspects current per-layer usage and
 * returns a list of recommended actions in the prescribed order. When the
 * caller supplies retrieved facts it also returns the trimmed-to-fit subset
 * (step 1 is the only one we can perform purely; the rest are actions the
 * orchestrator must dispatch to compaction.ts / blocks.ts).
 */
export function applyMemoryCascade(input: LayeredCascadeInput): LayeredCascadeResult {
  const { budget, current } = input;
  const recommendations: LayeredCascadeRecommendation[] = [];

  // Step 1: trim optional retrieved facts to fit L3 cap.
  let retainedFacts: MemoryFact[] = input.retrievedFacts ?? [];
  let l3After = current.l3Focus;
  if (retainedFacts.length > 0 && current.l3Focus > budget.l3Focus) {
    const { retained, droppedCount, estimatedTokens } = selectFactsWithinBudget(
      retainedFacts,
      budget.l3Focus,
    );
    retainedFacts = retained;
    const savings = Math.max(current.l3Focus - estimatedTokens, 0);
    l3After = estimatedTokens;
    if (droppedCount > 0) {
      recommendations.push({
        action: 'drop_retrieved_facts',
        estimatedSavingsTokens: savings,
        reason: `Dropped ${droppedCount} retrieved fact(s) to fit L3 cap (${budget.l3Focus} tok)`,
      });
    }
  }

  // Recompute total after step 1.
  const total = current.l1Tools + current.l2System + l3After + current.l4UserTurn;
  const rawOvershoot = total - budget.totalAvailable;
  const l2Overshoot = Math.max(current.l2System - budget.l2System, 0);

  // Step 2: window L2 buffer-tail (caller-driven).
  if (rawOvershoot > 0 && l2Overshoot > 0) {
    recommendations.push({
      action: 'window_buffer_tail',
      estimatedSavingsTokens: l2Overshoot,
      reason: `L2 over budget by ${l2Overshoot} tok — window the older message buffer`,
    });
  }

  // Step 3: compress L2 profile / active_focus blocks.
  if (rawOvershoot > 0 && (input.l2Blocks?.length ?? 0) > 0) {
    recommendations.push({
      action: 'compress_l2_blocks',
      reason: 'Compress profile/active_focus blocks to recover L2 headroom',
    });
  }

  // Step 4: tier-2 (selective) compaction. Triggered when:
  //  - L2 buffer windowing alone cannot close the gap (overshoot remains
  //    after crediting the easy L2 savings), OR
  //  - the absolute overshoot is non-trivial (>10% of the working budget),
  //    so even with windowing we want a structured summary on disk.
  const remainingOvershoot = Math.max(rawOvershoot - l2Overshoot, 0);
  const tier2Floor = Math.max(1, Math.floor(budget.totalAvailable * 0.1));
  if (remainingOvershoot > 0 || rawOvershoot > tier2Floor) {
    recommendations.push({
      action: 'tier2_compaction',
      reason: 'Run tier-2 selective compaction over older message buffer',
    });
  }

  // Step 5: tier-3 (aggressive) compaction — only when overshoot is large
  // enough that tier-2 alone is unlikely to recover the gap.
  const tier3Floor = Math.max(1, Math.floor(budget.totalAvailable * 0.5));
  if (remainingOvershoot > Math.floor(budget.l2System * 0.25) || rawOvershoot > tier3Floor) {
    recommendations.push({
      action: 'tier3_compaction',
      reason: 'Persistent overshoot — escalate to tier-3 aggressive compaction',
    });
  }

  return {
    withinBudget: rawOvershoot <= 0,
    recommendations,
    retainedFacts,
    totalInputTokens: total,
  };
}
