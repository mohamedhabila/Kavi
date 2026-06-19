// ---------------------------------------------------------------------------
// Kavi — E2E benchmark prompt-cache scenarios
// ---------------------------------------------------------------------------
import { E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS, E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2EScenario } from './types';

const PROMPT_CACHE_STABLE_CONTEXT = Array.from({ length: 96 }, (_, index) => {
  const section = index + 1;
  return [
    `Stable mobile assistant context section ${section}.`,
    'The user is planning recurring personal routines across travel, errands, family coordination, and device reminders.',
    'The assistant should preserve prior conversation facts, answer from visible context when it is sufficient, and keep replies concise on mobile.',
    `Stable reference token CACHE-CONTEXT-${section.toString().padStart(2, '0')} belongs to this durable baseline.`,
  ].join(' ');
}).join('\n');

/** Provider-cache direct: stable long conversation prefix with volatile current-turn context at the tail. */
export const BENCH_PROMPT_CACHE_LONG_HORIZON: E2EScenario = {
  id: 'bench-prompt-cache-long-horizon',
  conversationId: 'e2e-bench-prompt-cache-long-horizon',
  prompt: 'Verify provider prompt-cache reuse across a long single conversation.',
  userTurns: [
    {
      content:
        'Here is durable background for our ongoing mobile assistant thread. Keep it available for future turns and acknowledge it briefly.\n\n' +
        PROMPT_CACHE_STABLE_CONTEXT,
    },
    {
      content:
        'From the stable background, acknowledge the durable routine context and mention CACHE-CONTEXT-04.',
    },
    {
      content:
        'Continue from the same durable background. Mention CACHE-CONTEXT-18 and keep the reply brief.',
    },
    {
      content:
        'One more continuity check from the same background: mention CACHE-CONTEXT-31 and keep the reply brief.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 4 },
    {
      kind: 'cache_prefix_readiness',
      minEligibleInputTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
      minEligibleTurns: 2,
      afterWarmupTurns: 1,
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-prompt-cache-long-horizon'],
    },
  ],
};

/** Provider-cache convergence: sustained single-conversation reuse with volatile turn context at the tail. */
export const BENCH_PROMPT_CACHE_CONVERGENCE_LONG_RUN: E2EScenario = {
  id: 'bench-prompt-cache-convergence-long-run',
  conversationId: 'e2e-bench-prompt-cache-convergence-long-run',
  prompt: 'Verify provider prompt-cache convergence across a sustained mobile assistant thread.',
  userTurns: [
    {
      content:
        'Here is durable background for our ongoing mobile assistant thread. Keep it available for future turns. Use only the visible conversation context for this cache probe and keep replies concise.\n\n' +
        PROMPT_CACHE_STABLE_CONTEXT,
    },
    {
      content:
        'From the durable background only, mention CACHE-CONTEXT-04. Keep the reply brief.',
    },
    {
      content:
        'Continue from the same durable background only. Mention CACHE-CONTEXT-18. Keep the reply brief.',
    },
    {
      content:
        'Continue from the same durable background only. Mention CACHE-CONTEXT-31. Keep the reply brief.',
    },
    {
      content:
        'Continue from the same durable background only. Mention CACHE-CONTEXT-44. Keep the reply brief.',
    },
    {
      content:
        'Continue from the same durable background only. Mention CACHE-CONTEXT-57. Keep the reply brief.',
    },
    {
      content:
        'Continue from the same durable background only. Mention CACHE-CONTEXT-70. Keep the reply brief.',
    },
    {
      content:
        'Continue from the same durable background only. Mention CACHE-CONTEXT-83. Keep the reply brief.',
    },
    {
      content:
        'Continue from the same durable background only. Mention CACHE-CONTEXT-08. Keep the reply brief.',
    },
    {
      content:
        'Continue from the same durable background only. Mention CACHE-CONTEXT-22. Keep the reply brief.',
    },
    {
      content:
        'Continue from the same durable background only. Mention CACHE-CONTEXT-35. Keep the reply brief.',
    },
    {
      content:
        'Continue from the same durable background only. Mention CACHE-CONTEXT-48. Keep the reply brief.',
    },
    {
      content:
        'Continue from the same durable background only. Mention CACHE-CONTEXT-61. Keep the reply brief.',
    },
    {
      content:
        'Continue from the same durable background only. Mention CACHE-CONTEXT-74. Keep the reply brief.',
    },
    {
      content:
        'Continue from the same durable background only. Mention CACHE-CONTEXT-87. Keep the reply brief.',
    },
    {
      content:
        'Final cache convergence check from the durable background only: mention CACHE-CONTEXT-96. Keep the reply brief.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 16 },
    {
      kind: 'cache_prefix_readiness',
      minEligibleInputTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS * 4,
      minEligibleTurns: 8,
      afterWarmupTurns: 6,
    },
    {
      kind: 'cache_eligible_read_rate',
      minRate: 0.85,
      minEligibleInputTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS * 4,
      minEligibleTurns: 8,
      afterWarmupTurns: 6,
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-prompt-cache-convergence-long-run'],
    },
  ],
};
