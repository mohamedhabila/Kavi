import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2ERubric, E2EScenario } from './types';

const RECOVERED_WEEK_PLAN = 'ORGANIC-WEEK-PLAN-RECOVERED-E2E-77';
const RECOVERED_WEEK_PLAN_SHA256 =
  '2077bc75ba1bae2c0f7f3512cd0781d24c06b38b0fe980f90c4365a18f3fc7d9';
const CALENDAR_EVENT_TITLE = 'Organic design review';

function completedProductionTurnRubrics(
  turnIndex: number,
  mode: 'chitchat' | 'agentic',
): E2ERubric[] {
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
    { kind: 'turn_memory_receipt', turnIndex },
  ];
}

/**
 * One product-native conversation instead of isolated capability probes. The
 * user changes modes through the same persisted choice exposed by the app;
 * production_auto then preserves that choice rather than forcing an evaluator
 * route. End-state rubrics score outcomes, not tool names or tool order.
 */
export const ORGANIC_MOBILE_ASSISTANT_CONTINUITY_SCENARIO: E2EScenario = {
  id: 'organic-mobile-assistant-continuity',
  conversationId: 'e2e-organic-mobile-assistant-continuity',
  contentClass: 'synthetic_public',
  execution: { initialMode: 'chitchat', route: 'production_auto' },
  threadTitle: 'Design week continuity',
  prompt:
    'Continue one natural mobile-assistant conversation across mode choices, corrections, actions, relaunches, ambiguity, and recovery.',
  initialWorkspaceFiles: [
    {
      path: 'policies/week-plan-recovery.txt',
      content:
        `The previous attempt left artifacts/week-plan.txt incomplete. ` +
        `Recovery succeeds only when that file contains exactly ${RECOVERED_WEEK_PLAN}.`,
    },
    {
      path: 'artifacts/week-plan.txt',
      content: 'PARTIAL-WEEK-PLAN-E2E-77',
    },
  ],
  userTurns: [
    {
      content:
        'Hey Kavi, I am organizing design week. Please remember that I usually keep design-review meetings to 30 minutes.',
    },
    {
      content:
        'No action needed yet—why can a short design review be useful? Keep this as a normal conversation.',
    },
    {
      content:
        'Actually, make that 45 minutes from now on, not 30. Please update what you remember about my usual design-review length.',
    },
    {
      selectedMode: 'agentic',
      content: `Create one calendar event titled "${CALENDAR_EVENT_TITLE}" in my modifiable calendar starting at 2026-07-16T14:00:00Z. Use my current remembered default duration, verify the result, and do not create duplicates.`,
    },
    {
      selectedMode: 'chitchat',
      content: 'What exact event title did you just create for me?',
    },
    {
      lifecycleBefore: 'app_relaunch',
      content:
        'What is my current usual design-review length? Use the corrected value, not the old one.',
    },
    {
      selectedMode: 'agentic',
      content: `I might move "${CALENDAR_EVENT_TITLE}" later, but I have not chosen a new time. Do not update the calendar yet; tell me what detail is missing.`,
    },
    {
      selectedMode: 'agentic',
      content:
        'Recover the interrupted week-plan work now. Inspect `policies/week-plan-recovery.txt`, replace the incomplete contents of `artifacts/week-plan.txt` with the exact approved content, and verify the recovered file.',
    },
    {
      lifecycleBefore: 'app_relaunch',
      selectedMode: 'chitchat',
      content:
        'Recap my current design-review length and the exact calendar event title, without making any new changes.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 9 },
    ...completedProductionTurnRubrics(0, 'chitchat'),
    ...completedProductionTurnRubrics(1, 'chitchat'),
    ...completedProductionTurnRubrics(2, 'chitchat'),
    ...completedProductionTurnRubrics(3, 'agentic'),
    ...completedProductionTurnRubrics(4, 'chitchat'),
    ...completedProductionTurnRubrics(5, 'chitchat'),
    ...completedProductionTurnRubrics(6, 'agentic'),
    ...completedProductionTurnRubrics(7, 'agentic'),
    ...completedProductionTurnRubrics(8, 'chitchat'),
    { kind: 'turn_lifecycle_boundary', turnIndex: 5, boundary: 'app_relaunch' },
    { kind: 'turn_lifecycle_boundary', turnIndex: 8, boundary: 'app_relaunch' },
    { kind: 'turn_final_response_token', turnIndex: 4, token: CALENDAR_EVENT_TITLE },
    { kind: 'turn_final_response_token', turnIndex: 5, token: '45' },
    {
      kind: 'turn_clarification',
      turnIndex: 6,
      requiredMissingInformation: [{ semanticRole: 'time' }],
    },
    { kind: 'turn_final_response_token', turnIndex: 8, token: CALENDAR_EVENT_TITLE },
    { kind: 'turn_final_response_token', turnIndex: 8, token: '45' },
    {
      kind: 'turn_memory_selection',
      turnIndex: 3,
      requiredFacts: [
        {
          subject: 'user',
          predicate: 'default_meeting_duration_minutes',
          value: '45',
          scope: 'global',
        },
      ],
      forbiddenFacts: [
        {
          subject: 'user',
          predicate: 'default_meeting_duration_minutes',
          value: '30',
          scope: 'global',
        },
      ],
    },
    {
      kind: 'turn_memory_selection',
      turnIndex: 5,
      requiredFacts: [
        {
          subject: 'user',
          predicate: 'default_meeting_duration_minutes',
          value: '45',
          scope: 'global',
        },
      ],
      forbiddenFacts: [
        {
          subject: 'user',
          predicate: 'default_meeting_duration_minutes',
          value: '30',
          scope: 'global',
        },
      ],
    },
    {
      kind: 'turn_memory_answer',
      turnIndex: 5,
      answer: { kind: 'fact_values', requiredValues: ['45'], forbiddenValues: ['30'] },
    },
    {
      kind: 'turn_memory_selection',
      turnIndex: 8,
      requiredFacts: [
        {
          subject: 'user',
          predicate: 'default_meeting_duration_minutes',
          value: '45',
          scope: 'global',
        },
      ],
      forbiddenFacts: [
        {
          subject: 'user',
          predicate: 'default_meeting_duration_minutes',
          value: '30',
          scope: 'global',
        },
      ],
    },
    {
      kind: 'turn_memory_answer',
      turnIndex: 8,
      answer: { kind: 'fact_values', requiredValues: ['45'], forbiddenValues: ['30'] },
    },
    {
      kind: 'turn_native_invocation_count',
      turnIndex: 6,
      toolName: 'calendar_update_event',
      expectedCount: 0,
    },
    {
      kind: 'memory_fact',
      subject: 'user',
      predicate: 'default_meeting_duration_minutes',
      value: '45',
      scope: 'global',
    },
    {
      kind: 'memory_fact_absent',
      subject: 'user',
      predicate: 'default_meeting_duration_minutes',
      value: '30',
      scope: 'global',
    },
    { kind: 'native_fixture_state', path: 'calendar.createdEventCount', expectedValue: '1' },
    { kind: 'native_fixture_state', path: 'calendar.updatedEventCount', expectedValue: '0' },
    {
      kind: 'native_fixture_state',
      path: 'calendar.lastCreatedEventId',
      expectedValue: 'e2e-event-1',
    },
    {
      kind: 'native_fixture_state',
      path: 'calendar.lastCreatedTitle',
      expectedValue: CALENDAR_EVENT_TITLE,
    },
    {
      kind: 'native_fixture_state',
      path: 'calendar.lastCreatedStartDate',
      expectedValue: '2026-07-16T14:00:00.000Z',
    },
    {
      kind: 'native_fixture_state',
      path: 'calendar.lastCreatedEndDate',
      expectedValue: '2026-07-16T14:45:00.000Z',
    },
    {
      kind: 'native_fixture_state',
      path: 'calendar.lastCreatedDurationMinutes',
      expectedValue: '45',
    },
    {
      kind: 'workspace_file',
      path: 'artifacts/week-plan.txt',
      contains: RECOVERED_WEEK_PLAN,
    },
    {
      kind: 'file_hash',
      path: 'artifacts/week-plan.txt',
      expectedHash: RECOVERED_WEEK_PLAN_SHA256,
    },
    { kind: 'ingestion_job_checkpointed', minCount: 9 },
    { kind: 'memory_episode_count', min: 9 },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['organic-mobile-assistant-continuity'],
    },
  ],
};

export const E2E_ORGANIC_SCENARIOS: ReadonlyArray<E2EScenario> = [
  ORGANIC_MOBILE_ASSISTANT_CONTINUITY_SCENARIO,
];
