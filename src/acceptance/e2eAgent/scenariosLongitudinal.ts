import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2ERubric, E2EScenario } from './types';

function completedTurnRubrics(turnIndex: number): E2ERubric[] {
  return [
    { kind: 'turn_completion', turnIndex, field: 'execution', expected: true },
    { kind: 'turn_completion', turnIndex, field: 'final_response', expected: true },
    { kind: 'turn_completion', turnIndex, field: 'agent_run', expected: true },
  ];
}

const OUTCOME_CONTINUITY_TOKEN = 'OUTCOME-CONTINUITY-E2E-42';
const FAILURE_ARTIFACT_DIRECTORY = 'artifacts';
const FAILURE_ARTIFACT_BASE_NAME = 'release-candidate';
const FAILURE_ARTIFACT_SUFFIX = '.approved.txt';
const FAILURE_ARTIFACT_CONTENT = 'RELEASE-CANDIDATE-E2E-42';
const FAILURE_ARTIFACT_PATH = `${FAILURE_ARTIFACT_DIRECTORY}/${FAILURE_ARTIFACT_BASE_NAME}${FAILURE_ARTIFACT_SUFFIX}`;
const FAILURE_INVALID_ARTIFACT_PATH = `${FAILURE_ARTIFACT_DIRECTORY}/${FAILURE_ARTIFACT_BASE_NAME}.txt`;

