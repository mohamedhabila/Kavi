// ---------------------------------------------------------------------------
// E2E structural scenario rubrics — mocked orchestrator + memory finalize
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import type { AgentRunControlGraphState } from '../../src/types/agentRun';
import { E2E_BENCHMARK_SCENARIOS } from '../../src/acceptance/e2eAgent/benchmarkScenarios';
import { E2E_DIRECT_BENCHMARK_SCENARIOS } from '../../src/acceptance/e2eAgent/directBenchmarkScenarios';
import { E2E_AGENT_SCENARIOS } from '../../src/acceptance/e2eAgent/scenarios';
import {
  E2E_CALENDAR_MUTATION_SUCCESS_CRITERIA,
  E2E_CALENDAR_VERIFY_MUTATION_SUCCESS_CRITERIA,
  E2E_CONTACT_SMS_SUCCESS_CRITERIA,
  E2E_DEVICE_STATE_SUCCESS_CRITERIA,
  E2E_MEDIA_STATE_SUCCESS_CRITERIA,
  E2E_PERMISSION_MAPS_SUCCESS_CRITERIA,
} from '../../src/acceptance/e2eAgent/scenarioToolSets';
import { createGoal } from '../../src/engine/goals/types';
import { evaluateE2EScenarioRubrics } from '../../src/acceptance/e2eAgent/rubricEvaluators';
import { runE2EScenario } from '../../src/acceptance/e2eAgent/scenarioRunner';
import {
  readE2EWorkingBlockContent,
  resetE2EMemorySandbox,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import { resetE2EWorkspaceSandbox } from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import { areGoalSuccessCriteriaSatisfied } from '../../src/engine/goals/completionEvidence';

const mockRunOrchestrator = jest.fn();

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: (...args: unknown[]) => mockRunOrchestrator(...args),
}));

jest.mock('../../src/acceptance/e2eAgent/providerConfig', () => ({
  buildE2EProvider: () => ({
    apiKey: 'test-key',
    model: 'test-model',
    baseUrl: 'https://example.com',
  }),
  isE2EAgentEvalEnabled: () => process.env.RUN_E2E_AGENT_EVAL === '1',
}));

function buildFinalizedGraphSnapshot(
  goals?: AgentRunControlGraphState['goals'],
  activeTaskId?: string,
): AgentRunControlGraphState {
  return {
    version: 1,
    status: 'finalized',
    iteration: 1,
    expectedToolCalls: [],
    observedToolResults: [],
    pendingAsyncCount: 0,
    lastModelToolNames: [],
    asyncWork: { pendingOperations: [], awaitingBackgroundWorkers: false },
    performance: {
      modelTurnCount: 1,
      modelDurationMs: 1,
      toolExecutionCount: 0,
      toolExecutionDurationMs: 0,
      lastCandidateToolCount: 0,
      lastActiveToolCount: 0,
      maxActiveToolCount: 0,
    },
    turnDirectives: {},
    audit: [],
    updatedAt: 1,
    ...(goals?.length ? { goals } : {}),
    ...(activeTaskId ? { activeTaskId } : {}),
  };
}

function expectNoInternalGraphSeeds(scenario: {
  userTurns?: ReadonlyArray<{ content: string }>;
}): void {
  expect(scenario as unknown as Record<string, unknown>).not.toHaveProperty('initialGraphGoals');
  for (const turn of scenario.userTurns ?? []) {
    expect(turn as unknown as Record<string, unknown>).not.toHaveProperty('graphGoals');
  }
}

describe('E2E gate-followup completion workflow fixture', () => {
  it('models follow-up completion without internal graph seeding or tool pins', () => {
    const scenario = E2E_AGENT_SCENARIOS.find((entry) => entry.id === 'multi-turn-gate-followup');
    expect(scenario).toBeDefined();
    expectNoInternalGraphSeeds(scenario!);
    expect(scenario!.userTurns?.[0]?.content).toContain('artifacts/e2e-follow-gate.txt');
    expect(scenario as unknown as Record<string, unknown>).not.toHaveProperty('allowedTools');
    expect(scenario!.userTurns?.[1] as unknown as Record<string, unknown>).not.toHaveProperty(
      'allowedTools',
    );
  });
});

