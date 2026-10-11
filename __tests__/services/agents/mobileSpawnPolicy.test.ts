import {
  evaluateMobileSpawnPreflight,
  MAX_CONCURRENT_SUB_AGENTS,
  MAX_SPAWN_DEPTH,
  resolveSpawnWorkstream,
} from '../../../src/services/agents/mobileSpawnPolicy';
import type { AgentGoal } from '../../../src/types/agentRun';

const goals: AgentGoal[] = [
  {
    id: 'goal-a',
    title: 'Research topic',
    status: 'active',
    dependencies: [],
    evidence: [],
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'goal-b',
    title: 'Draft summary',
    status: 'pending',
    dependencies: ['goal-a'],
    evidence: [],
    createdAt: 2,
    updatedAt: 2,
  },
];

describe('mobileSpawnPolicy constants', () => {
  it('uses mobile-bounded depth and concurrency limits', () => {
    expect(MAX_SPAWN_DEPTH).toBe(2);
    expect(MAX_CONCURRENT_SUB_AGENTS).toBe(1);
  });
});

describe('evaluateMobileSpawnPreflight', () => {
  it('rejects spawn when depth is at or above MAX_SPAWN_DEPTH', () => {
    expect(
      evaluateMobileSpawnPreflight({
        depth: MAX_SPAWN_DEPTH,
        parentConversationId: 'conv-1',
        liveWorkers: [],
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'blocked',
        code: 'max_depth',
      }),
    );
  });

  it('rejects a second concurrent worker for the same parent conversation', () => {
    const result = evaluateMobileSpawnPreflight({
      depth: 0,
      parentConversationId: 'conv-1',
      agentRunId: 'run-1',
      liveWorkers: [
        {
          sessionId: 'sub-running',
          parentConversationId: 'conv-1',
          agentRunId: 'run-1',
          status: 'running',
        },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'blocked',
        code: 'max_concurrent',
        sessionId: 'sub-running',
      }),
    );
  });

  it('allows spawn when prior worker is terminal', () => {
    const result = evaluateMobileSpawnPreflight({
      depth: 0,
      parentConversationId: 'conv-1',
      liveWorkers: [
        {
          sessionId: 'sub-done',
          parentConversationId: 'conv-1',
          status: 'completed',
        },
      ],
    });

    expect(result).toEqual({ status: 'ready' });
  });

  it('fails closed on malformed current or live worker identities', () => {
    expect(
      evaluateMobileSpawnPreflight({
        depth: 0,
        parentConversationId: ' conv-1',
        liveWorkers: [],
      }),
    ).toEqual(expect.objectContaining({ status: 'blocked', code: 'invalid_identity' }));
    expect(
      evaluateMobileSpawnPreflight({
        depth: 0,
        parentConversationId: 'conv-1',
        liveWorkers: [
          {
            sessionId: ' sub-running',
            parentConversationId: 'conv-1',
            status: 'running',
          },
        ],
      }),
    ).toEqual(expect.objectContaining({ status: 'blocked', code: 'invalid_identity' }));
  });
});

describe('resolveSpawnWorkstream', () => {
  it('starts new work when no workstream is named', () => {
    expect(resolveSpawnWorkstream({ goals })).toEqual({ status: 'ready' });
  });

  it('addresses a workstream the run already holds', () => {
    expect(resolveSpawnWorkstream({ workstreamId: 'goal-b', goals })).toEqual({
      status: 'ready',
      workstreamId: 'goal-b',
    });
  });

  it('refuses a workstream the run does not hold, and says to omit it', () => {
    const result = resolveSpawnWorkstream({ workstreamId: 'missing-goal', goals });

    expect(result).toEqual({
      status: 'error',
      error: 'Unknown workstreamId "missing-goal"; omit it to start new work.',
    });
  });

  it('takes the named workstream as given when the run holds none yet', () => {
    expect(resolveSpawnWorkstream({ workstreamId: 'worker-chain', goals: [] })).toEqual({
      status: 'ready',
      workstreamId: 'worker-chain',
    });
  });

  it('rejects malformed workstream ids without normalizing them', () => {
    for (const workstreamId of [' goal-a', '', 7]) {
      expect(resolveSpawnWorkstream({ workstreamId, goals })).toEqual(
        expect.objectContaining({ status: 'error' }),
      );
    }
  });
});
