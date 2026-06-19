import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2EScenario } from './types';

export const E2E_CORE_MEMORY_SCENARIOS: ReadonlyArray<E2EScenario> = [
  {
    id: 'memory-remember-recall',
    conversationId: 'e2e-memory-recall',
    prompt:
      'Remember that subject `e2e-entity-i1` has artifact_token `E2E-MEM-42`, then verify the stored value.',
    rubrics: [
      { kind: 'memory_fact', predicate: 'artifact_token', value: 'E2E-MEM-42' },
      { kind: 'graph_terminal_success' },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['memory-remember-recall'],
      },
    ],
  },
  {
    id: 'multi-turn-memory-preference',
    conversationId: 'e2e-memory-preference',
    prompt: 'Remember my meeting code for subject personal-meeting.',
    userTurns: [
      {
        content: 'Remember that subject `personal-meeting` has meeting_code `E2E-MEET-42`.',
      },
      {
        content: 'Verify the stored meeting_code for subject `personal-meeting`.',
      },
      {
        content: 'Remember that subject `personal-meeting` has favorite_snack `E2E-SNACK-9`.',
      },
    ],
    rubrics: [
      { kind: 'min_user_turns', min: 3 },
      { kind: 'memory_fact', predicate: 'meeting_code', value: 'E2E-MEET-42' },
      { kind: 'memory_fact', predicate: 'favorite_snack', value: 'E2E-SNACK-9' },
      { kind: 'graph_terminal_success' },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['multi-turn-memory-preference'],
      },
    ],
  },
  {
    id: 'multi-turn-catalog-memory',
    conversationId: 'e2e-catalog-memory',
    prompt: 'Find the available durable memory capability.',
    userTurns: [
      {
        content: 'Find the right capability for storing a durable memory fact.',
      },
      {
        content: 'Remember that subject `e2e-pa-1` has context_token `PA-E2E-42`.',
      },
    ],
    rubrics: [
      { kind: 'min_user_turns', min: 2 },
      { kind: 'memory_fact', predicate: 'context_token', value: 'PA-E2E-42' },
      { kind: 'graph_terminal_success' },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['multi-turn-catalog-memory'],
      },
    ],
  },
  {
    id: 'tool-catalog-query-memory',
    conversationId: 'e2e-catalog-query',
    prompt: 'Discover how to recall durable memory.',
    userTurns: [
      {
        content: 'Find the right capability for reading stored memory facts.',
      },
      {
        content: 'Check whether subject `e2e-query-1` has stored facts.',
      },
    ],
    rubrics: [
      { kind: 'min_user_turns', min: 2 },
      { kind: 'graph_terminal_success' },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['tool-catalog-query-memory'],
      },
    ],
  },
];
