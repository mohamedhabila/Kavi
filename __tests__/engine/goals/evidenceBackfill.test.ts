import {
  backfillGoalEvidenceFromExistingGoals,
  routeToolEvidenceToActiveGoals,
} from '../../../src/engine/goals/evidenceRouting';
import { areBlockingGoalsStructurallyComplete } from '../../../src/engine/goals/completionEvidence';
import { applyGoalMutation } from '../../../src/engine/goals/graphState';
import {
  CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
  createGoal,
} from '../../../src/engine/goals/types';
import { buildToolEffectReceiptEvidence } from '../../../src/engine/goals/effectCompletionEvidence';
import { DELEGATED_WORKER_GOAL_OWNER } from '../../../src/engine/goals/delegation';
import type { ToolEffectReceipt } from '../../../src/types/toolEffectReceipt';

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

describe('backfillGoalEvidenceFromExistingGoals', () => {
  it('gives a late goal the evidence an earlier goal already holds for its criterion', () => {
    const systemGoal = createGoal({
      id: 'auto-system',
      title: 'Auto goal',
      status: 'active',
      evidence: [verifiedWrite('saturn-moons.md')],
    });
    const lateGoal = createGoal({
      id: 'manual',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.artifact:saturn-moons.md'],
    });

    expect(
      backfillGoalEvidenceFromExistingGoals({ goal: lateGoal, existingGoals: [systemGoal] }),
    ).toEqual([verifiedWrite('saturn-moons.md')]);
  });

  it('does not give a late goal evidence it never asked for', () => {
    const systemGoal = createGoal({
      id: 'auto-system',
      title: 'Auto goal',
      status: 'active',
      evidence: [verifiedWrite('jupiter-moons.md')],
    });
    const lateGoal = createGoal({
      id: 'manual',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.artifact:saturn-moons.md'],
    });

    expect(
      backfillGoalEvidenceFromExistingGoals({ goal: lateGoal, existingGoals: [systemGoal] }),
    ).toEqual([]);
  });

  it('does not back-fill a goal with no success criteria', () => {
    // Such a goal asserts no requirement, so there is nothing to prove and the
    // single-active-goal routing fallback — deliberately excluded here — is what
    // covers it at routing time.
    const systemGoal = createGoal({
      id: 'auto-system',
      title: 'Auto goal',
      status: 'active',
      evidence: [verifiedWrite('saturn-moons.md')],
    });
    const lateGoal = createGoal({ id: 'manual', title: 'Research', status: 'active' });

    expect(
      backfillGoalEvidenceFromExistingGoals({ goal: lateGoal, existingGoals: [systemGoal] }),
    ).toEqual([]);
  });

  it('ignores delegated worker goals as a source', () => {
    const workerGoal = createGoal({
      id: 'worker-goal',
      title: 'Worker',
      status: 'active',
      owner: DELEGATED_WORKER_GOAL_OWNER,
      evidence: [verifiedWrite('saturn-moons.md')],
    });
    const lateGoal = createGoal({
      id: 'manual',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.artifact:saturn-moons.md'],
    });

    expect(
      backfillGoalEvidenceFromExistingGoals({ goal: lateGoal, existingGoals: [workerGoal] }),
    ).toEqual([]);
  });

  it('does not duplicate evidence the goal already holds', () => {
    const evidence = verifiedWrite('saturn-moons.md');
    const systemGoal = createGoal({
      id: 'auto-system',
      title: 'Auto goal',
      status: 'active',
      evidence: [evidence],
    });
    const lateGoal = createGoal({
      id: 'manual',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.artifact:saturn-moons.md'],
      evidence: [evidence],
    });

    expect(
      backfillGoalEvidenceFromExistingGoals({ goal: lateGoal, existingGoals: [systemGoal] }),
    ).toEqual([]);
  });

  it('records the same evidence only once across several source goals', () => {
    const evidence = verifiedWrite('saturn-moons.md');
    const sources = [
      createGoal({ id: 'a', title: 'A', status: 'active', evidence: [evidence] }),
      createGoal({ id: 'b', title: 'B', status: 'completed', evidence: [evidence] }),
    ];
    const lateGoal = createGoal({
      id: 'manual',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.artifact:saturn-moons.md'],
    });

    expect(backfillGoalEvidenceFromExistingGoals({ goal: lateGoal, existingGoals: sources })).toEqual(
      [evidence],
    );
  });
});

