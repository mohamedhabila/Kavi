// ---------------------------------------------------------------------------
// Kavi — E2E benchmark workspace and tool-chain scenarios
// ---------------------------------------------------------------------------
import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2EScenario } from './types';

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
