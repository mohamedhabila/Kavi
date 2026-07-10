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
        executionCompleted: true,
        finalResponseCompleted: true,
        runCompleted: true,
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
    ];
    const scenario: E2EScenario = { ...sourceScenario, rubrics };

    const manifest = buildE2EBenchmarkManifest(scenario);

    expect(manifest.finalStateEvaluators).toEqual([]);
    expect(manifest.resourceBudgetEvaluators).toEqual([]);
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
        rubricKind: 'turn_memory_receipt',
        evaluatorKind: 'trajectory',
        evidenceKind: 'memory_receipt',
      },
      {
        rubricKind: 'turn_lifecycle_boundary',
        evaluatorKind: 'trajectory',
        evidenceKind: 'lifecycle_event',
      },
    ]);
  });
});
