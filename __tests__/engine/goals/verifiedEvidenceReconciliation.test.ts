import { applyGoalMutation } from '../../../src/engine/goals/graphState';
import { createGoal } from '../../../src/engine/goals/types';
import { buildToolEffectReceiptEvidence } from '../../../src/engine/goals/effectCompletionEvidence';
import type { ToolEffectReceipt } from '../../../src/types/toolEffectReceipt';

// Traced on-device with a mutation log. `moon-facts` declared
// `evidence.artifact:artifacts/moon-facts.md`; write_file wrote exactly that path; the
// goal still showed evidence: 0, so `complete` was refused ("Cannot complete a goal that
// is not active"), and only `activate` repaired it — activation being the sole place that
// replayed evidence between goals. `evidence.artifact` requires a verified receipt, and
// verification settles onto the code-owned effect goal after routing has already run.

const PATH = 'artifacts/moon-facts.md';
const EFFECT_GOAL_ID = 'effect-write-file-8f729a3ef5d66b296a36f77e';

function contractIdentity(toolName: string): ToolEffectReceipt['contractIdentity'] {
  const d = `sha256:${'5'.repeat(64)}` as const;
  return {
    kind: 'code_owned', version: 1, toolName, schemaDigest: d,
    capabilityContractDigest: d, workflowContractDigest: d,
    effectContractDigest: d, executionPolicyDigest: d,
  };
}

const verifiedWrite = buildToolEffectReceiptEvidence({
  version: 2,
  receiptId: `ter_${'a'.repeat(32)}`,
  toolCallId: 'call-write',
  toolName: 'write_file',
  executionRunId: 'run-1',
  contractIdentity: contractIdentity('write_file'),
  transportState: 'returned',
  effectKind: 'artifact.write',
  effectState: 'applied',
  verificationState: 'verified',
  requestDigest: `sha256:${'1'.repeat(64)}`,
  resultDigest: `sha256:${'2'.repeat(64)}`,
  resource: { kind: 'workspace_file', id: PATH },
  recordedAt: 1,
} satisfies ToolEffectReceipt);

function runToVerifiedWrite() {
  // Built directly: an effect receipt is code-owned, so it cannot be supplied through a
  // mutation. This is the state the run reaches once verification settles.
  const goals = [
    createGoal({
      id: 'moon-facts',
      title: 'moon-facts',
      completionPolicy: 'blocking',
      successCriteria: [`evidence.artifact:${PATH}`],
    }),
    createGoal({
      id: EFFECT_GOAL_ID,
      title: 'Verify write_file effect',
      status: 'active',
      completionPolicy: 'blocking',
      evidence: [verifiedWrite],
      successCriteria: [`evidence.artifact:${PATH}`],
    }),
  ];
  // Any mutation reconciles; on device this is the effect goal completing.
  const reconciled = applyGoalMutation(goals, {
    action: 'complete',
    goals: [{ id: EFFECT_GOAL_ID }],
  });
  expect(reconciled.errors).toEqual([]);
  return reconciled.goals;
}

describe('a goal receives verified evidence for the path it named', () => {
  it('holds the evidence without needing to be activated first', () => {
    const goals = runToVerifiedWrite();
    const moonFacts = goals.find((goal) => goal.id === 'moon-facts');

    expect(moonFacts?.status).toBe('pending');
    expect(moonFacts?.evidence).toContain(verifiedWrite);
  });

  it('completes straight from pending, with no activate round-trip', () => {
    const goals = runToVerifiedWrite();
    const completed = applyGoalMutation(goals, {
      action: 'complete',
      goals: [{ id: 'moon-facts' }],
    });

    // This is the call that was refused on device.
    expect(completed.errors).toEqual([]);
    expect(completed.goals.find((goal) => goal.id === 'moon-facts')?.status).toBe('completed');
  });

  it('still gives a goal nothing its criteria did not name', () => {
    const goals = [
      createGoal({
        id: 'unrelated',
        title: 'Unrelated',
        completionPolicy: 'blocking',
        successCriteria: ['evidence.artifact:artifacts/other.md'],
      }),
      createGoal({
        id: EFFECT_GOAL_ID,
        title: 'Verify write_file effect',
        status: 'active',
        completionPolicy: 'blocking',
        evidence: [verifiedWrite],
        successCriteria: [`evidence.artifact:${PATH}`],
      }),
    ];
    const reconciled = applyGoalMutation(goals, {
      action: 'complete',
      goals: [{ id: EFFECT_GOAL_ID }],
    });

    expect(reconciled.goals.find((goal) => goal.id === 'unrelated')?.evidence).toEqual([]);
  });

  it('is idempotent', () => {
    const goals = runToVerifiedWrite();
    const again = applyGoalMutation(goals, { action: 'update', goals: [{ id: 'moon-facts' }] });
    const moonFacts = again.goals.find((goal) => goal.id === 'moon-facts');

    expect(moonFacts?.evidence.filter((e) => e === verifiedWrite)).toHaveLength(1);
  });
});
