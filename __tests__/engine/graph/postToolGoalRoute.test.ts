import { summarizePostToolGoalRoute } from '../../../src/engine/graph/toolExecutionOutcomeResolutionSupport';
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

describe('summarizePostToolGoalRoute', () => {
  it('lets a proven close finish the route', () => {
    const route = summarizePostToolGoalRoute({
      completedBefore: new Set(),
      goals: [
        goal({ id: 'write', successCriteria: ['evidence.min:1'], evidence: ['write_file: ok'] }),
      ],
    });

    expect(route).toEqual({
      hasActivePersistentGoal: false,
      hasCompletedBlockingGoal: true,
      hasIncompleteBlockingGoal: false,
    });
  });

  it('keeps the route open for a close its criteria do not prove', () => {
    // Traced live: the close forced a text-only turn, so the "produce the evidence" and
    // "correct the criteria" moves its result names had no tools to run with.
    const route = summarizePostToolGoalRoute({
      completedBefore: new Set(),
      goals: [
        goal({
          id: 'gate-followup',
          successCriteria: ['evidence.artifact:artifacts/e2e-follow-gate.txt'],
          evidence: ['read_file:E2E-GATE-FU-42'],
        }),
      ],
    });

    expect(route.hasCompletedBlockingGoal).toBe(true);
    expect(route.hasIncompleteBlockingGoal).toBe(true);
  });

  it('does not count a goal that was already closed before these tool results', () => {
    const route = summarizePostToolGoalRoute({
      completedBefore: new Set(['write']),
      goals: [goal({ id: 'write', successCriteria: ['evidence.min:1'], evidence: ['ok'] })],
    });

    expect(route.hasCompletedBlockingGoal).toBe(false);
  });

  it('reports open blocking work and active persistent context', () => {
    const route = summarizePostToolGoalRoute({
      completedBefore: new Set(),
      goals: [
        goal({ id: 'next', status: 'pending', successCriteria: ['evidence.min:1'] }),
        goal({ id: 'preference', status: 'active', completionPolicy: 'persistent' }),
      ],
    });

    expect(route).toEqual({
      hasActivePersistentGoal: true,
      hasCompletedBlockingGoal: false,
      hasIncompleteBlockingGoal: true,
    });
  });
});