export const E2E_LONGITUDINAL_SCENARIOS: ReadonlyArray<E2EScenario> = [
  {
    id: 'profile-correction-chitchat',
    conversationId: 'e2e-longitudinal-profile-correction',
    contentClass: 'synthetic_public',
    threadTitle: 'Profile details',
    prompt: 'Correct a durable profile detail in casual conversation.',
    userTurns: [
      {
        content:
          'Please remember this profile detail exactly: subject `profile-owner` has `home_city` value `Rotterdam`.',
      },
      {
        content:
          'Correction for my profile: subject `profile-owner` now has `home_city` value `Utrecht`, replacing Rotterdam. Use the corrected city going forward.',
      },
    ],
    rubrics: [
      { kind: 'min_user_turns', min: 2 },
      ...completedTurnRubrics(0),
      ...completedTurnRubrics(1),
      { kind: 'memory_item', contains: ['profile-owner', 'Utrecht'] },
      {
        kind: 'memory_item_absent',
        contains: ['profile-owner', 'Rotterdam'],
        excludes: ['Utrecht'],
      },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['profile-correction-chitchat'],
      },
    ],
  },
  {
    id: 'preference-to-calendar-action',
    conversationId: 'e2e-longitudinal-calendar-preference',
    contentClass: 'synthetic_public',
    threadTitle: 'Meeting preferences',
    prompt: 'Apply a preference learned in conversation to a later calendar action.',
    userTurns: [
      {
        content:
          'For future scheduling, remember exactly that subject `profile-owner` has `default_meeting_duration_minutes` value `45`.',
      },
      {
        content:
          'Schedule one event titled `Design review E2E` in my modifiable calendar starting at `2026-07-15T14:00:00Z`. Apply my remembered default meeting duration and complete the action without asking me to repeat it.',
      },
    ],
    rubrics: [
      { kind: 'min_user_turns', min: 2 },
      ...completedTurnRubrics(0),
      ...completedTurnRubrics(1),
      { kind: 'memory_item', contains: ['profile-owner', '45'] },
      {
        kind: 'native_fixture_state',
        path: 'calendar.createdEventCount',
        expectedValue: '1',
      },
      {
        kind: 'native_fixture_state',
        path: 'calendar.lastCreatedStartDate',
        expectedValue: '2026-07-15T14:00:00.000Z',
      },
      {
        kind: 'native_fixture_state',
        path: 'calendar.lastCreatedEndDate',
        expectedValue: '2026-07-15T14:45:00.000Z',
      },
      {
        kind: 'native_fixture_state',
        path: 'calendar.lastCreatedDurationMinutes',
        expectedValue: '45',
      },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['preference-to-calendar-action'],
      },
    ],
  },
  {
    id: 'agent-outcome-to-chitchat',
    conversationId: 'e2e-longitudinal-outcome-continuity',
    contentClass: 'synthetic_public',
    threadTitle: 'Project outcome continuity',
    prompt: 'Carry a verified agent outcome into the next conversational turn.',
    userTurns: [
      {
        content: `Record the completed project outcome by writing \`artifacts/project-status.txt\` with exact content \`${OUTCOME_CONTINUITY_TOKEN}\`.`,
      },
      {
        content: 'In our ongoing conversation, what project outcome did you just complete for me?',
      },
    ],
    rubrics: [
      { kind: 'min_user_turns', min: 2 },
      ...completedTurnRubrics(0),
      ...completedTurnRubrics(1),
      {
        kind: 'workspace_file',
        path: 'artifacts/project-status.txt',
        contains: OUTCOME_CONTINUITY_TOKEN,
      },
      { kind: 'memory_turns_indexed', min: 2 },
      {
        kind: 'turn_final_response_token',
        turnIndex: 1,
        token: OUTCOME_CONTINUITY_TOKEN,
      },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['agent-outcome-to-chitchat'],
      },
    ],
  },
  {
    id: 'failure-gotcha-reuse',
    conversationId: 'e2e-longitudinal-failure-gotcha',
    contentClass: 'synthetic_public',
    threadTitle: 'Release workflow recovery',
    prompt:
      'Learn a reusable workflow constraint from a failed release attempt and apply it later.',
    initialWorkspaceFiles: [
      {
        path: 'policies/release-artifact-rules.txt',
        content: `The previous release failed validation because bare .txt candidate names are invalid. Release candidates must end in ${FAILURE_ARTIFACT_SUFFIX}. Durable fact labels: subject mobile-release-workflow, predicate required_artifact_suffix, value ${FAILURE_ARTIFACT_SUFFIX}.`,
      },
    ],
    userTurns: [
      {
        content:
          'Inspect `policies/release-artifact-rules.txt` and retain its reusable release constraint using the exact durable fact labels it provides. This turn is only for learning the gotcha; do not create a release artifact yet.',
      },
      {
        content: `Prepare the release candidate now inside \`${FAILURE_ARTIFACT_DIRECTORY}/\`. Its base name is \`${FAILURE_ARTIFACT_BASE_NAME}\` and its exact content must be \`${FAILURE_ARTIFACT_CONTENT}\`. Apply the remembered workflow constraint and leave no invalid alternative.`,
      },
    ],
    rubrics: [
      { kind: 'min_user_turns', min: 2 },
      ...completedTurnRubrics(0),
      ...completedTurnRubrics(1),
      { kind: 'memory_item', contains: ['mobile-release-workflow', FAILURE_ARTIFACT_SUFFIX] },
      {
        kind: 'workspace_file',
        path: FAILURE_ARTIFACT_PATH,
        contains: FAILURE_ARTIFACT_CONTENT,
      },
      { kind: 'workspace_file_absent', path: FAILURE_INVALID_ARTIFACT_PATH },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['failure-gotcha-reuse'],
      },
    ],
  },
  {
    id: 'relaunch-profile-continuity',
    conversationId: 'e2e-longitudinal-relaunch-profile',
    contentClass: 'synthetic_public',
    threadTitle: 'Profile continuity after relaunch',
    prompt: 'Preserve a learned profile detail across a real persisted app relaunch.',
    userTurns: [
      {
        content:
          'Remember this profile detail exactly: subject `profile-owner` has `commute_mode` value `bicycle`.',
      },
      {
        lifecycleBefore: 'app_relaunch',
        content:
          'The app has reopened. Which commute mode should you continue using for my profile?',
      },
    ],
    rubrics: [
      { kind: 'min_user_turns', min: 2 },
      ...completedTurnRubrics(0),
      ...completedTurnRubrics(1),
      { kind: 'turn_lifecycle_boundary', turnIndex: 1, boundary: 'app_relaunch' },
      { kind: 'memory_item', contains: ['profile-owner', 'bicycle'] },
      {
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['relaunch-profile-continuity'],
      },
    ],
  },
];
