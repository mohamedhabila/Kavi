import { ORGANIC_MOBILE_ASSISTANT_CONTINUITY_SCENARIO } from '../../src/acceptance/e2eAgent/scenariosOrganic';
import { buildE2EBenchmarkManifest } from '../../src/acceptance/e2eAgent/e2eBenchmarkManifest';
import { lookupE2EScenarioBenchmarkMeta } from '../../src/acceptance/e2eAgent/e2eBenchmarkRegistry';
import {
  E2E_PROVISIONAL_SCENARIO_TOKEN_BUDGET_IDS,
  E2E_SCENARIO_TOKEN_BUDGETS,
} from '../../src/acceptance/e2eAgent/thresholds';

describe('organic mobile-assistant continuity scenario', () => {
  const scenario = ORGANIC_MOBILE_ASSISTANT_CONTINUITY_SCENARIO;

  it('keeps one nine-turn conversation on production routing while the user changes modes', () => {
    expect(scenario.execution).toEqual({ initialMode: 'chitchat', route: 'production_auto' });
    expect(scenario.userTurns).toHaveLength(9);
    expect(
      scenario.userTurns?.every((turn) => (turn.route ?? 'production_auto') === 'production_auto'),
    ).toBe(true);
    expect(scenario.userTurns?.map((turn) => turn.selectedMode ?? null)).toEqual([
      null,
      null,
      null,
      'agentic',
      'chitchat',
      null,
      'agentic',
      'agentic',
      'chitchat',
    ]);
    expect(scenario.userTurns?.map((turn) => turn.lifecycleBefore ?? null)).toEqual([
      null,
      null,
      null,
      null,
      null,
      'app_relaunch',
      null,
      null,
      'app_relaunch',
    ]);
  });

  it('attributes every completed turn to production_auto and its persisted selected mode', () => {
    const expectedModes = [
      'chitchat',
      'chitchat',
      'chitchat',
      'agentic',
      'chitchat',
      'chitchat',
      'agentic',
      'agentic',
      'chitchat',
    ] as const;

    expectedModes.forEach((mode, turnIndex) => {
      expect(scenario.rubrics).toEqual(
        expect.arrayContaining([
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
        ]),
      );
    });
  });

  it('scores corrected memory, one safe calendar mutation, and exact partial-work recovery', () => {
    expect(scenario.rubrics).toEqual(
      expect.arrayContaining([
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
          expectedValue: 'Organic design review',
        },
        {
          kind: 'native_fixture_state',
          path: 'calendar.lastCreatedDurationMinutes',
          expectedValue: '45',
        },
        {
          kind: 'workspace_file',
          path: 'artifacts/week-plan.txt',
          contains: 'ORGANIC-WEEK-PLAN-RECOVERED-E2E-77',
        },
        {
          kind: 'file_hash',
          path: 'artifacts/week-plan.txt',
          expectedHash: '2077bc75ba1bae2c0f7f3512cd0781d24c06b38b0fe980f90c4365a18f3fc7d9',
        },
      ]),
    );
    expect(scenario.initialWorkspaceFiles).toEqual(
      expect.arrayContaining([
        { path: 'artifacts/week-plan.txt', content: 'PARTIAL-WEEK-PLAN-E2E-77' },
      ]),
    );
  });

  it('scores natural retrieval participation and a safe structured clarification', () => {
    const promptText = scenario.userTurns?.map((turn) => turn.content).join('\n') ?? '';
    expect(promptText).not.toContain('profile-owner');
    expect(promptText).not.toContain('default_meeting_duration_minutes');
    expect(promptText).not.toContain('subject `');

    for (const turnIndex of [3, 5, 8]) {
      expect(scenario.rubrics).toContainEqual({
        kind: 'turn_memory_selection',
        turnIndex,
        requiredWrites: [
          {
            turnIndex: 2,
            subject: 'user',
            value: '45 minutes',
            status: 'created',
          },
        ],
        supersededWrites: [
          {
            turnIndex: 0,
            subject: 'user',
            value: '30 minutes',
            status: 'created',
          },
        ],
      });
    }
    for (const turnIndex of [5, 8]) {
      expect(scenario.rubrics).toContainEqual({
        kind: 'turn_memory_answer',
        turnIndex,
        answer: { kind: 'fact_values', requiredValues: ['45'] },
      });
    }
    expect(scenario.rubrics).toContainEqual({
      kind: 'turn_clarification',
      turnIndex: 6,
      requiredMissingInformation: [{ semanticRole: 'time' }],
    });
    expect(scenario.rubrics).toContainEqual({
      kind: 'turn_native_invocation_count',
      turnIndex: 6,
      toolName: 'calendar_update_event',
      expectedCount: 0,
    });
    expect(scenario.userTurns?.[6]?.content).toContain('Move "Organic design review"');
    expect(scenario.userTurns?.[6]?.content).toContain('ask me for it');
  });

  it('uses end-state and stage evidence without prescribing a tool trajectory', () => {
    expect(scenario.rubrics).toContainEqual({ kind: 'min_user_turns', min: 9 });
    expect(scenario.rubrics).toContainEqual({ kind: 'ingestion_job_checkpointed', minCount: 9 });
    expect(scenario.rubrics).toContainEqual({ kind: 'memory_episode_count', min: 9 });
    expect(scenario.rubrics).toContainEqual({ kind: 'graph_terminal_success' });
    expect(scenario.rubrics).toContainEqual({
      kind: 'token_budget',
      maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS[scenario.id],
    });
    expect(E2E_PROVISIONAL_SCENARIO_TOKEN_BUDGET_IDS.has(scenario.id)).toBe(true);
    expect(scenario as unknown as Record<string, unknown>).not.toHaveProperty('allowedTools');
    expect(
      scenario.userTurns?.some(
        (turn) => 'allowedTools' in (turn as unknown as Record<string, unknown>),
      ),
    ).toBe(false);
  });

  it('keeps honest benchmark attribution and provisional resource evidence', () => {
    expect(lookupE2EScenarioBenchmarkMeta(scenario.id).benchmarkFamilies).toEqual(['kavi-core']);
    expect(buildE2EBenchmarkManifest(scenario).tokenBudget).toMatchObject({
      evidenceStatus: 'provisional',
      maxTotalTokens: 240_000,
    });
  });
});
