import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2ERubric, E2EScenario } from './types';

const EVENT_TITLE = 'Causal memory design review';
const CURRENT_PREFERENCE = {
  subject: 'user',
  predicate: 'default_meeting_duration_minutes',
  value: '45',
  scope: 'global',
} as const;
const STALE_PREFERENCE = { ...CURRENT_PREFERENCE, value: '30' } as const;

function completedTurnRubrics(turnIndex: number, mode: 'agentic' | 'chitchat'): E2ERubric[] {
  return [
    { kind: 'turn_route', turnIndex, directive: 'production_auto', mode },
    { kind: 'turn_completion', turnIndex, field: 'execution', expected: true },
    { kind: 'turn_completion', turnIndex, field: 'final_response', expected: true },
    {
      kind: 'turn_completion',
      turnIndex,
      field: 'agent_run',
      expected: mode === 'agentic' ? true : null,
    },
  ];
}

const NEUTRAL_RUBRICS: ReadonlyArray<E2ERubric> = [
  { kind: 'min_user_turns', min: 4 },
  ...completedTurnRubrics(0, 'chitchat'),
  ...completedTurnRubrics(1, 'chitchat'),
  ...completedTurnRubrics(2, 'agentic'),
  ...completedTurnRubrics(3, 'chitchat'),
  { kind: 'turn_native_invocation_count', turnIndex: 0, expectedCount: 0 },
  { kind: 'turn_native_invocation_count', turnIndex: 1, expectedCount: 0 },
  { kind: 'turn_tool_call_count', turnIndex: 0, scope: 'all', expectedCount: 0 },
  { kind: 'turn_tool_call_count', turnIndex: 1, scope: 'all', expectedCount: 0 },
  { kind: 'turn_lifecycle_boundary', turnIndex: 2, boundary: 'new_conversation' },
  { kind: 'memory_fact_absent', ...STALE_PREFERENCE },
  { kind: 'native_fixture_state', path: 'calendar.updatedEventCount', expectedValue: '0' },
  {
    kind: 'turn_native_invocation_count',
    turnIndex: 2,
    toolName: 'calendar_update_event',
    expectedCount: 0,
  },
  { kind: 'turn_native_invocation_count', turnIndex: 3, expectedCount: 0 },
  {
    kind: 'token_budget',
    maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['paired-causal-global-preference'],
  },
];

const CAUSAL_RUBRICS: ReadonlyArray<E2ERubric> = [
  { kind: 'memory_fact', ...CURRENT_PREFERENCE },
  {
    kind: 'turn_memory_selection',
    turnIndex: 2,
    requiredFacts: [CURRENT_PREFERENCE],
    forbiddenFacts: [STALE_PREFERENCE],
  },
  {
    kind: 'turn_memory_selection',
    turnIndex: 3,
    requiredFacts: [CURRENT_PREFERENCE],
    forbiddenFacts: [STALE_PREFERENCE],
  },
  {
    kind: 'turn_memory_answer',
    turnIndex: 3,
    answer: { kind: 'fact_values', requiredValues: ['45'], forbiddenValues: ['30'] },
  },
  {
    kind: 'turn_native_invocation_count',
    turnIndex: 2,
    toolName: 'calendar_create_event',
    expectedCount: 1,
  },
  { kind: 'native_fixture_state', path: 'calendar.createdEventCount', expectedValue: '1' },
  {
    kind: 'native_fixture_state',
    path: 'calendar.lastCreatedEventId',
    expectedValue: 'e2e-event-1',
  },
  {
    kind: 'native_fixture_state',
    path: 'calendar.lastCreatedTitle',
    expectedValue: EVENT_TITLE,
  },
  {
    kind: 'native_fixture_state',
    path: 'calendar.lastCreatedStartDate',
    expectedValue: '2026-07-23T14:00:00.000Z',
  },
  {
    kind: 'native_fixture_state',
    path: 'calendar.lastCreatedEndDate',
    expectedValue: '2026-07-23T14:45:00.000Z',
  },
  {
    kind: 'native_fixture_state',
    path: 'calendar.lastCreatedDurationMinutes',
    expectedValue: '45',
  },
];

const NEUTRAL_RUBRIC_INDEXES = NEUTRAL_RUBRICS.map((_rubric, index) => index);
const CAUSAL_RUBRIC_INDEXES = CAUSAL_RUBRICS.map(
  (_rubric, index) => NEUTRAL_RUBRICS.length + index,
);

export const PAIRED_CAUSAL_GLOBAL_PREFERENCE_SCENARIO: E2EScenario = {
  id: 'paired-causal-global-preference',
  conversationId: 'e2e-paired-causal-global-preference',
  contentClass: 'synthetic_public',
  execution: { initialMode: 'chitchat', route: 'production_auto' },
  threadTitle: 'Fresh conversation preference use',
  prompt:
    'Evaluate whether a naturally corrected global preference can support a fresh conversation without raw-history leakage.',
  userTurns: [
    {
      content:
        'I am planning design reviews next week. Please remember that I usually keep design-review meetings to 30 minutes.',
    },
    {
      content: 'Actually, make my usual design-review length 45 minutes from now on, not 30.',
    },
    {
      lifecycleBefore: 'new_conversation',
      selectedMode: 'agentic',
      content: `Create one calendar event titled "${EVENT_TITLE}" in my modifiable calendar starting at 2026-07-23T14:00:00Z. Use my usual design-review length. If you cannot determine that duration, do not guess or create anything; ask me for it. Verify any event you create and do not create duplicates.`,
    },
    {
      selectedMode: 'chitchat',
      content: 'What is my usual design-review length? Do not make any changes.',
    },
  ],
  rubrics: [...NEUTRAL_RUBRICS, ...CAUSAL_RUBRICS],
  pairedEvaluation: {
    kind: 'causal_memory',
    referenceCondition: 'memory_off',
    candidateCondition: 'production_auto',
    neutralRubricIndexes: NEUTRAL_RUBRIC_INDEXES,
    causalRubricIndexes: CAUSAL_RUBRIC_INDEXES,
  },
};

export const E2E_PAIRED_ONLY_SCENARIOS: ReadonlyArray<E2EScenario> = [
  PAIRED_CAUSAL_GLOBAL_PREFERENCE_SCENARIO,
];
