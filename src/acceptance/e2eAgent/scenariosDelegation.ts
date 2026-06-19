import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2EScenario } from './types';

/** Live delegation scenario with graph-owned worker evidence. */
export const DELEGATION_E2E_SCENARIO: E2EScenario = {
  id: 'delegation-worker-finalize',
  conversationId: 'e2e-delegation',
  prompt:
    'Goal `worker-task` is active with requiredCapabilities `coordinate` and successCriteria ' +
    '`evidence.prefix:worker` and `evidence.min:1`. ' +
    'Delegate workstream `worker-task` so the worker returns exact output `E2E-WORKER-EVIDENCE-42`. ' +
    'After worker evidence is recorded, mark `worker-task` completed.',
  rubrics: [
    { kind: 'goal_evidence_satisfied' },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['delegation-worker-finalize'],
    },
  ],
};

/** Live delegation scenario for terminal worker evidence chains. */
export const DELEGATION_CHAIN_E2E_SCENARIO: E2EScenario = {
  id: 'delegation-worker-evidence-chain',
  conversationId: 'e2e-delegation-chain',
  prompt:
    'Goal `worker-chain` is active with requiredCapabilities `coordinate` and successCriteria ' +
    '`evidence.prefix:worker` and `evidence.min:1`. ' +
    'Delegate workstream `worker-chain` so the worker returns `E2E-WORKER-CHAIN-77`. ' +
    'After worker evidence is recorded, mark `worker-chain` completed.',
  rubrics: [
    { kind: 'goal_evidence_satisfied' },
    { kind: 'goal_status', goalId: 'worker-chain', status: 'completed' },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['delegation-worker-evidence-chain'],
    },
  ],
};

export const DELEGATION_E2E_SCENARIOS: ReadonlyArray<E2EScenario> = [
  DELEGATION_E2E_SCENARIO,
  DELEGATION_CHAIN_E2E_SCENARIO,
];