describe('applyGoalMutation add back-fill', () => {
  it('attaches already-earned evidence when the goal is declared after the work', () => {
    const existing = [
      createGoal({
        id: 'auto-system',
        title: 'Auto goal',
        status: 'active',
        evidence: [verifiedWrite('saturn-moons.md')],
      }),
    ];

    const { goals, errors } = applyGoalMutation(existing, {
      action: 'add',
      goals: [
        {
          id: 'manual',
          title: 'Save the Saturn moons file',
          completionPolicy: 'blocking',
          status: 'active',
          successCriteria: ['evidence.artifact:saturn-moons.md'],
        },
      ],
    });

    expect(errors).toEqual([]);
    const added = goals.find((goal) => goal.id === 'manual');
    expect(added?.evidence).toEqual([verifiedWrite('saturn-moons.md')]);
  });

  it('leaves a late goal empty when no earned evidence matches its criterion', () => {
    const existing = [
      createGoal({
        id: 'auto-system',
        title: 'Auto goal',
        status: 'active',
        evidence: [verifiedWrite('jupiter-moons.md')],
      }),
    ];

    const { goals, errors } = applyGoalMutation(existing, {
      action: 'add',
      goals: [
        {
          id: 'manual',
          title: 'Save the Saturn moons file',
          completionPolicy: 'blocking',
          status: 'active',
          successCriteria: ['evidence.artifact:saturn-moons.md'],
        },
      ],
    });

    expect(errors).toEqual([]);
    expect(goals.find((goal) => goal.id === 'manual')?.evidence).toEqual([]);
  });
});

describe('routing when code materializes its own verification goal', () => {
  // Traced on device: executing write_file materialized a code-owned "Verify
  // write_file effect" goal alongside the model's own. That made the active count two,
  // which disqualified the model's goal from the single-unscoped-goal fallback, so the
  // receipt landed only on the bookkeeping goal. The model's goal stayed at zero
  // evidence, it retried update_goals three times, then rewrote the file to try to earn
  // evidence it had already earned.
  const WRITE_EVIDENCE = verifiedWrite('saturn-moons.md');

  function routeWrite(goals: ReturnType<typeof createGoal>[]) {
    return routeToolEvidenceToActiveGoals({
      toolName: 'write_file',
      toolDefinitions: [{ name: 'write_file', contract: { capabilities: ['write'] } }],
      goals,
      evidenceStrings: [WRITE_EVIDENCE],
    });
  }

  function modelGoal() {
    return createGoal({
      id: 'model-goal',
      title: "Find Saturn's 3 largest moons, save to file, read back",
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.min:1'],
    });
  }

  function effectGoal() {
    return createGoal({
      id: 'effect-goal',
      title: 'Verify write_file effect',
      status: 'active',
      owner: CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
      completionPolicy: 'blocking',
    });
  }

  it('still reaches the model goal when a verification goal exists alongside it', () => {
    const routed = routeWrite([modelGoal(), effectGoal()]);

    expect(routed.map((entry) => entry.goalId)).toContain('model-goal');
  });

  it('keeps routing evidence to the verification goal itself', () => {
    const routed = routeWrite([modelGoal(), effectGoal()]);

    expect(routed.map((entry) => entry.goalId)).toContain('effect-goal');
  });

  it('still withholds the fallback when the model declared two real goals', () => {
    // The rule exists to catch a single unscoped objective. Two genuine objectives are
    // ambiguous, so neither may claim unscoped evidence.
    const second = createGoal({
      id: 'second-model-goal',
      title: 'Summarize the findings',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.min:1'],
    });

    const routed = routeWrite([modelGoal(), second, effectGoal()]);

    expect(routed.map((entry) => entry.goalId)).not.toContain('model-goal');
    expect(routed.map((entry) => entry.goalId)).not.toContain('second-model-goal');
  });
});

