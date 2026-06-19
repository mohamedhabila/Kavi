// ---------------------------------------------------------------------------
// Kavi — E2E benchmark-adapted scenarios (structural rubrics)
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
/** GAIA-adapted: read seed → derive → verify hash. */
export const BENCH_GAIA_FILE_HOP_CHAIN: E2EScenario = {
  id: 'bench-gaia-file-hop-chain',
  conversationId: 'e2e-bench-gaia-hop',
  prompt:
    'Write `artifacts/seed.txt` with exact content `SEED-E2E-7`. ' +
    'Read `artifacts/seed.txt`, then write `artifacts/derived.txt` with exact content `DERIVED-SEED-E2E-7`.',
  rubrics: [
    { kind: 'workspace_file', path: 'artifacts/seed.txt', contains: 'SEED-E2E-7' },
    { kind: 'workspace_file', path: 'artifacts/derived.txt', contains: 'DERIVED-SEED-E2E-7' },
    {
      kind: 'file_hash',
      path: 'artifacts/derived.txt',
      expectedHash: '676927c882823d8a00c72876be7e60a0fe0b2709c208d840b08a3c28c4f17f7f',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-gaia-file-hop-chain'],
    },
  ],
};
/** Capability discovery: store and verify a memory token across turns. */
export const BENCH_SESSION_TOOL_CACHE: E2EScenario = {
  id: 'bench-session-tool-cache',
  conversationId: 'e2e-bench-session-cache',
  prompt: 'Store and verify a memory token across two turns.',
  userTurns: [
    {
      content: 'Find the right way to store and retrieve durable memory for this conversation.',
    },
    {
      content:
        'Remember that subject `e2e-cache-1` has cache_token `CACHE-E2E-42`, then verify that the value is retrievable.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 2 },
    { kind: 'memory_fact', predicate: 'cache_token', value: 'CACHE-E2E-42' },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-session-tool-cache'],
    },
  ],
};
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
/** Tool-discovery: describe before use. */
export const BENCH_TOOL_DESCRIBE_THEN_USE: E2EScenario = {
  id: 'bench-tool-describe-then-use',
  conversationId: 'e2e-bench-describe-use',
  prompt: 'Learn how to store a durable memory fact, then store one.',
  userTurns: [
    { content: 'Inspect the available memory capability if needed.' },
    {
      content: 'Remember that subject `e2e-describe-1` has describe_token `DESCRIBE-E2E-9`.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 2 },
    { kind: 'memory_fact', predicate: 'describe_token', value: 'DESCRIBE-E2E-9' },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-tool-describe-then-use'],
    },
  ],
};
/** MemoryAgentBench-adapted: three-turn stateful recall. */
export const BENCH_MEMORY_STATE_3TURN_RECALL: E2EScenario = {
  id: 'bench-memory-state-3turn-recall',
  conversationId: 'e2e-bench-memory-3turn',
  prompt: 'Track two preference tokens across turns.',
  userTurns: [
    {
      content: 'Remember that subject `e2e-state-a` has pref_color `COLOR-E2E-A`.',
    },
    {
      content: 'Remember that subject `e2e-state-b` has pref_color `COLOR-E2E-B`.',
    },
    {
      content: 'Verify the remembered pref_color values for `e2e-state-a` and `e2e-state-b`.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 3 },
    { kind: 'memory_fact', predicate: 'pref_color', value: 'COLOR-E2E-A' },
    { kind: 'memory_fact', predicate: 'pref_color', value: 'COLOR-E2E-B' },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-memory-state-3turn-recall'],
    },
  ],
};
/** tau-bench-adapted: goal success criterion backed by native fixture state. */
export const BENCH_GOAL_JSON_FIELD_CRITERION: E2EScenario = {
  id: 'bench-goal-json-field-criterion',
  conversationId: 'e2e-bench-goal-json',
  prompt:
    'Verify that the default calendar allows modifications, record that evidence for goal `calendar-verify`, then finish once the criterion is satisfied.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'calendar.allowsModifications',
      expectedValue: 'true',
    },
    { kind: 'goal_status', goalId: 'calendar-verify', status: 'completed' },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-goal-json-field-criterion'],
    },
  ],
};
/** STATE-Bench-adapted: goal switch with scoped focus tokens. */
export const BENCH_SCOPED_RECALL_GOAL_SWITCH: E2EScenario = {
  id: 'bench-scoped-recall-goal-switch',
  conversationId: 'e2e-bench-scoped-switch',
  threadTitle: 'bench-scoped-switch-thread',
  prompt: 'Track two goals with distinct scope tokens.',
  userTurns: [
    {
      content: 'Create an active goal `scope-a` titled `scope-a-planning`.',
    },
    { content: 'scope-a-token: SCOPE-A-E2E-42' },
    {
      content: 'Create goal `scope-b` titled `scope-b-planning` and make it the active goal.',
    },
    { content: 'scope-b-token: SCOPE-B-E2E-42' },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 4 },
    { kind: 'goal_status', goalId: 'scope-b', status: 'active' },
    { kind: 'ingestion_job_completed', minCount: 2 },
    { kind: 'memory_episode_count', min: 2 },
    { kind: 'working_block_token', label: 'active_focus', token: 'scope-b-planning' },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-scoped-recall-goal-switch'],
    },
  ],
};
/** AgentBench-adapted: active graph goal before artifact work. */
export const BENCH_BOOTSTRAP_FIRST_TURN_GOALS: E2EScenario = {
  id: 'bench-bootstrap-first-turn-goals',
  conversationId: 'e2e-bench-bootstrap',
  prompt: 'Help me ship the release artifact.',
  userTurns: [
    {
      content:
        'Write `artifacts/release.txt` with exact content `RELEASE-E2E-42`, then complete goal `ship-release`.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 1 },
    { kind: 'goals_bootstrapped', minGoals: 1 },
    { kind: 'goal_status', goalId: 'ship-release', status: 'completed' },
    { kind: 'workspace_file', path: 'artifacts/release.txt', contains: 'RELEASE-E2E-42' },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-bootstrap-first-turn-goals'],
    },
  ],
};
/** τ-bench-adapted: multi-field native JSON chain. */
export const BENCH_TAU_NATIVE_JSON_OUTCOME: E2EScenario = {
  id: 'bench-tau-native-json-outcome',
  conversationId: 'e2e-bench-tau-json',
  prompt:
    'Verify the calendar configuration and events from 2026-06-10T00:00:00Z to 2026-06-11T00:00:00Z.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'calendar.listed',
      expectedValue: 'true',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-tau-native-json-outcome'],
    },
  ],
};
/** AgentBench-adapted: strict list → read → write chain. */
/** BFCL-adapted: parallel function calls in one model turn. */
export const BENCH_BFCL_PARALLEL_FILE_READ: E2EScenario = {
  id: 'bench-bfcl-parallel-file-read',
  conversationId: 'e2e-bench-bfcl-parallel',
  prompt:
    'Write `artifacts/parallel-a.txt` with `BFCL-A-E2E` and `artifacts/parallel-b.txt` with `BFCL-B-E2E`. ' +
    'Then verify both files in the same response.',
  rubrics: [
    { kind: 'workspace_file', path: 'artifacts/parallel-a.txt', contains: 'BFCL-A-E2E' },
    { kind: 'workspace_file', path: 'artifacts/parallel-b.txt', contains: 'BFCL-B-E2E' },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-bfcl-parallel-file-read'],
    },
  ],
};
/** BFCL-adapted: ordered sequential function calls in one model turn. */
export const BENCH_BFCL_SEQUENTIAL_MEMORY_CHAIN: E2EScenario = {
  id: 'bench-bfcl-sequential-memory-chain',
  conversationId: 'e2e-bench-bfcl-sequential',
  prompt:
    'Remember that subject `bfcl-seq-1` has chain_token `BFCL-SEQ-E2E-9`, then verify that memory.',
  rubrics: [
    { kind: 'memory_fact', predicate: 'chain_token', value: 'BFCL-SEQ-E2E-9' },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-bfcl-sequential-memory-chain'],
    },
  ],
};
/** LongMemEval-adapted: delayed recall after a passive middle turn. */
export const BENCH_LONGMEM_DELAYED_RECALL: E2EScenario = {
  id: 'bench-longmem-delayed-recall',
  conversationId: 'e2e-bench-longmem-delayed',
  threadTitle: 'longmem-delayed-thread',
  prompt: 'Track an access code across turns.',
  userTurns: [
    {
      content: 'Remember that subject `longmem-entity` has access_code `LONGMEM-E2E-42`.',
    },
    { content: 'longmem-delayed-thread-token-9' },
    {
      content: 'Verify the stored access_code for subject `longmem-entity`.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 3 },
    { kind: 'memory_fact', predicate: 'access_code', value: 'LONGMEM-E2E-42' },
    { kind: 'ingestion_job_completed', minCount: 1 },
    {
      kind: 'working_block_token',
      label: 'active_focus',
      token: 'longmem-delayed-thread',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-longmem-delayed-recall'],
    },
  ],
};
/** BFCL V3-adapted: multi-turn state carry-over with passive middle turn. */
export const BENCH_BFCL_MULTI_TURN_STATE_CARRY: E2EScenario = {
  id: 'bench-bfcl-multi-turn-state-carry',
  conversationId: 'e2e-bench-bfcl-state',
  threadTitle: 'bfcl-state-carry-thread',
  prompt: 'Persist a workspace token across turns.',
  userTurns: [
    {
      content: 'Write `artifacts/state-carry.txt` with exact content `BFCL-STATE-E2E-42`.',
    },
    { content: 'bfcl-state-passive-token-7' },
    {
      content: 'Verify that `artifacts/state-carry.txt` still contains the stored token.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 3 },
    {
      kind: 'workspace_file',
      path: 'artifacts/state-carry.txt',
      contains: 'BFCL-STATE-E2E-42',
    },
    { kind: 'ingestion_job_completed', minCount: 1 },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-bfcl-multi-turn-state-carry'],
    },
  ],
};
/** BFCL-adapted: passive turn must not invoke tools when surface is empty. */
export const BENCH_BFCL_PASSIVE_NO_TOOLS: E2EScenario = {
  id: 'bench-bfcl-passive-no-tools',
  conversationId: 'e2e-bench-bfcl-passive',
  threadTitle: 'bfcl-passive-thread',
  prompt: 'Acknowledge a passive planning token.',
  userTurns: [
    {
      content: 'Write `artifacts/bfcl-passive-seed.txt` with exact content `BFCL-PASSIVE-SEED`.',
    },
    { content: 'bfcl-passive-planning-token-3' },
    {
      content: 'Verify that `artifacts/bfcl-passive-seed.txt` still contains the seed token.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 3 },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-bfcl-passive-no-tools'],
    },
  ],
};
/** LongMemEval-adapted: dual-fact recall after passive ingestion turn. */
export const BENCH_LONGMEM_DUAL_FACT_RECALL: E2EScenario = {
  id: 'bench-longmem-dual-fact-recall',
  conversationId: 'e2e-bench-longmem-dual',
  threadTitle: 'longmem-dual-thread',
  prompt: 'Track two access tokens across turns.',
  userTurns: [
    {
      content:
        'Remember that subject `longmem-dual` has access_code `LONGMEM-DUAL-A` and backup_code `LONGMEM-DUAL-B`.',
    },
    { content: 'longmem-dual-passive-token-5' },
    {
      content: 'Verify both the access_code and backup_code for subject `longmem-dual`.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 3 },
    { kind: 'memory_fact', predicate: 'access_code', value: 'LONGMEM-DUAL-A' },
    { kind: 'memory_fact', predicate: 'backup_code', value: 'LONGMEM-DUAL-B' },
    { kind: 'memory_episode_count', min: 1 },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-longmem-dual-fact-recall'],
    },
  ],
};
/** MemoryAgentBench/LongMemEval-V2-adapted: updated fact supersedes stale state. */
export const BENCH_LONGMEM_KNOWLEDGE_UPDATE_RECALL: E2EScenario = {
  id: 'bench-longmem-knowledge-update-recall',
  conversationId: 'e2e-bench-longmem-update',
  threadTitle: 'longmem-update-thread',
  prompt: 'Track an updated preference and recall only the current state.',
  userTurns: [
    {
      content:
        'Remember that subject `longmem-update-user` has preferred_station `STATION-OLD-E2E`.',
    },
    {
      content:
        'Update subject `longmem-update-user` so preferred_station is now `STATION-NEW-E2E`, superseding the old value.',
    },
    {
      content: 'Verify that subject `longmem-update-user` has the current preferred_station only.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 3 },
    { kind: 'memory_fact', predicate: 'preferred_station', value: 'STATION-NEW-E2E' },
    { kind: 'memory_fact_absent', predicate: 'preferred_station', value: 'STATION-OLD-E2E' },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-longmem-knowledge-update-recall'],
    },
  ],
};
/** LongMemEval-V2-adapted: abstain on unknown state instead of confabulating memory. */
export const BENCH_LONGMEM_ABSTENTION_EMPTY_RECALL: E2EScenario = {
  id: 'bench-longmem-abstention-empty-recall',
  conversationId: 'e2e-bench-longmem-abstention',
  threadTitle: 'longmem-abstention-thread',
  prompt: 'Recall only known memory and return an empty recall for unknown subjects.',
  userTurns: [
    {
      content: 'Remember that subject `longmem-known-user` has known_code `KNOWN-CODE-E2E`.',
    },
    {
      content: 'Check whether subject `longmem-unknown-user` has any stored facts.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 2 },
    { kind: 'memory_fact', predicate: 'known_code', value: 'KNOWN-CODE-E2E' },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-longmem-abstention-empty-recall'],
    },
  ],
};
/** τ-bench-adapted: chained calendar JSON validators (list → events). */
export const BENCH_TAU_CALENDAR_EVENTS_CHAIN: E2EScenario = {
  id: 'bench-tau-calendar-events-chain',
  conversationId: 'e2e-bench-tau-chain',
  prompt:
    'Verify that the calendar allows modifications and inspect events from 2026-06-10T00:00:00Z to 2026-06-11T00:00:00Z.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'calendar.listed',
      expectedValue: 'true',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-tau-calendar-events-chain'],
    },
  ],
};
export const BENCH_AGENTBENCH_TOOL_CHAIN: E2EScenario = {
  id: 'bench-agentbench-tool-chain',
  conversationId: 'e2e-bench-agentbench-chain',
  prompt:
    'Write `artifacts/chain-seed.txt` with `CHAIN-SEED-E2E`. ' +
    'Inspect `artifacts/`, verify `artifacts/chain-seed.txt`, then write `artifacts/chain-proof.txt` with `CHAIN-PROOF-E2E`.',
  rubrics: [
    { kind: 'workspace_file', path: 'artifacts/chain-proof.txt', contains: 'CHAIN-PROOF-E2E' },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-agentbench-tool-chain'],
    },
  ],
};
/** AndroidWorld/tau-adapted: native calendar creation then update evidence. */
export const BENCH_ANDROIDWORLD_CALENDAR_MUTATION: E2EScenario = {
  id: 'bench-androidworld-calendar-mutation',
  conversationId: 'e2e-bench-androidworld-calendar',
  prompt:
    'Create a calendar event titled `E2E Native Review` from 2026-06-10T09:00:00Z to 2026-06-10T10:00:00Z, then update the created event once by adding note `Updated by E2E`, and verify the calendar state.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'calendar.createdEventCount',
      expectedValue: '1',
    },
    {
      kind: 'native_fixture_state',
      path: 'calendar.updatedEventCount',
      expectedValue: '1',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-androidworld-calendar-mutation'],
    },
  ],
};
/** AndroidWorld-adapted: permission matrix + denied device action state reward. */
export const BENCH_ANDROIDWORLD_PERMISSION_DENIAL: E2EScenario = {
  id: 'bench-androidworld-permission-denial',
  conversationId: 'e2e-bench-androidworld-permission',
  prompt:
    'Check device permission state, handle denied location access, and open maps for query `E2E Station`.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'permissions.location',
      expectedValue: 'denied',
    },
    {
      kind: 'native_fixture_state',
      path: 'permissions.mediaLibrary',
      expectedValue: 'revoked',
    },
    {
      kind: 'native_fixture_state',
      path: 'maps.opened',
      expectedValue: 'true',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-androidworld-permission-denial'],
    },
  ],
};
/** MobileAgentBench-adapted: contact lookup to communication composer. */
export const BENCH_MOBILEAGENT_CONTACT_MESSAGE_DRAFT: E2EScenario = {
  id: 'bench-mobileagent-contact-message-draft',
  conversationId: 'e2e-bench-mobileagent-contact-message',
  prompt:
    'Find Avery in contacts and prepare a one-recipient SMS draft with message `E2E-MOBILE-MESSAGE`.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'contacts.resultCount',
      expectedValue: '1',
    },
    {
      kind: 'native_fixture_state',
      path: 'sms.opened',
      expectedValue: 'true',
    },
    {
      kind: 'native_fixture_state',
      path: 'sms.recipientCount',
      expectedValue: '1',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-mobileagent-contact-message-draft'],
    },
  ],
};
/** MobileWorld-adapted: mobile tool discovery before contact/message execution. */
export const BENCH_MOBILEWORLD_DISCOVER_CONTACT_MESSAGE: E2EScenario = {
  id: 'bench-mobileworld-discover-contact-message',
  conversationId: 'e2e-bench-mobileworld-discover-contact',
  prompt: 'Discover and then use mobile communication tools.',
  userTurns: [
    {
      content:
        'Find the right mobile communication capability for looking up a contact and preparing a message.',
    },
    {
      content:
        'Find Avery in contacts and prepare a one-recipient SMS draft with message `E2E-MOBILEWORLD-MESSAGE`.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 2 },
    {
      kind: 'native_fixture_state',
      path: 'contacts.resultCount',
      expectedValue: '1',
    },
    {
      kind: 'native_fixture_state',
      path: 'sms.opened',
      expectedValue: 'true',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-mobileworld-discover-contact-message'],
    },
  ],
};
/** KnowU-Bench-adapted: personalized mobile action from remembered preference. */
export const BENCH_KNOWU_PERSONALIZED_CONTACT_MEMORY: E2EScenario = {
  id: 'bench-knowu-personalized-contact-memory',
  conversationId: 'e2e-bench-knowu-contact-memory',
  threadTitle: 'knowu-personalized-mobile-thread',
  prompt: 'Use remembered user preference to pick the mobile communication target.',
  userTurns: [
    {
      content: 'Remember that subject `knowu-user` has preferred_message_contact `Avery`.',
    },
    {
      content: 'knowu-passive-mobile-context-token-7',
    },
    {
      content:
        'Use the remembered preferred_message_contact for `knowu-user` to prepare a one-recipient SMS draft with message `E2E-KNOWU-MESSAGE`.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 3 },
    { kind: 'memory_fact', predicate: 'preferred_message_contact', value: 'Avery' },
    {
      kind: 'native_fixture_state',
      path: 'contacts.resultCount',
      expectedValue: '1',
    },
    {
      kind: 'native_fixture_state',
      path: 'sms.opened',
      expectedValue: 'true',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-knowu-personalized-contact-memory'],
    },
  ],
};
/** AndroidWorld-adapted: stateful clipboard, share sheet, and notification evidence. */
export const BENCH_ANDROIDWORLD_CLIPBOARD_SHARE_NOTIFY: E2EScenario = {
  id: 'bench-androidworld-clipboard-share-notify',
  conversationId: 'e2e-bench-androidworld-state',
  prompt:
    'Put `E2E-CLIPBOARD-42` on the clipboard and verify it, open a share sheet for `E2E-SHARE-42`, then schedule a notification for 60 seconds and cancel it.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'clipboard.text',
      expectedValue: 'E2E-CLIPBOARD-42',
    },
    {
      kind: 'native_fixture_state',
      path: 'share.opened',
      expectedValue: 'true',
    },
    {
      kind: 'native_fixture_state',
      path: 'notification.scheduled',
      expectedValue: 'true',
    },
    {
      kind: 'native_fixture_state',
      path: 'notification.cancelled',
      expectedValue: 'true',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-androidworld-clipboard-share-notify'],
    },
  ],
};
/** MobileAgentBench-adapted: media retrieval and screen/camera state evidence. */
export const BENCH_MOBILEAGENT_MEDIA_STATE: E2EScenario = {
  id: 'bench-mobileagent-media-state',
  conversationId: 'e2e-bench-mobileagent-media',
  prompt:
    'Inspect the latest two photos, capture the screen as PNG, and record a 3-second camera clip.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'media.photoCount',
      expectedValue: '2',
    },
    {
      kind: 'native_fixture_state',
      path: 'media.screenStatus',
      expectedValue: 'captured',
    },
    {
      kind: 'native_fixture_state',
      path: 'media.cameraStatus',
      expectedValue: 'recorded',
    },
    {
      kind: 'native_fixture_state',
      path: 'media.cameraDuration',
      expectedValue: '3',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-mobileagent-media-state'],
    },
  ],
};
export const E2E_BENCHMARK_SCENARIOS: ReadonlyArray<E2EScenario> = [
  BENCH_GAIA_FILE_HOP_CHAIN,
  BENCH_SESSION_TOOL_CACHE,
  BENCH_PROMPT_CACHE_LONG_HORIZON,
  BENCH_PROMPT_CACHE_CONVERGENCE_LONG_RUN,
  BENCH_TOOL_DESCRIBE_THEN_USE,
  BENCH_MEMORY_STATE_3TURN_RECALL,
  BENCH_GOAL_JSON_FIELD_CRITERION,
  BENCH_SCOPED_RECALL_GOAL_SWITCH,
  BENCH_BOOTSTRAP_FIRST_TURN_GOALS,
  BENCH_TAU_NATIVE_JSON_OUTCOME,
  BENCH_TAU_CALENDAR_EVENTS_CHAIN,
  BENCH_AGENTBENCH_TOOL_CHAIN,
  BENCH_BFCL_PARALLEL_FILE_READ,
  BENCH_BFCL_SEQUENTIAL_MEMORY_CHAIN,
  BENCH_BFCL_MULTI_TURN_STATE_CARRY,
  BENCH_BFCL_PASSIVE_NO_TOOLS,
  BENCH_LONGMEM_DELAYED_RECALL,
  BENCH_LONGMEM_DUAL_FACT_RECALL,
  BENCH_LONGMEM_KNOWLEDGE_UPDATE_RECALL,
  BENCH_LONGMEM_ABSTENTION_EMPTY_RECALL,
  BENCH_ANDROIDWORLD_CALENDAR_MUTATION,
  BENCH_ANDROIDWORLD_PERMISSION_DENIAL,
  BENCH_MOBILEAGENT_CONTACT_MESSAGE_DRAFT,
  BENCH_MOBILEWORLD_DISCOVER_CONTACT_MESSAGE,
  BENCH_KNOWU_PERSONALIZED_CONTACT_MEMORY,
  BENCH_ANDROIDWORLD_CLIPBOARD_SHARE_NOTIFY,
  BENCH_MOBILEAGENT_MEDIA_STATE,
];
