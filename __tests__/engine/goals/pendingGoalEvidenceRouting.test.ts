import { routeToolEvidenceToActiveGoals } from '../../../src/engine/goals/evidenceRouting';
import { applyGoalMutation } from '../../../src/engine/goals/graphState';
import { buildToolEffectReceiptEvidence } from '../../../src/engine/goals/effectCompletionEvidence';
import { findEvidenceSatisfiedGoals } from '../../../src/engine/graph/completionGateGoalAutoComplete';
import { createGoal } from '../../../src/engine/goals/types';
import { DELEGATED_WORKER_GOAL_OWNER } from '../../../src/engine/goals/delegation';
import type { ToolEffectReceipt } from '../../../src/types/toolEffectReceipt';

// Traced live on an Android emulator. `update_goals` does not require a status and
// `createGoal` defaults to pending, so "declare the objective, then do the work" produced
// a pending goal — and evidence routed only to focused goals, so the write, the memory
// fact and the read all landed nowhere. Completion was refused for criteria the run had
// already satisfied, and recovery cost an activate call plus "Need to re-read the file to
// register the read_file evidence for the goal system", reading the file a second time as
// pure bookkeeping. Five goal mutations and a redundant read for a three-step task.

function contractIdentity(toolName: string): ToolEffectReceipt['contractIdentity'] {
  const digest = `sha256:${'5'.repeat(64)}` as const;
  return {
    kind: 'code_owned',
    version: 1,
    toolName,
    schemaDigest: digest,
    capabilityContractDigest: digest,
    workflowContractDigest: digest,
    effectContractDigest: digest,
    executionPolicyDigest: digest,
  };
}

function verifiedWrite(path: string): string {
  return buildToolEffectReceiptEvidence({
    version: 2,
    receiptId: `ter_${'a'.repeat(32)}`,
    toolCallId: 'call-write',
    toolName: 'write_file',
    executionRunId: 'execution-run-1',
    contractIdentity: contractIdentity('write_file'),
    transportState: 'returned',
    effectKind: 'artifact.write',
    effectState: 'applied',
    verificationState: 'verified',
    requestDigest: `sha256:${'1'.repeat(64)}`,
    resultDigest: `sha256:${'2'.repeat(64)}`,
    resource: { kind: 'workspace_file', id: path },
    recordedAt: 1,
  } satisfies ToolEffectReceipt);
}

const BRIEF = 'artifacts/brief.md';

const pendingBrief = () =>
  createGoal({
    id: 'research-brief',
    title: 'research-brief',
    completionPolicy: 'blocking',
    successCriteria: [`evidence.artifact:${BRIEF}`],
  });

describe('a declared but unfocused goal earns the evidence it named', () => {
  it('routes a matching tool result to a pending goal', () => {
    const routed = routeToolEvidenceToActiveGoals({
      toolName: 'write_file',
      toolDefinitions: [],
      goals: [pendingBrief()],
      evidenceStrings: [verifiedWrite(BRIEF)],
    });

    expect(routed).toEqual([{ goalId: 'research-brief', evidence: verifiedWrite(BRIEF) }]);
  });

  it('collapses the traced sequence to declare-then-complete, with no activate', () => {
    const added = applyGoalMutation([], {
      action: 'add',
      goals: [
        {
          id: 'research-brief',
          title: 'research-brief',
          completionPolicy: 'blocking',
          successCriteria: [`evidence.artifact:${BRIEF}`],
        },
      ],
    } as never);
    expect(added.errors).toEqual([]);
    // Unchanged: declaring a goal does not focus it.
    expect(added.goals[0]?.status).toBe('pending');

    const routed = routeToolEvidenceToActiveGoals({
      toolName: 'write_file',
      toolDefinitions: [],
      goals: added.goals,
      evidenceStrings: [verifiedWrite(BRIEF)],
    });
    expect(routed).toHaveLength(1);

    const withEvidence = added.goals.map((goal) => ({
      ...goal,
      evidence: [...goal.evidence, ...routed.map((entry) => entry.evidence)],
    }));

    const completed = applyGoalMutation(withEvidence, {
      action: 'complete',
      goals: [{ id: 'research-brief' }],
    });

    expect(completed.errors).toEqual([]);
    expect(completed.goals[0]?.status).toBe('completed');
  });
});