describe('evidence earned while a goal was not active', () => {
  // The exact device sequence, in the agent's own words: "The artifact evidence was
  // recorded against a different goal before this one was active." Activating a goal
  // demotes the previously active one in its lane, and executing an effectful tool
  // materializes a code-owned verification goal that takes the active slot. The
  // model's goal is therefore pending precisely when its evidence arrives, and routing
  // only reaches active goals — so it could never complete, and the model rewrote the
  // file trying to re-earn what the run had already proved.
  const WRITE_EVIDENCE = verifiedWrite('saturn-moons.md');

  function researchGoal(status: 'pending' | 'active') {
    return createGoal({
      id: 'saturn-moons-research',
      title: 'Research Saturn moons',
      status,
      completionPolicy: 'blocking',
      successCriteria: ['evidence.artifact:saturn-moons.md'],
    });
  }

  it('hands a goal its earned evidence when it becomes active', () => {
    const existing = [
      researchGoal('pending'),
      createGoal({
        id: 'verify-write',
        title: 'Verify write_file effect',
        status: 'active',
        owner: CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
        evidence: [WRITE_EVIDENCE],
      }),
    ];

    const { goals, errors } = applyGoalMutation(existing, {
      action: 'activate',
      goals: [{ id: 'saturn-moons-research' }],
    });

    expect(errors).toEqual([]);
    const activated = goals.find((goal) => goal.id === 'saturn-moons-research');
    expect(activated?.status).toBe('active');
    expect(activated?.evidence).toContain(WRITE_EVIDENCE);
  });

  it('lets that goal complete without repeating the side effect', () => {
    const activated = applyGoalMutation(
      [
        researchGoal('pending'),
        createGoal({
          id: 'verify-write',
          title: 'Verify write_file effect',
          status: 'active',
          owner: CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
          evidence: [WRITE_EVIDENCE],
        }),
      ],
      { action: 'activate', goals: [{ id: 'saturn-moons-research' }] },
    );

    const completed = applyGoalMutation(activated.goals, {
      action: 'complete',
      goals: [{ id: 'saturn-moons-research' }],
    });

    expect(completed.errors).toEqual([]);
    expect(completed.goals.find((goal) => goal.id === 'saturn-moons-research')?.status).toBe(
      'completed',
    );
  });

  it('does not hand over evidence the activated goal never asked for', () => {
    const existing = [
      researchGoal('pending'),
      createGoal({
        id: 'other',
        title: 'Other work',
        status: 'active',
        evidence: [verifiedWrite('jupiter-moons.md')],
      }),
    ];

    const { goals } = applyGoalMutation(existing, {
      action: 'activate',
      goals: [{ id: 'saturn-moons-research' }],
    });

    expect(goals.find((goal) => goal.id === 'saturn-moons-research')?.evidence).toEqual([]);
  });

  it('does not duplicate evidence when a goal is activated twice', () => {
    const first = applyGoalMutation(
      [
        researchGoal('pending'),
        createGoal({
          id: 'verify-write',
          title: 'Verify write_file effect',
          status: 'active',
          owner: CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
          evidence: [WRITE_EVIDENCE],
        }),
      ],
      { action: 'activate', goals: [{ id: 'saturn-moons-research' }] },
    );
    const second = applyGoalMutation(first.goals, {
      action: 'activate',
      goals: [{ id: 'saturn-moons-research' }],
    });

    const evidence = second.goals.find((goal) => goal.id === 'saturn-moons-research')?.evidence;
    expect(evidence?.filter((entry) => entry === WRITE_EVIDENCE)).toHaveLength(1);
  });
});

