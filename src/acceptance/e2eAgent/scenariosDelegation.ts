import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2EScenario } from './types';

/** Live delegation scenario: a worker produces the answer. */
export const DELEGATION_E2E_SCENARIO: E2EScenario = {
  id: 'delegation-worker-finalize',
  conversationId: 'e2e-delegation',
  contentClass: 'synthetic_public',
  execution: { initialMode: 'agentic', route: 'forced_agentic' },
  prompt:
    'Delegate this to a worker: it returns exact output `E2E-WORKER-EVIDENCE-42`. ' +
    'Tell me what the worker returned.',
  rubrics: [
    { kind: 'worker_result_token', token: 'E2E-WORKER-EVIDENCE-42' },
    { kind: 'turn_final_response_token', turnIndex: 0, token: 'E2E-WORKER-EVIDENCE-42' },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['delegation-worker-finalize'],
    },
  ],
};

/** Live delegation scenario: the worker's terminal result reaches the user. */
export const DELEGATION_CHAIN_E2E_SCENARIO: E2EScenario = {
  id: 'delegation-worker-evidence-chain',
  conversationId: 'e2e-delegation-chain',
  contentClass: 'synthetic_public',
  execution: { initialMode: 'agentic', route: 'forced_agentic' },
  prompt:
    'Delegate this to a worker: it returns `E2E-WORKER-CHAIN-77`. ' +
    'Tell me what the worker returned.',
  rubrics: [
    { kind: 'worker_result_token', token: 'E2E-WORKER-CHAIN-77' },
    { kind: 'turn_final_response_token', turnIndex: 0, token: 'E2E-WORKER-CHAIN-77' },
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
