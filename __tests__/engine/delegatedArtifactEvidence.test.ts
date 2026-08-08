import { collectDelegatedArtifactEvidence } from '../../src/engine/graph/delegatedToolEvidence';
import {
  buildDelegatedArtifactEvidence,
  readDelegatedArtifactEvidencePath,
} from '../../src/engine/goals/delegation';
import {
  areGoalSuccessCriteriaSatisfied,
  evaluateGoalEvidenceGaps,
  isSuccessCriterionMet,
} from '../../src/engine/goals/completionEvidence';
import { routeToolEvidenceToActiveGoals } from '../../src/engine/goals/evidenceRouting';
import { createGoal } from '../../src/engine/goals/types';

// Traced live on an Android emulator. A worker computed a wind-farm study and wrote
// `artifacts/wind/verdict.md`. The supervisor read it back and said "Everything checks
// out" — then could not close its own goal, because an `evidence.artifact:` criterion is
// met only by a verified `artifact.write` receipt and a receipt lands on the graph of the
// run that performed the write. It issued four `update_goals` calls, concluded "the goal
// system requires the artifact to be written from this session", and re-wrote the correct
// file purely as bookkeeping. That re-write is where the run died.

const VERDICT = 'artifacts/wind/verdict.md';

const terminalWorkerResult = (artifacts: Array<{ workspacePath?: string }>) =>
  JSON.stringify({
    sessionId: 'session-1',
    status: 'completed',
    completionState: 'verified_success',
    toolsUsed: ['python', 'write_file'],
    artifactCount: artifacts.length,
    artifacts: artifacts.map((artifact, index) => ({
      id: `artifact-${index}`,
      type: 'file',
      name: 'verdict.md',
      ...artifact,
    })),
  });

const supervisorGoal = (evidence: string[] = []) =>
  createGoal({
    id: 'feasibility-study',
    title: 'Produce the feasibility study',
    status: 'active',
    completionPolicy: 'blocking',
    successCriteria: [`evidence.artifact:${VERDICT}`],
    evidence,
  });

describe('a worker artifact satisfies the supervisor goal that named it', () => {
  it('extracts the produced path from a terminal worker result', () => {
    expect(
      collectDelegatedArtifactEvidence({
        hostToolName: 'sessions_wait',
        result: terminalWorkerResult([{ workspacePath: VERDICT }]),
      }),
    ).toEqual([buildDelegatedArtifactEvidence(VERDICT)]);
  });

  it('closes the goal the traced run could not close', () => {
    const goal = supervisorGoal([buildDelegatedArtifactEvidence(VERDICT)]);

    expect(isSuccessCriterionMet(goal, `evidence.artifact:${VERDICT}`)).toBe(true);
    expect(areGoalSuccessCriteriaSatisfied(goal)).toBe(true);
    // No gap means nothing tells the run to write the file again.
    expect(evaluateGoalEvidenceGaps([goal])).toEqual([]);
  });

  it('routes the evidence onto the goal whose criterion names that path', () => {
    const routed = routeToolEvidenceToActiveGoals({
      toolName: 'sessions_wait',
      toolDefinitions: [],
      goals: [supervisorGoal()],
      evidenceStrings: collectDelegatedArtifactEvidence({
        hostToolName: 'sessions_wait',
        result: terminalWorkerResult([{ workspacePath: VERDICT }]),
      }),
    });

    expect(routed).toEqual([
      { goalId: 'feasibility-study', evidence: buildDelegatedArtifactEvidence(VERDICT) },
    ]);
  });

  it('matches regardless of how the path is written', () => {
    const goal = supervisorGoal([buildDelegatedArtifactEvidence(`./${VERDICT}`)]);
    expect(isSuccessCriterionMet(goal, `evidence.artifact:${VERDICT}`)).toBe(true);
  });

  it('reads paths from a multi-session wait result', () => {
    const result = JSON.stringify({
      sessions: [
        { status: 'failed', completionState: 'verified_success', artifacts: [{ workspacePath: 'artifacts/bad.md' }] },
        {
          status: 'completed',
          completionState: 'verified_success',
          artifacts: [{ workspacePath: VERDICT }],
        },
      ],
    });

    expect(collectDelegatedArtifactEvidence({ hostToolName: 'sessions_wait', result })).toEqual([
      buildDelegatedArtifactEvidence(VERDICT),
    ]);
  });
});

describe('it does not manufacture proof the run does not have', () => {
  it('ignores a worker that did not reach verified success', () => {
    const unverified = JSON.stringify({
      status: 'completed',
      completionState: 'incomplete',
      artifacts: [{ workspacePath: VERDICT }],
    });

    expect(
      collectDelegatedArtifactEvidence({ hostToolName: 'sessions_wait', result: unverified }),
    ).toEqual([]);
  });

  it('ignores an errored delegation result', () => {
    expect(
      collectDelegatedArtifactEvidence({
        hostToolName: 'sessions_wait',
        result: terminalWorkerResult([{ workspacePath: VERDICT }]),
        isError: true,
      }),
    ).toEqual([]);
  });

  it('ignores a non-delegation tool', () => {
    expect(
      collectDelegatedArtifactEvidence({
        hostToolName: 'write_file',
        result: terminalWorkerResult([{ workspacePath: VERDICT }]),
      }),
    ).toEqual([]);
  });

  it('ignores an artifact with no workspace path', () => {
    expect(
      collectDelegatedArtifactEvidence({
        hostToolName: 'sessions_wait',
        result: terminalWorkerResult([{}]),
      }),
    ).toEqual([]);
  });

  it('does not satisfy a criterion naming a different artifact', () => {
    const goal = supervisorGoal([buildDelegatedArtifactEvidence('artifacts/other.md')]);
    expect(isSuccessCriterionMet(goal, `evidence.artifact:${VERDICT}`)).toBe(false);
  });

  it('survives unparseable results', () => {
    expect(
      collectDelegatedArtifactEvidence({ hostToolName: 'sessions_wait', result: 'not json' }),
    ).toEqual([]);
    expect(collectDelegatedArtifactEvidence({ hostToolName: 'sessions_wait', result: '' })).toEqual(
      [],
    );
  });

  it('round-trips only its own evidence form', () => {
    expect(readDelegatedArtifactEvidencePath(buildDelegatedArtifactEvidence(VERDICT))).toBe(VERDICT);
    expect(readDelegatedArtifactEvidencePath('write_file:{"path":"a.md"}')).toBeUndefined();
    expect(readDelegatedArtifactEvidencePath('delegated_artifact:   ')).toBeUndefined();
  });
});