describe('completing a goal straight from pending', () => {
  // The update_goals schema does not require `status`, so a goal added without one is
  // created pending — and completing required `active`, so a model following the
  // documented schema did the work, was refused with "Use activate first", and spent
  // another call activating. Auto-activating on add was the wrong cure: it changed when
  // blocking enforcement engages for every run, and a discovery goal that structurally
  // cannot earn evidence then blocked finalization and burned 26 tool calls. Allowing
  // the completion itself keeps enforcement timing untouched.
  function pendingGoal(evidence: string[]) {
    return createGoal({
      id: 'saturn-moons',
      title: 'Save the Saturn moons file',
      status: 'pending',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.artifact:saturn-moons.md'],
      evidence,
    });
  }

  it('completes in one call when the goal already earned its evidence', () => {
    const { goals, errors } = applyGoalMutation([pendingGoal([verifiedWrite('saturn-moons.md')])], {
      action: 'complete',
      goals: [{ id: 'saturn-moons' }],
    });

    expect(errors).toEqual([]);
    expect(goals.find((goal) => goal.id === 'saturn-moons')?.status).toBe('completed');
  });

  // The invariant these guarded — nothing unproven releases the run — still holds, but it
  // is enforced where it belongs: areBlockingGoalsStructurallyComplete evaluates the
  // criteria itself. Closing a goal is the model's bookkeeping and is no longer refused,
  // because refusing it produced the loop it was meant to prevent.
  it('closes a pending goal that has earned nothing, and finalization still refuses', () => {
    const { errors, goals } = applyGoalMutation([pendingGoal([])], {
      action: 'complete',
      goals: [{ id: 'saturn-moons' }],
    });

    expect(errors).toEqual([]);
    expect(areBlockingGoalsStructurallyComplete(goals)).toBe(false);
  });

  it('leaves a newly added goal pending, so enforcement timing is unchanged', () => {
    // The discovery scenario regressed because an auto-activated blocking goal began
    // enforcing completion for work that can never produce evidence.
    const { goals } = applyGoalMutation([], {
      action: 'add',
      goals: [
        {
          id: 'discovery',
          title: 'Find the right capability',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.artifact:notes.md'],
        },
      ],
    } as never);

    expect(goals.find((goal) => goal.id === 'discovery')?.status).toBe('pending');
  });
});

describe('completing a goal the engine already completed', () => {
  // The engine auto-completes a blocking goal the moment its criteria are satisfied.
  // A model that then said "complete" was told to activate first, and activating was
  // refused because completed goals cannot be reactivated — a contradiction with no
  // legal move. Measured in the evaluation suite as five update_goals calls against
  // that trap. Any tool whose result satisfies a goal can reach it.
  function completedGoal() {
    return createGoal({
      id: 'done-already',
      title: 'Save the file',
      status: 'completed',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.artifact:saturn-moons.md'],
      evidence: [verifiedWrite('saturn-moons.md')],
    });
  }

  it('succeeds instead of demanding an impossible activation', () => {
    const { errors } = applyGoalMutation([completedGoal()], {
      action: 'complete',
      goals: [{ id: 'done-already' }],
    });

    expect(errors).toEqual([]);
  });

  it('leaves the goal completed', () => {
    const { goals } = applyGoalMutation([completedGoal()], {
      action: 'complete',
      goals: [{ id: 'done-already' }],
    });

    expect(goals.find((goal) => goal.id === 'done-already')?.status).toBe('completed');
  });

  it('closes a pending goal that has earned nothing, and finalization still refuses', () => {
    const pending = createGoal({
      id: 'not-started',
      title: 'Later work',
      status: 'pending',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.artifact:later.md'],
    });

    const { errors, goals } = applyGoalMutation([pending], {
      action: 'complete',
      goals: [{ id: 'not-started' }],
    });

    expect(errors).toEqual([]);
    expect(areBlockingGoalsStructurallyComplete(goals)).toBe(false);
  });
});

describe('a rejected goal mutation reports current state', () => {
  // A rejection told the model what went wrong but not what was actually true, so it
  // retried against its own stale picture of the goal list and one rejection became a
  // loop. Every goal error now carries the current goals, which is what lets the model
  // see reality and adapt. This holds for any rejection reason, not one scenario.
  it('reactivating a completed goal reports the goal and its real status', () => {
    const pending = createGoal({
      id: 'not-started',
      title: 'Later work',
      status: 'completed',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.artifact:later.md'],
    });

    const { goals, errors } = applyGoalMutation([pending], {
      action: 'activate',
      goals: [{ id: 'not-started' }],
    });

    expect(errors.length).toBeGreaterThan(0);
    // The mutation is refused, so state is unchanged and still visible to the caller.
    expect(goals.find((goal) => goal.id === 'not-started')?.status).toBe('completed');
  });
});

