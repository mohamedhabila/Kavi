import { E2E_LONGITUDINAL_SCENARIOS } from '../../src/acceptance/e2eAgent/scenariosLongitudinal';
import { E2E_SCENARIO_TOKEN_BUDGETS } from '../../src/acceptance/e2eAgent/thresholds';
import type { E2ERubric, E2EScenario } from '../../src/acceptance/e2eAgent/types';

const EXPECTED_SCENARIO_IDS = [
  'profile-correction-chitchat',
  'preference-to-calendar-action',
  'agent-outcome-to-chitchat',
  'failure-gotcha-reuse',
  'relaunch-profile-continuity',
] as const;

function requireScenario(id: (typeof EXPECTED_SCENARIO_IDS)[number]): E2EScenario {
  const scenario = E2E_LONGITUDINAL_SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`Missing longitudinal scenario ${id}.`);
  return scenario;
}

function rubricsForTurn(scenario: E2EScenario, turnIndex: number): ReadonlyArray<E2ERubric> {
  return scenario.rubrics.filter(
    (rubric) => 'turnIndex' in rubric && rubric.turnIndex === turnIndex,
  );
}

describe('E2E longitudinal product scenarios', () => {
  it('contains exactly the five approved product-real flows', () => {
    expect(E2E_LONGITUDINAL_SCENARIOS.map((scenario) => scenario.id)).toEqual(
      EXPECTED_SCENARIO_IDS,
    );
    for (const scenario of E2E_LONGITUDINAL_SCENARIOS) {
      expect(scenario.contentClass).toBe('synthetic_public');
      expect(scenario.userTurns).toHaveLength(2);
      expect(scenario.rubrics).toContainEqual({ kind: 'min_user_turns', min: 2 });
      expect(scenario.rubrics).toContainEqual({
        kind: 'token_budget',
        maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS[scenario.id],
      });
      expect(scenario as unknown as Record<string, unknown>).not.toHaveProperty('allowedTools');
    }
  });

  it('attributes execution, final response, and agent run completion per turn', () => {
    for (const scenario of E2E_LONGITUDINAL_SCENARIOS) {
      scenario.userTurns!.forEach((turn, turnIndex) => {
        expect(turn as unknown as Record<string, unknown>).not.toHaveProperty('route');
        expect(rubricsForTurn(scenario, turnIndex)).toEqual(
          expect.arrayContaining([
            {
              kind: 'turn_completion',
              turnIndex,
              field: 'execution',
              expected: true,
            },
            {
              kind: 'turn_completion',
              turnIndex,
              field: 'final_response',
              expected: true,
            },
            {
              kind: 'turn_completion',
              turnIndex,
              field: 'agent_run',
              expected: true,
            },
          ]),
        );
      });
    }
  });

  it('proves preference application with exact calendar timing and duration state', () => {
    const scenario = requireScenario('preference-to-calendar-action');
    expect(scenario.rubrics).toEqual(
      expect.arrayContaining([
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
          path: 'calendar.lastCreatedDurationMinutes',
          expectedValue: '45',
        },
      ]),
    );
  });

  it('scores corrected memory, verified outcomes, and the reusable failure constraint', () => {
    expect(requireScenario('profile-correction-chitchat').rubrics).toEqual(
      expect.arrayContaining([
        { kind: 'memory_item', contains: ['profile-owner', 'Utrecht'] },
        {
          kind: 'memory_item_absent',
          contains: ['profile-owner', 'Rotterdam'],
          excludes: ['Utrecht'],
        },
      ]),
    );
    expect(requireScenario('agent-outcome-to-chitchat').rubrics).toEqual(
      expect.arrayContaining([
        {
          kind: 'workspace_file',
          path: 'artifacts/project-status.txt',
          contains: 'OUTCOME-CONTINUITY-E2E-42',
        },
        { kind: 'memory_turns_indexed', min: 2 },
        {
          kind: 'turn_final_response_token',
          turnIndex: 1,
          token: 'OUTCOME-CONTINUITY-E2E-42',
        },
      ]),
    );
    expect(requireScenario('failure-gotcha-reuse').rubrics).toEqual(
      expect.arrayContaining([
        { kind: 'memory_item', contains: ['mobile-release-workflow', '.approved.txt'] },
        {
          kind: 'workspace_file',
          path: 'artifacts/release-candidate.approved.txt',
          contains: 'RELEASE-CANDIDATE-E2E-42',
        },
        { kind: 'workspace_file_absent', path: 'artifacts/release-candidate.txt' },
      ]),
    );
  });

  it('keeps the failure artifact directory, base name, suffix, and scorer aligned', () => {
    const scenario = requireScenario('failure-gotcha-reuse');
    const visibleTask = scenario.userTurns?.map((turn) => turn.content).join('\n') ?? '';

    expect(visibleTask).toContain('artifacts/');
    expect(visibleTask).toContain('release-candidate');
    expect(scenario.initialWorkspaceFiles?.[0]?.content).toContain('.approved.txt');
    expect(scenario.rubrics).toEqual(
      expect.arrayContaining([
        {
          kind: 'workspace_file',
          path: 'artifacts/release-candidate.approved.txt',
          contains: 'RELEASE-CANDIDATE-E2E-42',
        },
        { kind: 'workspace_file_absent', path: 'artifacts/release-candidate.txt' },
      ]),
    );
  });

  it('uses the real app relaunch boundary only between profile learning and use', () => {
    const scenario = requireScenario('relaunch-profile-continuity');
    expect(scenario.userTurns?.map((turn) => turn.lifecycleBefore ?? null)).toEqual([
      null,
      'app_relaunch',
    ]);
    expect(scenario.rubrics).toContainEqual({
      kind: 'turn_lifecycle_boundary',
      turnIndex: 1,
      boundary: 'app_relaunch',
    });
    expect(scenario.rubrics).toContainEqual({
      kind: 'memory_item',
      contains: ['profile-owner', 'bicycle'],
    });
  });
});