describe('routing evidence is not focusing a goal', () => {
  it('does not auto-complete a pending goal whose criteria are satisfied', () => {
    // The discovery scenario regressed when a goal was auto-activated and began enforcing
    // completion. Enforcement still keys off focus, so this must stay empty.
    const satisfiedButPending = createGoal({
      id: 'research-brief',
      title: 'research-brief',
      completionPolicy: 'blocking',
      successCriteria: [`evidence.artifact:${BRIEF}`],
      evidence: [verifiedWrite(BRIEF)],
    });

    expect(findEvidenceSatisfiedGoals([satisfiedButPending])).toEqual([]);
  });

  it('gives a pending goal nothing it did not name', () => {
    const unrelated = 'read_file:notes.md (2 lines)';
    const routed = routeToolEvidenceToActiveGoals({
      toolName: 'read_file',
      toolDefinitions: [
        { name: 'read_file', contract: { capabilities: ['read'], resourceKinds: [] } },
      ],
      goals: [
        createGoal({
          id: 'research-brief',
          title: 'research-brief',
          completionPolicy: 'blocking',
          successCriteria: [`evidence.artifact:${BRIEF}`],
          requiredCapabilities: ['read'],
        }),
      ],
      evidenceStrings: [unrelated],
    });

    // The goal declares a read capability, so a focused goal would take this by contract.
    // A pending one must not: it never named this result.
    expect(routed).toEqual([]);
  });

  it('leaves a pending criteria-less goal unable to absorb an incidental result', () => {
    const routed = routeToolEvidenceToActiveGoals({
      toolName: 'memory_recall',
      toolDefinitions: [],
      goals: [createGoal({ id: 'vague', title: 'Help the user' })],
      evidenceStrings: ['memory_recall:2 facts'],
    });

    expect(routed).toEqual([]);
  });

  it('still excludes delegation-owned goals', () => {
    const routed = routeToolEvidenceToActiveGoals({
      toolName: 'write_file',
      toolDefinitions: [],
      goals: [
        createGoal({
          id: 'worker-goal',
          title: 'Delegated worker',
          owner: DELEGATED_WORKER_GOAL_OWNER,
          completionPolicy: 'blocking',
          successCriteria: [`evidence.artifact:${BRIEF}`],
        }),
      ],
      evidenceStrings: [verifiedWrite(BRIEF)],
    });

    expect(routed).toEqual([]);
  });
});

describe('a focused goal keeps every route it had', () => {
  it('still takes evidence by tool contract', () => {
    const routed = routeToolEvidenceToActiveGoals({
      toolName: 'read_file',
      toolDefinitions: [
        { name: 'read_file', contract: { capabilities: ['read'], resourceKinds: [] } },
      ],
      goals: [
        createGoal({
          id: 'research-brief',
          title: 'research-brief',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: [`evidence.artifact:${BRIEF}`],
          requiredCapabilities: ['read'],
        }),
      ],
      evidenceStrings: ['read_file:notes.md (2 lines)'],
    });

    expect(routed).toHaveLength(1);
  });

  it('still takes an incidental result as the run’s single unscoped goal', () => {
    const routed = routeToolEvidenceToActiveGoals({
      toolName: 'memory_recall',
      toolDefinitions: [],
      goals: [createGoal({ id: 'vague', title: 'Help the user', status: 'active' })],
      evidenceStrings: ['memory_recall:2 facts'],
    });

    expect(routed).toHaveLength(1);
  });
});
