import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2EScenario } from './types';

export const E2E_CORE_MULTI_TURN_SCENARIOS: ReadonlyArray<E2EScenario> = [
  {
    id: 'multi-turn-trip-artifact',
    conversationId: 'e2e-trip-artifact',
    prompt: 'Help me plan a weekend trip.',
    userTurns: [
      {
        content:
          'Write `artifacts/trip-plan.txt` with exact content `TRIP-E2E-42`, then complete goal `weekend-trip`.',
      },
    ],
    rubrics: [
      { kind: 'min_user_turns', min: 1 },
      { kind: 'goals_bootstrapped', minGoals: 1 },
      { kind: 'goal_status', goalId: 'weekend-trip', status: 'completed' },
      { kind: 'workspace_file', path: 'artifacts/trip-plan.txt', contains: 'TRIP-E2E-42' },
      { kind: 'graph_terminal_success' },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['multi-turn-trip-artifact'],
      },
    ],
  },
  {
    id: 'multi-turn-inventory-readback',
    conversationId: 'e2e-inventory-readback',
    prompt: 'Create two personal notes in the workspace.',
    userTurns: [
      {
        content:
          'Write `artifacts/note-a.txt` with `NOTE-A-E2E` and `artifacts/note-b.txt` with `NOTE-B-E2E`.',
      },
      {
        content: 'Inspect `artifacts/`, then verify `artifacts/note-a.txt`.',
      },
    ],
    rubrics: [
      { kind: 'min_user_turns', min: 2 },
      { kind: 'workspace_file', path: 'artifacts/note-a.txt', contains: 'NOTE-A-E2E' },
      { kind: 'workspace_file', path: 'artifacts/note-b.txt', contains: 'NOTE-B-E2E' },
      { kind: 'graph_terminal_success' },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['multi-turn-inventory-readback'],
      },
    ],
  },
  {
    id: 'multi-turn-passive-chitchat-memory',
    conversationId: 'e2e-passive-chitchat',
    threadTitle: 'weekend-planning-thread',
    prompt: 'weekend-planning-thread',
    userTurns: [{ content: 'plan-weekend-trip-42' }, { content: 'confirm-weekend-plan-42' }],
    rubrics: [
      { kind: 'min_user_turns', min: 2 },
      { kind: 'ingestion_job_completed', minCount: 1 },
      { kind: 'memory_episode_count', min: 1 },
      {
        kind: 'working_block_token',
        label: 'active_focus',
        token: 'weekend-planning-thread',
      },
      { kind: 'graph_terminal_success' },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['multi-turn-passive-chitchat-memory'],
      },
    ],
  },
  {
    id: 'multi-turn-goal-passive-recall',
    conversationId: 'e2e-goal-passive',
    threadTitle: 'meal-planning-scope',
    prompt: 'Track goals while I share planning tokens.',
    userTurns: [
      {
        content: 'Create an active goal `trip-plan` with title `trip-planning-scope`.',
      },
      { content: 'trip-token: TRIP-PASSIVE-42' },
      {
        content: 'Create goal `meal-plan` titled `meal-planning-scope` and make it active.',
      },
      { content: 'meal-token: MEAL-PASSIVE-42' },
    ],
    rubrics: [
      { kind: 'min_user_turns', min: 4 },
      { kind: 'goal_status', goalId: 'meal-plan', status: 'active' },
      { kind: 'ingestion_job_completed', minCount: 2 },
      { kind: 'memory_episode_count', min: 2 },
      {
        kind: 'working_block_token',
        label: 'active_focus',
        token: 'meal-planning-scope',
      },
      { kind: 'graph_terminal_success' },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['multi-turn-goal-passive-recall'],
      },
    ],
  },
  {
    id: 'native-calendar-json-field',
    conversationId: 'e2e-native-calendar',
    prompt:
      'Verify the calendar configuration and events for 2026-06-10T00:00:00Z to 2026-06-11T00:00:00Z.',
    rubrics: [
      {
        kind: 'native_fixture_state',
        path: 'calendar.listed',
        expectedValue: 'true',
      },
      { kind: 'graph_terminal_success' },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['native-calendar-json-field'],
      },
    ],
  },
  {
    id: 'multi-turn-gate-followup',
    conversationId: 'e2e-gate-followup',
    prompt: 'Persist the gate artifact for the active goal.',
    userTurns: [
      {
        content: 'Write `artifacts/e2e-follow-gate.txt` with exact content `E2E-GATE-FU-42`.',
      },
      {
        content:
          'If goal `gate-followup` still needs completion, mark it completed after verifying the artifact.',
      },
    ],
    rubrics: [
      { kind: 'min_user_turns', min: 2 },
      { kind: 'goal_evidence_satisfied' },
      { kind: 'goal_status', goalId: 'gate-followup', status: 'completed' },
      {
        kind: 'workspace_file',
        path: 'artifacts/e2e-follow-gate.txt',
        contains: 'E2E-GATE-FU-42',
      },
      {
        kind: 'file_hash',
        path: 'artifacts/e2e-follow-gate.txt',
        expectedHash: 'eacb5fe2679bd9689d8813150ea2dce2454ed0c0362846319263eb73a2f02478',
      },
      { kind: 'graph_terminal_success' },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['multi-turn-gate-followup'],
      },
    ],
  },
];