describe('E2E thin runner fixtures', () => {
  beforeEach(() => {
    resetE2EWorkspaceSandbox();
    resetE2EMemorySandbox();
    mockRunOrchestrator.mockReset();
  });

  it('keeps all registered scenarios free of internal graph seeds and tool selections', () => {
    for (const scenario of [
      ...E2E_AGENT_SCENARIOS,
      ...E2E_BENCHMARK_SCENARIOS,
      ...E2E_DIRECT_BENCHMARK_SCENARIOS,
    ]) {
      expectNoInternalGraphSeeds(scenario);
      expect(scenario as unknown as Record<string, unknown>).not.toHaveProperty('allowedTools');
    }
  });

  it('starts without initial graph state and resumes only from emitted graph snapshots', async () => {
    const scenario = E2E_AGENT_SCENARIOS.find(
      (entry) => entry.id === 'workspace-inventory-manifest',
    );
    expect(scenario).toBeDefined();

    let invocation = 0;
    const firstGraph = buildFinalizedGraphSnapshot([
      createGoal({
        id: 'system-derived-inventory',
        title: 'system-derived-inventory',
        status: 'active',
        now: 1,
      }),
    ]);

    mockRunOrchestrator.mockImplementation(async (options, callbacks) => {
      if (invocation === 0) {
        expect(options.initialAgentControlGraphState).toBeUndefined();
      } else {
        expect(options.initialAgentControlGraphState?.goals?.[0]?.id).toBe(
          'system-derived-inventory',
        );
      }
      invocation += 1;
      callbacks.onAssistantMessage('acknowledged', []);
      callbacks.onAgentControlGraphStateChange(firstGraph);
      callbacks.onDone();
    });

    await runE2EScenario(scenario!);
    expect(mockRunOrchestrator).toHaveBeenCalledTimes(scenario!.userTurns?.length ?? 1);
  });

  it('keeps multi-turn trip artifact flow structurally tied to the target artifact path', () => {
    const scenario = E2E_AGENT_SCENARIOS.find((entry) => entry.id === 'multi-turn-trip-artifact');
    expect(scenario).toBeDefined();
    expect(scenario!.userTurns?.[0]?.content).toContain('artifacts/trip-plan.txt');
    expectNoInternalGraphSeeds(scenario!);
    expect(scenario!.rubrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'workspace_file',
          path: 'artifacts/trip-plan.txt',
          contains: 'TRIP-E2E-42',
        }),
      ]),
    );
  });
});

