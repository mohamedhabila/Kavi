import {
  areGoalSuccessCriteriaSatisfied,
  evaluateGoalEvidenceGaps,
  isSuccessCriterionMet,
  resolveGatingSuccessCriteria,
} from '../../../src/engine/goals/completionEvidence';
import {
  buildUnmetCompletionRequirementMessage,
  findUnmetCompletionCriteria,
} from '../../../src/engine/goals/completionRefusalMessage';
import { buildToolEffectReceiptEvidence } from '../../../src/engine/goals/effectCompletionEvidence';
import { createGoal } from '../../../src/engine/goals/types';
import {
  renderGoalBootstrapPromptSection,
  renderGoalMutationContractSection,
} from '../../../src/engine/goals/bootstrap';
import { DELEGATED_WORKER_MIN_EVIDENCE_CRITERION } from '../../../src/engine/goals/delegation';
import type { ToolEffectReceipt } from '../../../src/types/toolEffectReceipt';

// Traced live on an Android emulator. Asked to "create a goal called research-brief,
// write artifacts/brief.md with exactly three bullet points, read it back to verify,
// then remember the review status", the run declared
// `evidence.artifact:artifacts/brief.md` plus `evidence.min:3` — three criteria for what
// it read as three steps. Only the write routed evidence; the read-back, a directory
// listing and a web fetch routed none. With the artifact already written and verified the
// goal still would not close, so the run rewrote the brief twice more and invented
// `artifacts/verified.md` purely to reach three, then reported "goal auto-completed once
// the evidence threshold was met". The user asked for one file and got two plus an
// unrelated fetch.

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

