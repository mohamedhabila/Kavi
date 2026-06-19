import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2EScenario } from './types';

export const E2E_CORE_WORKSPACE_SCENARIOS: ReadonlyArray<E2EScenario> = [
  {
    id: 'file-write-read',
    conversationId: 'e2e-file-write-read',
    prompt:
      'Write workspace file `artifacts/e2e-file.txt` with exact content `E2E-FILE-42`. ' +
      'Then verify `artifacts/e2e-file.txt`.',
    rubrics: [
      { kind: 'workspace_file', path: 'artifacts/e2e-file.txt', contains: 'E2E-FILE-42' },
      { kind: 'token_budget', maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['file-write-read'] },
    ],
  },
  {
    id: 'goal-evidence-complete',
    conversationId: 'e2e-goal-evidence',
    prompt:
      'Create an active goal `persist-artifact` for saving an artifact. ' +
      'Write `artifacts/e2e-goal.txt` with content `E2E-GOAL-42`. ' +
      'Complete the goal once evidence criteria are satisfied.',
    rubrics: [
      { kind: 'goals_bootstrapped', minGoals: 1 },
      { kind: 'goal_evidence_satisfied' },
      { kind: 'goal_status', goalId: 'persist-artifact', status: 'completed' },
      { kind: 'workspace_file', path: 'artifacts/e2e-goal.txt', contains: 'E2E-GOAL-42' },
      { kind: 'graph_terminal_success' },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['goal-evidence-complete'],
      },
    ],
  },
  {
    id: 'false-finalize-recovery',
    conversationId: 'e2e-false-finalize',
    prompt: 'Write `artifacts/e2e-gate.txt` with content `E2E-GATE-42`.',
    rubrics: [
      { kind: 'goal_evidence_satisfied' },
      { kind: 'workspace_file', path: 'artifacts/e2e-gate.txt', contains: 'E2E-GATE-42' },
      { kind: 'graph_terminal_success' },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['false-finalize-recovery'],
      },
    ],
  },
  {
    id: 'tool-catalog-agents',
    conversationId: 'e2e-tool-catalog',
    prompt:
      'Find the available agent coordination capability and use it to inspect the current agent state.',
    rubrics: [
      { kind: 'graph_terminal_success' },
      { kind: 'token_budget', maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['tool-catalog-agents'] },
    ],
  },
  {
    id: 'personal-shopping-list',
    conversationId: 'e2e-shopping-list',
    prompt:
      'Write `artifacts/shopping.txt` with two lines: `MILK-E2E` then `EGGS-E2E` (one item per line).',
    rubrics: [
      { kind: 'workspace_file', path: 'artifacts/shopping.txt', contains: 'MILK-E2E' },
      { kind: 'workspace_file', path: 'artifacts/shopping.txt', contains: 'EGGS-E2E' },
      { kind: 'graph_terminal_success' },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['personal-shopping-list'],
      },
    ],
  },
  {
    id: 'workspace-inventory-manifest',
    conversationId: 'e2e-inventory-manifest',
    prompt:
      'Write `artifacts/item-a.txt` with `ITEM-A-E2E` and `artifacts/item-b.txt` with `ITEM-B-E2E`. ' +
      'Inspect `artifacts/`, then write `artifacts/inventory.txt` listing both filenames.',
    rubrics: [
      { kind: 'workspace_file', path: 'artifacts/item-a.txt', contains: 'ITEM-A-E2E' },
      { kind: 'workspace_file', path: 'artifacts/item-b.txt', contains: 'ITEM-B-E2E' },
      { kind: 'workspace_file', path: 'artifacts/inventory.txt', contains: 'item-a.txt' },
      { kind: 'graph_terminal_success' },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['workspace-inventory-manifest'],
      },
    ],
  },
];
