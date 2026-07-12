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

  it('attributes route, execution, final response, agent run, and memory receipt per turn', () => {
    const expectedRoutes = [
      ['chitchat', 'chitchat'],
      ['chitchat', 'agentic'],
      ['agentic', 'chitchat'],
      ['agentic', 'agentic'],
      ['chitchat', 'chitchat'],
    ] as const;

    E2E_LONGITUDINAL_SCENARIOS.forEach((scenario, scenarioIndex) => {
      scenario.userTurns!.forEach((turn, turnIndex) => {
        const mode = expectedRoutes[scenarioIndex]![turnIndex]!;
        const directive = mode === 'agentic' ? 'forced_agentic' : 'forced_chitchat';
        const stageRubrics = rubricsForTurn(scenario, turnIndex);
        expect(turn.route).toBe(directive);
        expect(stageRubrics).toContainEqual({
          kind: 'turn_route',
          turnIndex,
          directive,
          mode,
        });
        expect(stageRubrics).toEqual(
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
              expected: mode === 'agentic' ? true : null,
            },
            { kind: 'turn_memory_receipt', turnIndex },
          ]),
        );
      });
    });
  });

  it('proves preference application with exact calendar timing and duration state', () => {
    const scenario = requireScenario('preference-to-calendar-action');
    expect(scenario.rubrics).toEqual(
      expect.arrayContaining([
        {
          kind: 'memory_fact',
          subject: 'profile-owner',
          predicate: 'default_meeting_duration_minutes',
          value: '45',
          scope: 'global',
        },
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
        {
          kind: 'memory_fact',
          subject: 'profile-owner',
          predicate: 'home_city',
          value: 'Utrecht',
          scope: 'global',
        },
        {
          kind: 'memory_fact_absent',
          subject: 'profile-owner',
          predicate: 'home_city',
          value: 'Rotterdam',
          scope: 'global',
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
        { kind: 'ingestion_job_checkpointed', minCount: 2 },
        { kind: 'memory_episode_count', min: 2 },
        {
          kind: 'turn_final_response_token',
          turnIndex: 1,
          token: 'OUTCOME-CONTINUITY-E2E-42',
        },
      ]),
    );
    expect(requireScenario('failure-gotcha-reuse').rubrics).toEqual(
      expect.arrayContaining([
        {
          kind: 'memory_fact',
          subject: 'mobile-release-workflow',
          predicate: 'required_artifact_suffix',
          value: '.approved.txt',
          scope: 'project',
        },
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
      kind: 'memory_fact',
      subject: 'profile-owner',
      predicate: 'commute_mode',
      value: 'bicycle',
      scope: 'global',
    });
  });
});
