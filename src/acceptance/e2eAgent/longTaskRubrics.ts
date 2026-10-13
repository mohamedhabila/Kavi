// ---------------------------------------------------------------------------
// Kavi — E2E long-task rubric helpers
// ---------------------------------------------------------------------------
import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2ERubric } from './types';

/** The turn ran as a tracked run and ended with a complete answer, not a pause or checkpoint. */
export function completedTurnRubrics(turnIndex: number): E2ERubric[] {
  return [
    { kind: 'turn_completion', turnIndex, field: 'execution', expected: true },
    { kind: 'turn_completion', turnIndex, field: 'final_response', expected: true },
    { kind: 'turn_completion', turnIndex, field: 'agent_run', expected: true },
  ];
}

/** Terminal success within the scenario's token budget and 1.5× its reference tool calls. */
export function longTaskBudgetRubrics(scenarioId: string, referenceToolCalls: number): E2ERubric[] {
  return [
    { kind: 'graph_terminal_success' },
    { kind: 'token_budget', maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS[scenarioId] },
    { kind: 'tool_call_budget', maxToolCalls: Math.ceil(referenceToolCalls * 1.5) },
  ];
}

export function workspaceFileContains(path: string, tokens: ReadonlyArray<string>): E2ERubric[] {
  return tokens.map((contains) => ({ kind: 'workspace_file', path, contains }));
}
