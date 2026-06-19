import {
  buildSubAgentLifecycleMessage,
  formatCompactElapsed,
  getSubAgentDisplayName,
  getSubAgentSessionLabel,
  summarizeSubAgentVisibleActivity,
  summarizeSubAgentOutput,
} from '../../src/services/agents/lifecycle/presentPhase';
import {
  buildSubAgentHierarchy,
  buildSubAgentRollupMap,
  buildSubAgentSubtree,
} from '../../src/services/agents/lifecycle/subAgentHierarchyPresentation';
import type { SubAgentSnapshot } from '../../src/types/subAgent';

const now = 1_700_000_000_000;

function makeSnapshot(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    sessionId: 'sub-root',
    parentConversationId: 'conv-1',
    depth: 0,
    startedAt: now - 5_000,
    updatedAt: now,
    status: 'running',
    sandboxPolicy: 'inherit',
    ...overrides,
  };
}

describe('subAgentPresentation', () => {
  it('formats compact elapsed time', () => {
    expect(formatCompactElapsed(4_500)).toBe('5s');
    expect(formatCompactElapsed(61_000)).toBe('1m 1s');
  });

  it('builds session labels and display names', () => {
    expect(getSubAgentSessionLabel('sub-1234567890abcdef')).toBe('sub-1234567890abc...');
    expect(getSubAgentDisplayName(makeSnapshot())).toBe('Sub-agent sub-root');
    expect(getSubAgentDisplayName(makeSnapshot({ name: 'Backend Architect' }))).toBe(
      'Backend Architect',
    );
  });

  it('summarizes long output into a single compact line', () => {
    expect(summarizeSubAgentOutput('')).toBeUndefined();
    expect(summarizeSubAgentOutput('Line one\n\nLine two')).toBe('Line one Line two');
    expect(summarizeSubAgentOutput('X'.repeat(240))?.endsWith('...')).toBe(true);
  });

  it('prefers visible activity when worker output is not available yet', () => {
    expect(summarizeSubAgentVisibleActivity({ currentActivity: 'Inspecting tests' })).toBe(
      'Inspecting tests',
    );
    expect(
      summarizeSubAgentVisibleActivity({ lastToolResultPreview: 'Found 3 failing snapshots' }),
    ).toBe('Found 3 failing snapshots');
  });

  it('builds lifecycle messages for started and completed events', () => {
    const started = buildSubAgentLifecycleMessage(
      makeSnapshot({ name: 'Researcher', depth: 1, sandboxPolicy: 'safe-only' }),
      'started',
    );
    const completed = buildSubAgentLifecycleMessage(
      makeSnapshot({
        name: 'Researcher',
        status: 'completed',
        toolsUsed: ['read_file', 'file_edit'],
        output: 'Finished the task.',
      }),
      'completed',
    );

    expect(started).toContain('Researcher started at depth 1');
    expect(started).toContain('safe-only sandbox access');
    expect(completed).toContain('Researcher completed');
    expect(completed).toContain('Tools: read_file, file_edit');
    expect(completed).toContain('Finished the task.');
  });

  it('builds lifecycle messages for cancelled events', () => {
    const cancelled = buildSubAgentLifecycleMessage(
      makeSnapshot({
        name: 'Researcher',
        status: 'cancelled',
        output: 'Stopped after finding a wrong branch.',
      }),
      'cancelled',
    );

    expect(cancelled).toContain('Researcher was cancelled');
    expect(cancelled).toContain('Stopped after finding a wrong branch.');
  });

  it('builds lifecycle messages for timeout events without collapsing them into generic errors', () => {
    const timedOut = buildSubAgentLifecycleMessage(
      makeSnapshot({
        name: 'Researcher',
        status: 'timeout',
        output: 'Stopped after the hard deadline expired.',
      }),
      'timeout',
    );

    expect(timedOut).toContain('Researcher timed out');
    expect(timedOut).toContain('Stopped after the hard deadline expired.');
  });

  it('builds a nested hierarchy that keeps parents ahead of children', () => {
    const flattened = buildSubAgentHierarchy([
      makeSnapshot({
        sessionId: 'child-b',
        parentSessionId: 'root-a',
        name: 'Child B',
        depth: 1,
        startedAt: now - 2_000,
        updatedAt: now - 1_000,
        status: 'completed',
      }),
      makeSnapshot({
        sessionId: 'root-a',
        name: 'Root A',
        depth: 0,
        startedAt: now - 10_000,
        updatedAt: now - 500,
        status: 'running',
      }),
      makeSnapshot({
        sessionId: 'child-c',
        parentSessionId: 'root-a',
        name: 'Child C',
        depth: 1,
        startedAt: now - 3_000,
        updatedAt: now - 2_000,
        status: 'running',
      }),
      makeSnapshot({
        sessionId: 'root-d',
        name: 'Root D',
        depth: 0,
        startedAt: now - 4_000,
        updatedAt: now - 3_000,
        status: 'completed',
      }),
    ]);

    expect(flattened.map((entry) => entry.snapshot.sessionId)).toEqual([
      'root-a',
      'child-c',
      'child-b',
      'root-d',
    ]);
    expect(flattened.find((entry) => entry.snapshot.sessionId === 'root-a')?.visualDepth).toBe(0);
    expect(flattened.find((entry) => entry.snapshot.sessionId === 'child-c')?.visualDepth).toBe(1);
  });

  it('builds a filtered subtree rooted at the selected worker', () => {
    const root = makeSnapshot({ sessionId: 'root-a', depth: 0, name: 'Root A' });
    const child = makeSnapshot({
      sessionId: 'child-b',
      parentSessionId: 'root-a',
      depth: 1,
      name: 'Child B',
    });
    const grandchild = makeSnapshot({
      sessionId: 'child-c',
      parentSessionId: 'child-b',
      depth: 2,
      name: 'Child C',
    });

    const subtree = buildSubAgentSubtree([root, child, grandchild], 'child-b', child);

    expect(subtree.map((entry) => entry.snapshot.sessionId)).toEqual(['child-b', 'child-c']);
    expect(subtree[0]?.visualDepth).toBe(0);
    expect(subtree[1]?.visualDepth).toBe(1);
  });

  it('computes rollups for parent workers', () => {
    const root = makeSnapshot({
      sessionId: 'root-a',
      depth: 0,
      name: 'Root A',
      status: 'running',
      iterations: 1,
      toolsUsed: ['tool_a'],
    });
    const childCompleted = makeSnapshot({
      sessionId: 'child-b',
      parentSessionId: 'root-a',
      depth: 1,
      status: 'completed',
      iterations: 2,
      toolsUsed: ['tool_b', 'tool_c'],
    });
    const childCancelled = makeSnapshot({
      sessionId: 'child-c',
      parentSessionId: 'root-a',
      depth: 1,
      status: 'cancelled',
      iterations: 3,
      toolsUsed: ['tool_d'],
    });

    const rollup = buildSubAgentRollupMap([root, childCompleted, childCancelled]).get('root-a');

    expect(rollup).toEqual(
      expect.objectContaining({
        totalAgents: 3,
        descendantCount: 2,
        runningCount: 1,
        completedCount: 1,
        cancelledCount: 1,
        errorCount: 0,
        timeoutCount: 0,
        totalIterations: 6,
        totalToolUses: 4,
        deepestDepth: 1,
      }),
    );
  });
});