describe('E2E benchmark structural completion criteria', () => {
  function expectScenarioRubrics(
    scenarios: ReadonlyArray<{
      id: string;
      rubrics: ReadonlyArray<object>;
      userTurns?: ReadonlyArray<{ content: string }>;
    }>,
    scenarioId: string,
    rubrics: ReadonlyArray<object>,
  ): void {
    const scenario = scenarios.find((entry) => entry.id === scenarioId);
    expect(scenario).toBeDefined();
    expectNoInternalGraphSeeds(scenario!);
    expect(scenario!.rubrics).toEqual(
      expect.arrayContaining(rubrics.map((rubric) => expect.objectContaining(rubric))),
    );
  }

  it('uses explicit structural rubrics for benchmark native workflows', () => {
    expectScenarioRubrics(E2E_BENCHMARK_SCENARIOS, 'bench-goal-json-field-criterion', [
      { kind: 'native_fixture_state', path: 'calendar.allowsModifications' },
    ]);
    expectScenarioRubrics(E2E_BENCHMARK_SCENARIOS, 'bench-bootstrap-first-turn-goals', [
      { kind: 'workspace_file', path: 'artifacts/release.txt' },
    ]);
    expectScenarioRubrics(E2E_BENCHMARK_SCENARIOS, 'bench-androidworld-calendar-mutation', [
      { kind: 'native_fixture_state', path: 'calendar.createdEventCount' },
      { kind: 'native_fixture_state', path: 'calendar.updatedEventCount' },
    ]);
    expectScenarioRubrics(E2E_BENCHMARK_SCENARIOS, 'bench-androidworld-permission-denial', [
      { kind: 'native_fixture_state', path: 'permissions.location' },
      { kind: 'native_fixture_state', path: 'permissions.mediaLibrary' },
      { kind: 'native_fixture_state', path: 'maps.opened' },
    ]);
    expectScenarioRubrics(E2E_BENCHMARK_SCENARIOS, 'bench-mobileagent-contact-message-draft', [
      { kind: 'native_fixture_state', path: 'contacts.resultCount' },
      { kind: 'native_fixture_state', path: 'sms.opened' },
      { kind: 'native_fixture_state', path: 'sms.recipientCount' },
    ]);
    expectScenarioRubrics(E2E_BENCHMARK_SCENARIOS, 'bench-mobileworld-discover-contact-message', [
      { kind: 'native_fixture_state', path: 'contacts.resultCount' },
      { kind: 'native_fixture_state', path: 'sms.opened' },
    ]);
    expectScenarioRubrics(E2E_BENCHMARK_SCENARIOS, 'bench-knowu-personalized-contact-memory', [
      { kind: 'memory_fact', predicate: 'preferred_message_contact', value: 'Avery' },
      { kind: 'native_fixture_state', path: 'contacts.resultCount' },
      { kind: 'native_fixture_state', path: 'sms.opened' },
    ]);
    expectScenarioRubrics(E2E_BENCHMARK_SCENARIOS, 'bench-androidworld-clipboard-share-notify', [
      { kind: 'native_fixture_state', path: 'clipboard.text' },
      { kind: 'native_fixture_state', path: 'share.opened' },
      { kind: 'native_fixture_state', path: 'notification.cancelled' },
    ]);
    expectScenarioRubrics(E2E_BENCHMARK_SCENARIOS, 'bench-mobileagent-media-state', [
      { kind: 'native_fixture_state', path: 'media.photoCount' },
      { kind: 'native_fixture_state', path: 'media.screenStatus' },
      { kind: 'native_fixture_state', path: 'media.cameraStatus' },
    ]);
  });

  it('uses explicit structural rubrics for direct benchmark native workflows', () => {
    expectScenarioRubrics(E2E_DIRECT_BENCHMARK_SCENARIOS, 'direct-toolsandbox-state-dependency', [
      { kind: 'native_fixture_state', path: 'contacts.resultCount' },
      { kind: 'native_fixture_state', path: 'sms.opened' },
      { kind: 'native_fixture_state', path: 'sms.recipientCount' },
    ]);
    expectScenarioRubrics(E2E_DIRECT_BENCHMARK_SCENARIOS, 'direct-tau-user-coordination-state', [
      { kind: 'native_fixture_state', path: 'contacts.resultCount' },
      { kind: 'native_fixture_state', path: 'sms.opened' },
    ]);
    expectScenarioRubrics(
      E2E_DIRECT_BENCHMARK_SCENARIOS,
      'direct-androidworld-calendar-add-update',
      [
        { kind: 'native_fixture_state', path: 'calendar.listed' },
        { kind: 'native_fixture_state', path: 'calendar.updatedEventCount' },
      ],
    );
    expectScenarioRubrics(
      E2E_DIRECT_BENCHMARK_SCENARIOS,
      'direct-mobileworld-cross-app-contact-message',
      [
        { kind: 'native_fixture_state', path: 'calendar.listed' },
        { kind: 'native_fixture_state', path: 'contacts.resultCount' },
        { kind: 'native_fixture_state', path: 'sms.opened' },
      ],
    );
    expectScenarioRubrics(
      E2E_DIRECT_BENCHMARK_SCENARIOS,
      'direct-spabench-cross-app-device-actions',
      [
        { kind: 'native_fixture_state', path: 'clipboard.text' },
        { kind: 'native_fixture_state', path: 'share.opened' },
        { kind: 'native_fixture_state', path: 'notification.cancelled' },
      ],
    );

    const longMemEvalScenario = E2E_DIRECT_BENCHMARK_SCENARIOS.find(
      (entry) => entry.id === 'direct-longmemeval-v2-mobile-preference-update',
    );
    expect(longMemEvalScenario).toBeDefined();
    expectNoInternalGraphSeeds(longMemEvalScenario!);
    expect(longMemEvalScenario!.rubrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'memory_fact',
          predicate: 'preferred_message_contact',
          value: 'Avery',
        }),
        expect.objectContaining({ kind: 'native_fixture_state', path: 'contacts.resultCount' }),
        expect.objectContaining({ kind: 'native_fixture_state', path: 'sms.opened' }),
      ]),
    );
  });

  it('keeps benchmark completion criteria satisfiable by result structures', () => {
    const goal = (criteria: ReadonlyArray<string>, evidence: ReadonlyArray<string>) =>
      createGoal({
        id: 'criteria-check',
        title: 'criteria-check',
        status: 'active',
        successCriteria: [...criteria],
        evidence: [...evidence],
        now: 1,
      });

    expect(
      areGoalSuccessCriteriaSatisfied(
        goal(E2E_CALENDAR_MUTATION_SUCCESS_CRITERIA, [
          'calendar_create_event:{"status":"created"}',
          'calendar_update_event:{"status":"updated"}',
        ]),
      ),
    ).toBe(true);
    expect(
      areGoalSuccessCriteriaSatisfied(
        goal(E2E_CALENDAR_VERIFY_MUTATION_SUCCESS_CRITERIA, [
          'calendar_list:[{"allowsModifications":true}]',
          'calendar_create_event:{"status":"created"}',
          'calendar_update_event:{"status":"updated"}',
        ]),
      ),
    ).toBe(true);
    expect(
      areGoalSuccessCriteriaSatisfied(
        goal(E2E_CONTACT_SMS_SUCCESS_CRITERIA, [
          'contacts_search_full:[{"id":"e2e-contact-avery"}]',
          'sms_compose:{"status":"sms_composer_opened","recipientCount":1}',
        ]),
      ),
    ).toBe(true);
    expect(
      areGoalSuccessCriteriaSatisfied(
        goal(E2E_DEVICE_STATE_SUCCESS_CRITERIA, [
          'clipboard:{"status":"clipboard_written"}',
          'clipboard:{"status":"clipboard_read"}',
          'share:{"status":"share_sheet_opened"}',
          'notification_schedule:{"status":"notification_scheduled"}',
          'notification_cancel:{"status":"notification_cancelled"}',
        ]),
      ),
    ).toBe(true);
    expect(
      areGoalSuccessCriteriaSatisfied(
        goal(E2E_PERMISSION_MAPS_SUCCESS_CRITERIA, [
          'device_permissions:{"current":{"location":"denied","mediaLibrary":"revoked"}}',
          'location_get_current:{"status":"permission_denied"}',
          'maps_open:{"status":"maps_opened","targetKind":"query"}',
        ]),
      ),
    ).toBe(true);
    expect(
      areGoalSuccessCriteriaSatisfied(
        goal(
          [
            'evidence.json_field:fact.predicate:preferred_message_contact',
            'evidence.json_field:fact.value:Avery',
          ],
          [
            'memory_remember:{"status":"created","fact":{"predicate":"preferred_message_contact","value":"Avery"}}',
          ],
        ),
      ),
    ).toBe(true);
    expect(
      areGoalSuccessCriteriaSatisfied(
        goal(E2E_MEDIA_STATE_SUCCESS_CRITERIA, [
          'photos_latest:[{"id":"photo-1"},{"id":"photo-2"}]',
          'screen_record:{"status":"captured"}',
          'camera_clip:{"status":"recorded"}',
        ]),
      ),
    ).toBe(true);
    expect(
      areGoalSuccessCriteriaSatisfied(
        goal(E2E_CONTACT_SMS_SUCCESS_CRITERIA, ['contacts_search:[{"id":"e2e-contact-avery"}]']),
      ),
    ).toBe(false);
  });
});

