import { buildCanonicalGoalResult } from '../../../src/engine/graph/canonicalGoalResult';
import type { AgentGoal } from '../../../src/types/agentRun';

function goal(overrides: Partial<AgentGoal> & { id: string }): AgentGoal {
  return {
    title: overrides.id,
    status: 'completed',
    completionPolicy: 'blocking',
    dependencies: [],
    evidence: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as AgentGoal;
}

describe('canonical goal result proof report', () => {
  it('reports a blocking goal closed without the evidence its criteria require', () => {
    // The traced shape: a read-only verification goal closed under an artifact-write
    // criterion. The result said only "completed", so the model told the user the work
    // was recorded while finalization refused to settle the run.
    const result = buildCanonicalGoalResult(
      goal({
        id: 'gate-followup',
        successCriteria: ['evidence.min:1', 'evidence.artifact:artifacts/e2e-follow-gate.txt'],
        evidence: ['read_file:E2E-GATE-FU-42'],
      }),
    );

    expect(result.status).toBe('completed');
    expect(result.proof).toEqual({
      proven: false,
      unmetCriteria: [
        expect.objectContaining({ criterion: 'evidence.artifact:artifacts/e2e-follow-gate.txt' }),
      ],
      note: expect.stringContaining('the run cannot finish as verified'),
    });
  });

  it('adds nothing to a proven close', () => {
    const result = buildCanonicalGoalResult(
      goal({ id: 'g', successCriteria: ['evidence.min:1'], evidence: ['read_file: ok'] }),
    );

    expect(result).not.toHaveProperty('proof');
  });

  it.each<Partial<AgentGoal>>([
    { status: 'active', successCriteria: ['evidence.artifact:a.md'] },
    { status: 'pending', successCriteria: ['evidence.artifact:a.md'] },
    { completionPolicy: 'persistent' },
  ])('adds nothing to a goal that is not a closed blocking goal (%p)', (overrides) => {
    expect(buildCanonicalGoalResult(goal({ id: 'g', ...overrides }))).not.toHaveProperty('proof');
  });
});
