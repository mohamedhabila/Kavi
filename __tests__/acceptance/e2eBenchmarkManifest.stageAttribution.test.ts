import { buildE2EBenchmarkManifest } from '../../src/acceptance/e2eAgent/e2eBenchmarkManifest';
import { E2E_AGENT_SCENARIOS } from '../../src/acceptance/e2eAgent/scenarios';
import type { E2ERubric, E2EScenario } from '../../src/acceptance/e2eAgent/types';

describe('E2E benchmark manifest stage attribution', () => {
  it('classifies execution, receipt, and lifecycle evidence as trajectory evaluators', () => {
    const sourceScenario = E2E_AGENT_SCENARIOS[0];
    if (!sourceScenario) {
      throw new Error('Expected at least one registered E2E scenario.');
    }
    const rubrics: E2ERubric[] = [
      {
        kind: 'turn_route',
        turnIndex: 0,
        directive: 'forced_agentic',
        mode: 'agentic',
      },
      {
        kind: 'turn_completion',
        turnIndex: 0,
        field: 'execution',
        expected: true,
      },
      {
        kind: 'turn_completion',
        turnIndex: 0,
        field: 'final_response',
        expected: true,
      },
      {
        kind: 'turn_completion',
        turnIndex: 0,
        field: 'agent_run',
        expected: true,
      },
      {
        kind: 'turn_memory_receipt',
        turnIndex: 0,
        providerOutcome: 'valid',
      },
      {
        kind: 'turn_lifecycle_boundary',
        turnIndex: 1,
        boundary: 'app_relaunch',
      },
      {
        kind: 'turn_final_response_token',
        turnIndex: 1,
        token: 'OPAQUE-OUTCOME-42',
      },
      {
        kind: 'turn_clarification',
        turnIndex: 1,
        requiredMissingFields: ['new_start_time'],
      },
      {
        kind: 'turn_native_invocation_count',
        turnIndex: 1,
        toolName: 'calendar_update_event',
        expectedCount: 0,
      },
      { kind: 'ingestion_job_checkpointed', minCount: 1 },
    ];
    const scenario: E2EScenario = {
      ...sourceScenario,
      userTurns: [
        { content: 'First turn.', selectedMode: 'agentic' },
        { content: 'Continue after relaunch.', lifecycleBefore: 'app_relaunch' },
      ],
      rubrics,
    };

    const manifest = buildE2EBenchmarkManifest(scenario);

    expect(manifest.finalStateEvaluators).toEqual([]);
    expect(manifest.resourceBudgetEvaluators).toEqual([]);
    expect(manifest.initialState.execution.turnLifecycleBoundaries).toEqual([null, 'app_relaunch']);
    expect(manifest.initialState.execution.turnSelectedModes).toEqual(['agentic', null]);
    expect(
      manifest.trajectoryEvaluators.map(({ rubricKind, evaluatorKind, evidenceKind }) => ({
        rubricKind,
        evaluatorKind,
        evidenceKind,
      })),
    ).toEqual([
      {
        rubricKind: 'turn_route',
        evaluatorKind: 'trajectory',
        evidenceKind: 'execution_state',
      },
      {
        rubricKind: 'turn_completion',
        evaluatorKind: 'trajectory',
        evidenceKind: 'execution_state',
      },
      {
        rubricKind: 'turn_completion',
        evaluatorKind: 'trajectory',
        evidenceKind: 'execution_state',
      },
      {
        rubricKind: 'turn_completion',
        evaluatorKind: 'trajectory',
        evidenceKind: 'execution_state',
      },
      {
        rubricKind: 'turn_memory_receipt',
        evaluatorKind: 'trajectory',
        evidenceKind: 'memory_receipt',
      },
      {
        rubricKind: 'turn_lifecycle_boundary',
        evaluatorKind: 'trajectory',
        evidenceKind: 'lifecycle_event',
      },
      {
        rubricKind: 'turn_final_response_token',
        evaluatorKind: 'trajectory',
        evidenceKind: 'assistant_response',
      },
      {
        rubricKind: 'turn_clarification',
        evaluatorKind: 'trajectory',
        evidenceKind: 'assistant_response',
      },
      {
        rubricKind: 'turn_native_invocation_count',
        evaluatorKind: 'trajectory',
        evidenceKind: 'native_fixture_state',
      },
      {
        rubricKind: 'ingestion_job_checkpointed',
        evaluatorKind: 'trajectory',
        evidenceKind: 'memory_store',
      },
    ]);
    const completionFingerprints = manifest.trajectoryEvaluators
      .filter((evaluator) => evaluator.rubricKind === 'turn_completion')
      .map((evaluator) => evaluator.fingerprint);
    expect(completionFingerprints).toHaveLength(3);
    expect(new Set(completionFingerprints).size).toBe(3);
  });
});
