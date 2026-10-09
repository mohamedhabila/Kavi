// ---------------------------------------------------------------------------
// Kavi — E2E steering scenarios
// ---------------------------------------------------------------------------
// A person adds to a request while the assistant is still working on it. The
// message must reach the running work at its next step (not wait for a new turn),
// and what it said must be remembered like anything said in the request.
// ---------------------------------------------------------------------------
import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2EScenario } from './types';

const STEER_SUBJECT = 'e2e-steer-sister';
const STEER_PREDICATE = 'home_city';
const STEER_VALUE = 'PORTO-E2E-7';

/** Steer a reading task with a fact to remember, then recall it in a new conversation. */
export const STEER_MIDRUN_MEMORY_SCENARIO: E2EScenario = {
  id: 'steer-midrun-memory',
  conversationId: 'e2e-steer-midrun-memory',
  contentClass: 'synthetic_public',
  execution: { initialMode: 'agentic', route: 'forced_agentic' },
  threadTitle: 'Trip planning',
  prompt: 'Add a fact to remember while the assistant is still working, then recall it later.',
  initialWorkspaceFiles: [
    { path: 'trips/lisbon.md', content: 'Lisbon weekend: train 48 EUR, hotel 210 EUR.' },
    { path: 'trips/porto.md', content: 'Porto weekend: train 36 EUR, hotel 180 EUR.' },
  ],
  userTurns: [
    {
      content:
        'Read `trips/lisbon.md` and `trips/porto.md`, then tell me which weekend costs less in total.',
      steer: {
        afterToolResults: 1,
        content: `Also remember that subject \`${STEER_SUBJECT}\` has \`${STEER_PREDICATE}\` value \`${STEER_VALUE}\`.`,
      },
    },
    {
      lifecycleBefore: 'new_conversation',
      content: `What is the \`${STEER_PREDICATE}\` of \`${STEER_SUBJECT}\`?`,
    },
  ],
  rubrics: [
    { kind: 'min_user_turns', min: 2 },
    { kind: 'graph_audit_observed', auditType: 'STEERING_DELIVERED' },
    {
      kind: 'memory_fact',
      subject: STEER_SUBJECT,
      predicate: STEER_PREDICATE,
      value: STEER_VALUE,
      scope: 'global',
    },
    { kind: 'turn_final_response_token', turnIndex: 0, token: 'Porto' },
    { kind: 'turn_final_response_token', turnIndex: 1, token: STEER_VALUE },
    {
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS['steer-midrun-memory'],
    },
  ],
};

export const E2E_STEERING_SCENARIOS: ReadonlyArray<E2EScenario> = [STEER_MIDRUN_MEMORY_SCENARIO];
