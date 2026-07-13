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
import {
  DELEGATION_E2E_SCENARIOS,
  E2E_AGENT_SCENARIOS,
  E2E_PAIRED_ONLY_SCENARIOS,
} from '../../src/acceptance/e2eAgent/scenarios';
import type { E2EScenario } from '../../src/acceptance/e2eAgent/types';
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
import { syncActiveGoalFocusFromGraphTransition } from '../../src/services/memory/tasks';
import { buildAssistantMessageMetadata } from '../../src/utils/assistantMessageMetadata';

const mockRunOrchestrator = jest.fn();
const completedOrchestratorRun = { terminalDisposition: 'final_candidate' as const };

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: (...args: unknown[]) => mockRunOrchestrator(...args),
}));

jest.mock('../../src/services/memory/lifecycle', () => {
  const actual = jest.requireActual('../../src/services/memory/lifecycle');
  return {
    ...actual,
    recordCompletedTurnForMemory: jest.fn((input) =>
      actual.recordCompletedTurnForMemory({
        ...input,
        activeChatProvider: undefined,
        providerEnrichment: false,
      }),
    ),
  };
});

jest.mock('../../src/acceptance/e2eAgent/providerConfig', () => ({
  buildE2EProvider: () => ({
    id: 'e2e-structural-provider',
    name: 'E2E structural provider',
    enabled: true,
    kind: 'remote',
    protocol: 'openai-chat',
    providerFamily: 'custom',
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
    asyncWork: { pendingOperations: [], awaitingBackgroundWorkers: false, updatedAt: 1 },
    performance: {
      modelTurnCount: 1,
      modelDurationMs: 1,
      toolExecutionCount: 0,
      toolExecutionDurationMs: 0,
      lastCandidateToolCount: 0,
      lastActiveToolCount: 0,
      maxActiveToolCount: 0,
      lastActiveToolTokenEstimate: 0,
      maxActiveToolTokenEstimate: 0,
      updatedAt: 1,
    },
    turnDirectives: {
      forceFinalText: false,
      requireWorkflowTool: false,
      incompleteFinalTextRecoveryCount: 0,
    },
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

function scenarioUserRequestText(scenario: E2EScenario): string {
  const requests = scenario.userTurns?.length
    ? scenario.userTurns.map((turn) => turn.content)
    : [scenario.prompt];
  return requests.join('\n').toLowerCase();
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
      ...E2E_PAIRED_ONLY_SCENARIOS,
    ]) {
      expectNoInternalGraphSeeds(scenario);
      expect(scenario as unknown as Record<string, unknown>).not.toHaveProperty('allowedTools');
    }
  });

  it('makes native SMS composer expectations explicit in the user request', () => {
    const scenarios = [...E2E_AGENT_SCENARIOS, ...DELEGATION_E2E_SCENARIOS].filter(
      (scenario, index, entries) =>
        scenario.contentClass === 'synthetic_public' &&
        entries.findIndex((entry) => entry.id === scenario.id) === index,
    );
    const smsComposerScenarios = scenarios.filter((scenario) =>
      scenario.rubrics.some(
        (rubric) =>
          rubric.kind === 'native_fixture_state' &&
          rubric.path === 'sms.opened' &&
          rubric.expectedValue === 'true',
      ),
    );
    expect(smsComposerScenarios.length).toBeGreaterThan(0);

    for (const scenario of smsComposerScenarios) {
      const requestText = scenarioUserRequestText(scenario);
      expect(requestText).toContain('open the native sms composer');
      expect(requestText).toContain('exactly one recipient');
      expect(requestText).toContain('prefill the unsent draft');
      expect(requestText).toContain('do not send');

      const expectsContactLookup = scenario.rubrics.some(
        (rubric) =>
          rubric.kind === 'native_fixture_state' &&
          rubric.path === 'contacts.resultCount' &&
          rubric.expectedValue !== '0',
      );
      if (expectsContactLookup) {
        expect(requestText).toContain('device contacts');
      }
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
      callbacks.onAssistantMessage(
        'acknowledged',
        [],
        undefined,
        buildAssistantMessageMetadata('final'),
      );
      callbacks.onAgentControlGraphStateChange(firstGraph);
      callbacks.onDone();
      return completedOrchestratorRun;
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
      {
        kind: 'memory_fact',
        subject: 'knowu-user',
        predicate: 'preferred_message_contact',
        value: 'Avery',
        scope: 'global',
      },
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
      {
        kind: 'turn_clarification',
        turnIndex: 0,
        requiredMissingFields: ['recipient', 'message_body'],
      },
      { kind: 'turn_native_invocation_count', turnIndex: 0, expectedCount: 0 },
      { kind: 'turn_completion', turnIndex: 0, field: 'execution', expected: true },
      { kind: 'turn_completion', turnIndex: 0, field: 'final_response', expected: true },
      { kind: 'turn_completion', turnIndex: 1, field: 'execution', expected: true },
      { kind: 'turn_completion', turnIndex: 1, field: 'final_response', expected: true },
      { kind: 'native_fixture_state', path: 'contacts.resultCount' },
      { kind: 'native_fixture_state', path: 'sms.opened' },
      { kind: 'native_fixture_state', path: 'sms.recipientCount', expectedValue: '1' },
      { kind: 'native_fixture_state', path: 'sms.messageLength', expectedValue: '18' },
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
          subject: 'direct-longmem-user',
          predicate: 'preferred_message_contact',
          value: 'Avery',
          scope: 'global',
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
          'calendar_create_event:{"status":"created_verified"}',
          'calendar_update_event:{"status":"updated_verified"}',
        ]),
      ),
    ).toBe(true);
    expect(
      areGoalSuccessCriteriaSatisfied(
        goal(E2E_CALENDAR_VERIFY_MUTATION_SUCCESS_CRITERIA, [
          'calendar_list:[{"allowsModifications":true}]',
          'calendar_create_event:{"status":"created_verified"}',
          'calendar_update_event:{"status":"updated_verified"}',
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
      callbacks.onAssistantMessage(
        'acknowledged',
        [],
        undefined,
        buildAssistantMessageMetadata('final'),
      );
      callbacks.onAgentControlGraphStateChange(buildFinalizedGraphSnapshot());
      callbacks.onDone();
      return completedOrchestratorRun;
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

  it('longmem probes grade answers and prompt-selected memory instead of only final DB state', () => {
    for (const id of [
      'bench-longmem-delayed-recall',
      'bench-longmem-dual-fact-recall',
      'bench-longmem-knowledge-update-recall',
      'bench-longmem-abstention-empty-recall',
    ]) {
      const scenario = E2E_BENCHMARK_SCENARIOS.find((entry) => entry.id === id);
      expect(scenario).toBeDefined();
      expect(scenario!.rubrics.some((rubric) => rubric.kind === 'turn_memory_answer')).toBe(true);
      expect(scenario!.rubrics.some((rubric) => rubric.kind === 'turn_memory_selection')).toBe(
        true,
      );
    }
  });

  it('keeps passive causal-memory learning turns free of tool calls and native side effects', () => {
    const scenario = E2E_PAIRED_ONLY_SCENARIOS.find(
      (entry) => entry.id === 'paired-causal-global-preference',
    );
    expect(scenario).toBeDefined();
    expectNoInternalGraphSeeds(scenario!);

    const neutralRubrics = scenario!.pairedEvaluation!.neutralRubricIndexes.map(
      (index) => scenario!.rubrics[index],
    );
    expect(neutralRubrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'turn_native_invocation_count',
          turnIndex: 0,
          expectedCount: 0,
        }),
        expect.objectContaining({
          kind: 'turn_native_invocation_count',
          turnIndex: 1,
          expectedCount: 0,
        }),
        expect.objectContaining({
          kind: 'turn_tool_call_count',
          turnIndex: 0,
          scope: 'all',
          expectedCount: 0,
        }),
        expect.objectContaining({
          kind: 'turn_tool_call_count',
          turnIndex: 1,
          scope: 'all',
          expectedCount: 0,
        }),
      ]),
    );
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
    mockRunOrchestrator.mockImplementation(async (options, callbacks) => {
      const turn = invocation;
      invocation += 1;

      callbacks.onAssistantMessage(
        'acknowledged',
        [],
        undefined,
        buildAssistantMessageMetadata('final'),
      );
      const goals = turn === 0 ? goalsAfterScopeA : goalsAfterScopeB;
      syncActiveGoalFocusFromGraphTransition({
        threadId: options.conversationId,
        goals,
      });
      callbacks.onAgentControlGraphStateChange(
        buildFinalizedGraphSnapshot(goals, turn === 0 ? 'scope-a' : 'scope-b'),
      );

      callbacks.onDone();
      return completedOrchestratorRun;
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