describe('E2E structural mobile assistant scenarios', () => {
  beforeEach(() => {
    resetE2EWorkspaceSandbox();
    resetE2EMemorySandbox();
    mockRunOrchestrator.mockReset();
    mockRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onAssistantMessage('acknowledged', []);
      callbacks.onAgentControlGraphStateChange(buildFinalizedGraphSnapshot());
      callbacks.onDone();
    });
  });

  it('passive chitchat scenario satisfies ingestion and focus rubrics', async () => {
    const scenario = E2E_AGENT_SCENARIOS.find(
      (entry) => entry.id === 'multi-turn-passive-chitchat-memory',
    );
    expect(scenario).toBeDefined();

    const result = await runE2EScenario(scenario!);
    const outcomes = evaluateE2EScenarioRubrics(result, scenario!.rubrics);
    const failed = outcomes.filter((outcome) => !outcome.passed);
    expect(failed).toEqual([]);
  });

  it('longmem delayed-recall scenario keeps the passive middle turn free of tool pins', async () => {
    const scenario = E2E_BENCHMARK_SCENARIOS.find(
      (entry) => entry.id === 'bench-longmem-delayed-recall',
    );
    expect(scenario).toBeDefined();
    expect(scenario!.userTurns?.[1] as unknown as Record<string, unknown>).not.toHaveProperty(
      'allowedTools',
    );
    expectNoInternalGraphSeeds(scenario!);
  });

  it('scoped goal-switch scenario satisfies task-scoped focus rubrics', async () => {
    const scenario = E2E_BENCHMARK_SCENARIOS.find(
      (entry) => entry.id === 'bench-scoped-recall-goal-switch',
    );
    expect(scenario).toBeDefined();

    const goalsAfterScopeA = [
      createGoal({
        id: 'scope-a',
        title: 'scope-a-planning',
        status: 'active',
        now: 1,
      }),
    ];
    const goalsAfterScopeB = [
      createGoal({
        id: 'scope-b',
        title: 'scope-b-planning',
        status: 'active',
        now: 2,
      }),
    ];

    let invocation = 0;
    mockRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      const turn = invocation;
      invocation += 1;

      if (turn === 0 || turn === 2) {
        const toolCall = { id: `tc-${turn}`, name: 'update_goals', arguments: '{}' };
        callbacks.onToolCallStart(toolCall);
        callbacks.onAssistantMessage('', [toolCall]);
        callbacks.onAgentControlGraphStateChange(
          buildFinalizedGraphSnapshot(
            turn === 0 ? goalsAfterScopeA : goalsAfterScopeB,
            turn === 0 ? 'scope-a' : 'scope-b',
          ),
        );
      } else {
        callbacks.onAssistantMessage('acknowledged', []);
        callbacks.onAgentControlGraphStateChange(
          buildFinalizedGraphSnapshot(goalsAfterScopeB, 'scope-b'),
        );
      }

      callbacks.onDone();
    });

    const result = await runE2EScenario(scenario!);
    const focusContent = readE2EWorkingBlockContent(
      scenario!.conversationId,
      'active_focus',
      result.graphSnapshots,
    );
    expect(result.graphSnapshots.at(-1)?.goals?.[0]?.id).toBe('scope-b');
    expect(focusContent).toContain('scope-b-planning');
    const outcomes = evaluateE2EScenarioRubrics(result, scenario!.rubrics);
    const failed = outcomes.filter((outcome) => !outcome.passed);
    expect(failed).toEqual([]);
  });
});