function verifiedWrite(path: string, nonce: string): string {
  return buildToolEffectReceiptEvidence({
    version: 2,
    receiptId: `ter_${nonce.repeat(32).slice(0, 32)}`,
    toolCallId: `call-${nonce}`,
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

const researchBrief = (evidence: ReadonlyArray<string>) =>
  createGoal({
    id: 'research-brief',
    title: 'research-brief',
    status: 'active',
    completionPolicy: 'blocking',
    evidence: [...evidence],
    successCriteria: [`evidence.artifact:${BRIEF}`, 'evidence.min:3'],
  });

describe('a count does not gate a goal that carries a real criterion', () => {
  it('closes the traced goal on the work itself, not on a third evidence record', () => {
    expect(areGoalSuccessCriteriaSatisfied(researchBrief([verifiedWrite(BRIEF, 'a')]))).toBe(true);
  });

  it('does not report the count as a gap, so nothing asks for more evidence', () => {
    // This list is what the completion hold and loop-recovery prompt read back to the
    // model. Naming an unmet count there is what produced the redundant writes.
    const gaps = evaluateGoalEvidenceGaps([researchBrief([verifiedWrite(BRIEF, 'a')])]);
    expect(gaps).toEqual([]);
  });

  it('still reports the real criterion while the work is genuinely undone', () => {
    const gaps = evaluateGoalEvidenceGaps([researchBrief([])]);
    expect(gaps).toEqual([{ goalId: 'research-brief', criterionId: `evidence.artifact:${BRIEF}` }]);
    expect(areGoalSuccessCriteriaSatisfied(researchBrief([]))).toBe(false);
  });

  it('is not satisfied by unrelated writes that miss the named artifact', () => {
    // The count is gone, so three receipts no longer stand in for the one file asked for.
    const strays = [
      verifiedWrite('artifacts/verified.md', 'a'),
      verifiedWrite('artifacts/other.md', 'b'),
      verifiedWrite('artifacts/third.md', 'c'),
    ];
    expect(areGoalSuccessCriteriaSatisfied(researchBrief(strays))).toBe(false);
  });
});

describe('the delegation contract is unchanged', () => {
  const delegated = (evidence: ReadonlyArray<string>) =>
    createGoal({
      id: 'worker-goal',
      title: 'Delegated worker',
      status: 'active',
      completionPolicy: 'blocking',
      owner: 'delegated-worker',
      evidence: [...evidence],
      successCriteria: ['evidence.prefix:worker', DELEGATED_WORKER_MIN_EVIDENCE_CRITERION],
    });

  it('still requires the terminal worker result', () => {
    expect(areGoalSuccessCriteriaSatisfied(delegated([]))).toBe(false);
    expect(areGoalSuccessCriteriaSatisfied(delegated(['read_file:notes.md (1 line)']))).toBe(false);
  });

  it('closes on the worker result, which is what evidence.min:1 already meant', () => {
    expect(areGoalSuccessCriteriaSatisfied(delegated(['worker:terminal result']))).toBe(true);
  });
});

describe('a goal with nothing but counts keeps its floor', () => {
  // Such a goal has no other gate, and `normalizeAddGoalPatch` makes it persistent
  // rather than blocking. Dropping the count here would remove a floor rather than a
  // perverse incentive, and would let a run finalize with less evidence than before.
  const countOnly = (evidence: ReadonlyArray<string>) =>
    createGoal({
      id: 'count-only',
      title: 'Count only',
      status: 'active',
      evidence: [...evidence],
      successCriteria: ['evidence.min:2'],
    });

  it('is unsatisfied below the count', () => {
    expect(areGoalSuccessCriteriaSatisfied(countOnly(['read_file:a']))).toBe(false);
  });

  it('is satisfied at the count', () => {
    expect(areGoalSuccessCriteriaSatisfied(countOnly(['read_file:a', 'read_file:b']))).toBe(true);
  });
});

describe('the completion refusal names only what actually holds the goal', () => {
  it('names the real criterion and its action, never the count', () => {
    const message = buildUnmetCompletionRequirementMessage(researchBrief([]));

    expect(message).toContain(`evidence.artifact:${BRIEF}`);
    expect(message).not.toContain('evidence.min');
    expect(message).toContain(`write ${BRIEF} with write_file`);
  });

  it('stops telling the model to record more once the real work is done', () => {
    // A bare count yields no satisfying action, so naming it fell through to the generic
    // "record a tool result" line — an instruction to run tools with nothing to say about
    // which one. That sentence is what the traced run acted on.
    const message = buildUnmetCompletionRequirementMessage(researchBrief([verifiedWrite(BRIEF, 'a')]));

    expect(message).not.toContain('Record a tool result that satisfies it');
    expect(message).not.toContain('evidence.min');
    expect(findUnmetCompletionCriteria(researchBrief([verifiedWrite(BRIEF, 'a')]))).toEqual([]);
  });

  it('still reports a count-only goal, which has no other gate', () => {
    const goal = createGoal({
      id: 'count-only',
      title: 'Count only',
      status: 'active',
      evidence: ['read_file:a'],
      successCriteria: ['evidence.min:2'],
    });

    expect(findUnmetCompletionCriteria(goal)).toEqual(['evidence.min:2']);
  });
});

describe('resolveGatingSuccessCriteria', () => {
  it('drops counts only when a real criterion remains to gate the goal', () => {
    expect(resolveGatingSuccessCriteria([`evidence.artifact:${BRIEF}`, 'evidence.min:3'])).toEqual([
      `evidence.artifact:${BRIEF}`,
    ]);
    expect(resolveGatingSuccessCriteria(['evidence.min:3', 'evidence.count:2'])).toEqual([
      'evidence.min:3',
      'evidence.count:2',
    ]);
    expect(resolveGatingSuccessCriteria([])).toEqual([]);
  });

  it('leaves the criterion itself honest for reporting', () => {
    // Only gating changed. Anything asking whether the count is met still gets the truth.
    const goal = researchBrief([verifiedWrite(BRIEF, 'a')]);
    expect(isSuccessCriterionMet(goal, 'evidence.min:3')).toBe(false);
    expect(isSuccessCriterionMet(goal, `evidence.artifact:${BRIEF}`)).toBe(true);
  });
});

describe('the goal guidance names the one token evidence.prefix accepts', () => {
  // Traced on-device across runs, consistently: the model opened every goal-bearing task
  // by declaring `evidence.prefix:memory`, was refused, and corrected on the next call.
  // It was not guessing — the guidance offered `worker` as the sole worked example of a
  // prefix and warned against exactly one bad token, which reads as an invitation to
  // generalise the pattern to other domains.
  it('reserves evidence.prefix for worker and points tools at evidence.tool', () => {
    const text = `${renderGoalBootstrapPromptSection()}\n${renderGoalMutationContractSection()}`;

    expect(text).toContain('evidence.prefix is reserved for delegated worker results');
    expect(text).toContain('the only token it accepts is worker');
    expect(text).toContain('evidence.tool:<registered-tool-name>');
    // The old line invited the generalisation that produced the wasted call.
    expect(text).not.toContain('such as a tool name or worker');
  });
});