describe('rejected mutation payload size', () => {
  // Returning current state on a rejection lets the model adapt instead of retrying
  // blind — but the first version echoed the full evidence array, and evidence entries
  // are effect receipts of roughly a kilobyte of digests each. On a scenario that
  // accumulated evidence and hit repeated rejections that inflated one run from 79K to
  // 944K tokens. Status and outstanding criteria are what the model can act on.
  it('reports status and unmet criteria without the evidence blobs', () => {
    const goal = createGoal({
      id: 'heavy',
      title: 'Heavy goal',
      status: 'completed',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.artifact:missing.md'],
      evidence: Array.from({ length: 12 }, () => verifiedWrite('saturn-moons.md')),
    });

    const { errors } = applyGoalMutation([goal], {
      action: 'activate',
      goals: [{ id: 'heavy' }],
    });

    expect(errors.length).toBeGreaterThan(0);
    // The receipts themselves must not be what the rejection carries back.
    const serialized = JSON.stringify(errors);
    expect(serialized).not.toContain('requestDigest');
    expect(serialized).not.toContain('contractIdentity');
  });
});

describe('the pending completion shortcut cannot release a goal that proved nothing', () => {
  // A goal with no success criteria meets "completion requirements" on any evidence at
  // all, and criteria are stripped whenever they fail recognition — so criteria-less
  // blocking goals occur in real runs. Letting those complete from pending allowed an
  // incidental catalog lookup or memory recall to close a blocking goal and release the
  // run before its work was done: a gate scenario collapsed from 11 tool calls to 2 and
  // never wrote its artifact.
  it('closes a criteria-less pending goal, and finalization still refuses', () => {
    const goal = createGoal({
      id: 'gate-followup',
      title: 'Persist the gate artifact',
      status: 'pending',
      completionPolicy: 'blocking',
      evidence: ['tool_catalog:listed 12 tools'],
    });

    const { errors, goals } = applyGoalMutation([goal], {
      action: 'complete',
      goals: [{ id: 'gate-followup' }],
    });

    expect(errors).toEqual([]);
    expect(goals.find((g) => g.id === 'gate-followup')?.status).toBe('completed');
    expect(areBlockingGoalsStructurallyComplete(goals)).toBe(false);
  });

  it('still completes a pending goal that satisfied a criterion it declared', () => {
    const goal = createGoal({
      id: 'gate-followup',
      title: 'Persist the gate artifact',
      status: 'pending',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.artifact:saturn-moons.md'],
      evidence: [verifiedWrite('saturn-moons.md')],
    });

    const { errors, goals } = applyGoalMutation([goal], {
      action: 'complete',
      goals: [{ id: 'gate-followup' }],
    });

    expect(errors).toEqual([]);
    expect(goals.find((g) => g.id === 'gate-followup')?.status).toBe('completed');
  });

  it('closes a pending goal whose criterion is unmet, and finalization still refuses', () => {
    const goal = createGoal({
      id: 'gate-followup',
      title: 'Persist the gate artifact',
      status: 'pending',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.artifact:missing.md'],
      evidence: [verifiedWrite('saturn-moons.md')],
    });

    const { errors, goals } = applyGoalMutation([goal], {
      action: 'complete',
      goals: [{ id: 'gate-followup' }],
    });

    expect(errors).toEqual([]);
    expect(areBlockingGoalsStructurallyComplete(goals)).toBe(false);
  });
});

describe('re-completing a goal is genuinely idempotent', () => {
  it('preserves the original completion time', () => {
    const goal = { ...createGoal({
      id: 'done',
      title: 'Done',
      status: 'completed',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.artifact:saturn-moons.md'],
      evidence: [verifiedWrite('saturn-moons.md')],
    }), completedAt: 111 };

    const { goals } = applyGoalMutation([goal], {
      action: 'complete',
      goals: [{ id: 'done' }],
    }, 999);

    expect(goals.find((g) => g.id === 'done')?.completedAt).toBe(111);
  });
});
