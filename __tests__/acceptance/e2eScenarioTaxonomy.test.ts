// ---------------------------------------------------------------------------
// E2E scenario taxonomy — result-driven benchmark contracts
// ---------------------------------------------------------------------------

import {
  DELEGATION_E2E_SCENARIOS,
  E2E_AGENT_SCENARIOS,
} from '../../src/acceptance/e2eAgent/scenarios';
import type { E2ERubric, E2EScenario, E2EUserTurn } from '../../src/acceptance/e2eAgent/types';

const ALL_SCENARIOS: ReadonlyArray<E2EScenario> = [
  ...E2E_AGENT_SCENARIOS,
  ...DELEGATION_E2E_SCENARIOS,
];

const REMOVED_TOOL_TRAJECTORY_RUBRICS = new Set<string>([
  'tool_called',
  'tool_sequence',
  'tool_call_max',
  'first_turn_tool_called',
  'graph_session_tools',
  'json_field',
]);

function scenarioRecord(scenario: E2EScenario): Record<string, unknown> {
  return scenario as unknown as Record<string, unknown>;
}

function turnRecord(turn: E2EUserTurn): Record<string, unknown> {
  return turn as unknown as Record<string, unknown>;
}

const LONG_RUN_DIRECT_SCENARIO_IDS = [
  'direct-locomo-temporal-conversation-memory',
  'direct-beam-long-dialogue-multi-probe',
  'direct-longmemeval-v2-experience-runbook',
  'direct-mobileworld-long-horizon-personalization',
] as const;

describe('E2E scenario taxonomy', () => {
  it('covers all registered scenarios without duplicate ids', () => {
    expect(ALL_SCENARIOS.length).toBeGreaterThanOrEqual(51);
    expect(new Set(ALL_SCENARIOS.map((scenario) => scenario.id)).size).toBe(ALL_SCENARIOS.length);
  });

  it('does not declare scenario-level or turn-level tool selections', () => {
    for (const scenario of ALL_SCENARIOS) {
      expect(scenarioRecord(scenario)).not.toHaveProperty('allowedTools');
      for (const turn of scenario.userTurns ?? []) {
        expect(turnRecord(turn)).not.toHaveProperty('allowedTools');
      }
    }
  });

  it('uses result-driven rubrics instead of prescribed tool trajectories', () => {
    for (const scenario of ALL_SCENARIOS) {
      for (const rubric of scenario.rubrics) {
        expect(REMOVED_TOOL_TRAJECTORY_RUBRICS.has((rubric as E2ERubric).kind)).toBe(false);
      }
    }
  });

  it('does not declare graph seeds in scenario fixtures or turns', () => {
    for (const scenario of ALL_SCENARIOS) {
      expect(scenarioRecord(scenario)).not.toHaveProperty('initialGraphGoals');
      for (const turn of scenario.userTurns ?? []) {
        expect(turnRecord(turn)).not.toHaveProperty('graphGoals');
      }
    }
  });

  it('keeps long-run direct shards multi-turn and structurally scored', () => {
    for (const scenarioId of LONG_RUN_DIRECT_SCENARIO_IDS) {
      const scenario = ALL_SCENARIOS.find((entry) => entry.id === scenarioId);
      expect(scenario).toBeDefined();
      expect(scenario!.userTurns?.length ?? 0).toBeGreaterThanOrEqual(5);
      expect(scenario!.rubrics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'min_user_turns' }),
          expect.objectContaining({ kind: 'graph_terminal_success' }),
          expect.objectContaining({ kind: 'token_budget' }),
        ]),
      );
      expect(scenario!.rubrics.some((rubric) => rubric.kind === 'memory_fact')).toBe(true);
      expect(scenarioRecord(scenario!)).not.toHaveProperty('allowedTools');
      for (const turn of scenario!.userTurns ?? []) {
        expect(turnRecord(turn)).not.toHaveProperty('allowedTools');
      }
    }
  });
});
