import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2EScenario } from './types';

export const E2E_CORE_MULTI_TURN_SCENARIOS: ReadonlyArray<E2EScenario> = [
  {
    id: 'multi-turn-trip-artifact',
    conversationId: 'e2e-trip-artifact',
    contentClass: 'synthetic_public',
    prompt: 'Help me plan a weekend trip.',
    userTurns: [
      {
        content: 'Write `artifacts/trip-plan.txt` with exact content `TRIP-E2E-42`.',
      },
    ],
    rubrics: [
      { kind: 'min_user_turns', min: 1 },
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
    contentClass: 'synthetic_public',
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
    contentClass: 'synthetic_public',
    threadTitle: 'weekend-planning-thread',
    prompt: 'weekend-planning-thread',
    // Chit-chat that asks for nothing: placeholder tokens such as "plan-weekend-trip-42" read
    // as a trip-planning request without its details, which Kavi rightly asked about.
    userTurns: [
      { content: 'My sister and I are thinking about a weekend at the coast. Nothing booked yet.' },
      { content: "We've settled on Saturday, leaving around nine in the morning." },
    ],
    rubrics: [
      { kind: 'min_user_turns', min: 2 },
      { kind: 'memory_turns_indexed', min: 1 },
      { kind: 'graph_terminal_success' },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['multi-turn-passive-chitchat-memory'],
      },
    ],
  },
  {
    id: 'native-calendar-json-field',
    conversationId: 'e2e-native-calendar',
    contentClass: 'synthetic_public',
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
    contentClass: 'synthetic_public',
    prompt: 'Persist the gate artifact.',
    userTurns: [
      {
        content: 'Write `artifacts/e2e-follow-gate.txt` with exact content `E2E-GATE-FU-42`.',
      },
      {
        content: 'Verify `artifacts/e2e-follow-gate.txt` holds `E2E-GATE-FU-42`.',
      },
    ],
    rubrics: [
      { kind: 'min_user_turns', min: 2 },
      { kind: 'turn_final_response_token', turnIndex: 1, token: 'E2E-GATE-FU-42' },
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
