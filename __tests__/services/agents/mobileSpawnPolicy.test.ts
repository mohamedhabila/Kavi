import {
  evaluateMobileSpawnPreflight,
  MAX_CONCURRENT_SUB_AGENTS,
  MAX_SPAWN_DEPTH,
  resolveSpawnWorkstream,
} from '../../../src/services/agents/mobileSpawnPolicy';
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
    expect(resolveSpawnWorkstream({})).toEqual({ status: 'ready' });
  });

  it('takes an exact named workstream as given, whether or not a worker holds it', () => {
    expect(resolveSpawnWorkstream({ workstreamId: 'worker-chain' })).toEqual({
      status: 'ready',
      workstreamId: 'worker-chain',
    });
  });

  it('rejects malformed workstream ids without normalizing them', () => {
    for (const workstreamId of [' goal-a', '', 7, 'two words']) {
      expect(resolveSpawnWorkstream({ workstreamId })).toEqual(
        expect.objectContaining({ status: 'error' }),
      );
    }
  });
});
