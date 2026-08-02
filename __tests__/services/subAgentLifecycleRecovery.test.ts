import { applyRecoveredTerminalSnapshot } from '../../src/services/agents/lifecycle/lifecycleRecovery';
import type { SubAgentSnapshot } from '../../src/types/subAgent';

describe('sub-agent lifecycle recovery', () => {
  it('keeps a terminal cancellation authoritative over stale active callback fields', () => {
    const agent: SubAgentSnapshot = {
      sessionId: 'worker-1',
      parentConversationId: 'conversation-1',
      name: 'quality analyst',
      depth: 0,
      startedAt: 100,
      updatedAt: 200,
      status: 'running',
      sandboxPolicy: 'inherit',
      launchState: 'queued',
      currentActivity: 'Queued to start',
    };
    const recovered: SubAgentSnapshot = {
      ...agent,
      updatedAt: 300,
      status: 'cancelled',
      terminationCause: 'cancelled',
      launchState: 'active',
      output: 'Stopped from the Android background-task notification.',
      currentActivity: 'Tool read_file failed',
      activeToolName: 'read_file',
      activeToolStartedAt: 250,
      modelResponsePendingSince: 240,
      deadlineAt: 10_000,
    };

    applyRecoveredTerminalSnapshot(agent, recovered);

    expect(agent).toEqual(
      expect.objectContaining({
        status: 'cancelled',
        terminationCause: 'cancelled',
        launchState: 'terminal',
        currentActivity: 'Stopped from the Android background-task notification.',
      }),
    );
    expect(agent.deadlineAt).toBeUndefined();
    expect(agent.modelResponsePendingSince).toBeUndefined();
    expect(agent.activeToolName).toBeUndefined();
    expect(agent.activeToolStartedAt).toBeUndefined();
  });
});
