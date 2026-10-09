import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import { areBlockingGoalsStructurallyComplete } from '../../src/engine/goals/completionEvidence';
import {
  buildEffectCompletionCriterion,
  parseToolEffectReceiptEvidence,
} from '../../src/engine/goals/effectCompletionEvidence';
import type { AgentGoal } from '../../src/types/agentRun';
import type { ToolEffectReceipt } from '../../src/types/toolEffectReceipt';
import {
  applyGoalGraphEvents,
  buildBaseParams,
  createGoal,
  createToolMessage,
  extractGoalEvidenceEvents,
  tool,
} from '../helpers/toolExecutionOutcomeHarness';

// The resolver pre-filtered goals to active and blocked before routing, so two routes the
// evidence router implements never reached production: a declared pending goal earning the
// evidence it names, and a goal closed without proof receiving the proof its result asks
// the model to produce.

const DIGEST = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const EFFECT_CRITERION = buildEffectCompletionCriterion({
  effectKind: 'artifact.write',
  requestDigest: DIGEST('1'),
  resource: { kind: 'workspace_file', id: 'reports/final.md', digest: DIGEST('3') },
  verificationState: 'verified',
});

function writeReceipt(): ToolEffectReceipt {
  return {
    version: 2,
    receiptId: `ter_${'a'.repeat(32)}`,
    toolCallId: 'tc-write',
    toolName: 'write_file',
    executionRunId: 'execution-run-1',
    contractIdentity: {
      kind: 'code_owned',
      version: 1,
      toolName: 'write_file',
      schemaDigest: DIGEST('4'),
      capabilityContractDigest: DIGEST('4'),
      workflowContractDigest: DIGEST('4'),
      effectContractDigest: DIGEST('4'),
      executionPolicyDigest: DIGEST('4'),
    },
    transportState: 'returned',
    effectKind: 'artifact.write',
    effectState: 'applied',
    verificationState: 'verified',
    requestDigest: DIGEST('1'),
    resultDigest: DIGEST('2'),
    resource: { kind: 'workspace_file', id: 'reports/final.md', digest: DIGEST('3') },
    recordedAt: 1,
  };
}

function readFileOutcome() {
  return {
    index: 0,
    toolCallId: 'tc-read',
    toolMessage: createToolMessage({
      id: 'tc-read',
      name: 'read_file',
      content: '{"path":"notes.txt","content":"E2E-GATE-FU-42","complete":true}',
    }),
  };
}

function setup(goals: AgentGoal[]) {
  const params = buildBaseParams();
  let graph = { goals };
  params.groundedRequestScopedTools = [tool({ name: 'read_file' }), tool({ name: 'write_file' })];
  params.getGraphSnapshot = jest.fn(() => graph);
  params.applyGraphEvents = jest.fn((events) => {
    graph = applyGoalGraphEvents(graph, events);
  });
  return { params, getGraph: () => graph };
}

describe('tool evidence reaches every goal the router accepts', () => {
  it('gives a declared pending goal the evidence its criteria name', async () => {
    const { params } = setup([
      createGoal({
        id: 'verify',
        status: 'pending',
        completionPolicy: 'blocking',
        successCriteria: ['evidence.tool:read_file'],
      }),
    ]);
    params.executableToolCalls = [{ name: 'read_file', arguments: '{"path":"notes.txt"}' }];
    params.toolExecutionOutcomes = [readFileOutcome()];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const goalIds = extractGoalEvidenceEvents(params).map((event) => event.goalId);
    expect(goalIds.length).toBeGreaterThan(0);
    expect(new Set(goalIds)).toEqual(new Set(['verify']));
  });

  it('proves a goal the model closed before its read landed', async () => {
    const { params, getGraph } = setup([
      createGoal({
        id: 'verify',
        status: 'completed',
        completionPolicy: 'blocking',
        successCriteria: ['evidence.tool:read_file'],
      }),
    ]);
    params.executableToolCalls = [{ name: 'read_file', arguments: '{"path":"notes.txt"}' }];
    params.toolExecutionOutcomes = [readFileOutcome()];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(areBlockingGoalsStructurallyComplete(getGraph().goals)).toBe(true);
  });

  it('proves a closed write goal with the verified receipt of a retried write', async () => {
    const { params, getGraph } = setup([
      createGoal({
        id: 'write-final',
        status: 'completed',
        completionPolicy: 'blocking',
        successCriteria: [EFFECT_CRITERION],
      }),
    ]);
    params.executableToolCalls = [
      { name: 'write_file', arguments: '{"path":"reports/final.md","content":"done"}' },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-write',
        toolMessage: createToolMessage({
          id: 'tc-write',
          name: 'write_file',
          content: '{"status":"written"}',
        }),
        effectReceipt: writeReceipt(),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const receipt = extractGoalEvidenceEvents(params)
      .map((event) => event.evidence)
      .find((evidence) => parseToolEffectReceiptEvidence(evidence));
    expect(receipt).toBeDefined();
    expect(areBlockingGoalsStructurallyComplete(getGraph().goals)).toBe(true);
  });
});
