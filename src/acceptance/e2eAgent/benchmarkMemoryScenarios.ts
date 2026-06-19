// ---------------------------------------------------------------------------
// Kavi — E2E benchmark memory scenarios
// ---------------------------------------------------------------------------
import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2EScenario } from './types';

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
