// ---------------------------------------------------------------------------
// Kavi — E2E benchmark native mobile scenarios
// ---------------------------------------------------------------------------
import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2EScenario } from './types';

/** tau-bench-adapted: goal success criterion backed by native fixture state. */
export const BENCH_GOAL_JSON_FIELD_CRITERION: E2EScenario = {
  id: 'bench-goal-json-field-criterion',
  conversationId: 'e2e-bench-goal-json',
  prompt:
    'Verify that the default calendar allows modifications, record that evidence for goal `calendar-verify`, then finish once the criterion is satisfied.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'calendar.allowsModifications',
      expectedValue: 'true',
    },
    { kind: 'goal_status', goalId: 'calendar-verify', status: 'completed' },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-goal-json-field-criterion'],
    },
  ],
};

/** τ-bench-adapted: multi-field native JSON chain. */
export const BENCH_TAU_NATIVE_JSON_OUTCOME: E2EScenario = {
  id: 'bench-tau-native-json-outcome',
  conversationId: 'e2e-bench-tau-json',
  prompt:
    'Verify the calendar configuration and events from 2026-06-10T00:00:00Z to 2026-06-11T00:00:00Z.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'calendar.listed',
      expectedValue: 'true',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-tau-native-json-outcome'],
    },
  ],
};

/** τ-bench-adapted: chained calendar JSON validators (list → events). */
export const BENCH_TAU_CALENDAR_EVENTS_CHAIN: E2EScenario = {
  id: 'bench-tau-calendar-events-chain',
  conversationId: 'e2e-bench-tau-chain',
  prompt:
    'Verify that the calendar allows modifications and inspect events from 2026-06-10T00:00:00Z to 2026-06-11T00:00:00Z.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'calendar.listed',
      expectedValue: 'true',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-tau-calendar-events-chain'],
    },
  ],
};

/** AndroidWorld/tau-adapted: native calendar creation then update evidence. */
export const BENCH_ANDROIDWORLD_CALENDAR_MUTATION: E2EScenario = {
  id: 'bench-androidworld-calendar-mutation',
  conversationId: 'e2e-bench-androidworld-calendar',
  prompt:
    'Create a calendar event titled `E2E Native Review` from 2026-06-10T09:00:00Z to 2026-06-10T10:00:00Z, then update the created event once by adding note `Updated by E2E`, and verify the calendar state.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'calendar.createdEventCount',
      expectedValue: '1',
    },
    {
      kind: 'native_fixture_state',
      path: 'calendar.updatedEventCount',
      expectedValue: '1',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-androidworld-calendar-mutation'],
    },
  ],
};

/** AndroidWorld-adapted: permission matrix + denied device action state reward. */
export const BENCH_ANDROIDWORLD_PERMISSION_DENIAL: E2EScenario = {
  id: 'bench-androidworld-permission-denial',
  conversationId: 'e2e-bench-androidworld-permission',
  prompt:
    'Check device permission state, handle denied location access, and open maps for query `E2E Station`.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'permissions.location',
      expectedValue: 'denied',
    },
    {
      kind: 'native_fixture_state',
      path: 'permissions.mediaLibrary',
      expectedValue: 'revoked',
    },
    {
      kind: 'native_fixture_state',
      path: 'maps.opened',
      expectedValue: 'true',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-androidworld-permission-denial'],
    },
  ],
};

/** MobileAgentBench-adapted: contact lookup to communication composer. */
export const BENCH_MOBILEAGENT_CONTACT_MESSAGE_DRAFT: E2EScenario = {
  id: 'bench-mobileagent-contact-message-draft',
  conversationId: 'e2e-bench-mobileagent-contact-message',
  prompt:
    'Find Avery in contacts and prepare a one-recipient SMS draft with message `E2E-MOBILE-MESSAGE`.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'contacts.resultCount',
      expectedValue: '1',
    },
    {
      kind: 'native_fixture_state',
      path: 'sms.opened',
      expectedValue: 'true',
    },
    {
      kind: 'native_fixture_state',
      path: 'sms.recipientCount',
      expectedValue: '1',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-mobileagent-contact-message-draft'],
    },
  ],
};

/** MobileWorld-adapted: mobile tool discovery before contact/message execution. */
export const BENCH_MOBILEWORLD_DISCOVER_CONTACT_MESSAGE: E2EScenario = {
  id: 'bench-mobileworld-discover-contact-message',
  conversationId: 'e2e-bench-mobileworld-discover-contact',
  prompt: 'Discover and then use mobile communication tools.',
  userTurns: [
    {
      content:
        'Find the right mobile communication capability for looking up a contact and preparing a message.',
    },
    {
      content:
        'Find Avery in contacts and prepare a one-recipient SMS draft with message `E2E-MOBILEWORLD-MESSAGE`.',
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 2 },
    {
      kind: 'native_fixture_state',
      path: 'contacts.resultCount',
      expectedValue: '1',
    },
    {
      kind: 'native_fixture_state',
      path: 'sms.opened',
      expectedValue: 'true',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-mobileworld-discover-contact-message'],
    },
  ],
};

/** AndroidWorld-adapted: stateful clipboard, share sheet, and notification evidence. */
export const BENCH_ANDROIDWORLD_CLIPBOARD_SHARE_NOTIFY: E2EScenario = {
  id: 'bench-androidworld-clipboard-share-notify',
  conversationId: 'e2e-bench-androidworld-state',
  prompt:
    'Put `E2E-CLIPBOARD-42` on the clipboard and verify it, open a share sheet for `E2E-SHARE-42`, then schedule a notification for 60 seconds and cancel it.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'clipboard.text',
      expectedValue: 'E2E-CLIPBOARD-42',
    },
    {
      kind: 'native_fixture_state',
      path: 'share.opened',
      expectedValue: 'true',
    },
    {
      kind: 'native_fixture_state',
      path: 'notification.scheduled',
      expectedValue: 'true',
    },
    {
      kind: 'native_fixture_state',
      path: 'notification.cancelled',
      expectedValue: 'true',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-androidworld-clipboard-share-notify'],
    },
  ],
};

/** MobileAgentBench-adapted: media retrieval and screen/camera state evidence. */
export const BENCH_MOBILEAGENT_MEDIA_STATE: E2EScenario = {
  id: 'bench-mobileagent-media-state',
  conversationId: 'e2e-bench-mobileagent-media',
  prompt:
    'Inspect the latest two photos, capture the screen as PNG, and record a 3-second camera clip.',
  rubrics: [
    {
      kind: 'native_fixture_state',
      path: 'media.photoCount',
      expectedValue: '2',
    },
    {
      kind: 'native_fixture_state',
      path: 'media.screenStatus',
      expectedValue: 'captured',
    },
    {
      kind: 'native_fixture_state',
      path: 'media.cameraStatus',
      expectedValue: 'recorded',
    },
    {
      kind: 'native_fixture_state',
      path: 'media.cameraDuration',
      expectedValue: '3',
    },
    { kind: 'graph_terminal_success' },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['bench-mobileagent-media-state'],
    },
  ],
};
