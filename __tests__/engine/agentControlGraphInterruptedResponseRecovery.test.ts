import {
  buildAgentControlGraphInterruptedOutcome,
  buildAgentControlGraphInterruptedTurnFailedOutcome,
  buildAgentControlGraphProviderRejectedInterruptedOutcome,
} from '../../src/engine/graph/interruptedResponseRecovery';
import type { AgentRunAsyncOperation } from '../../src/types/agentRun';

function createPendingOperation(): AgentRunAsyncOperation {
  return {
    key: 'session:s1',
    kind: 'session',
    resourceId: 's1',
    displayName: 'Worker session',
    status: 'running',
    lastUpdatedByTool: 'sessions_spawn',
    updatedAt: 1000,
    monitorToolNames: ['sessions_status'],
    waitToolName: 'sessions_wait',
  };
}

describe('agent control graph interrupted response recovery', () => {
  it('builds provider and generic failed outcomes without screen decisions', () => {
    expect(buildAgentControlGraphProviderRejectedInterruptedOutcome('quota exceeded')).toEqual({
      status: 'failed',
      checkpointTitle: 'Provider request rejected',
      checkpointDetail: 'quota exceeded',
    });
    expect(buildAgentControlGraphInterruptedTurnFailedOutcome('stream closed')).toEqual({
      status: 'failed',
      checkpointTitle: 'Turn failed',
      checkpointDetail: 'stream closed',
    });
  });

  it('keeps an interrupted run open while async work is pending', () => {
    expect(
      buildAgentControlGraphInterruptedOutcome({
        errorMessage: 'stream closed',
        pendingOperations: [createPendingOperation()],
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'failed',
        keepRunOpen: 'async-operations',
        checkpointTitle: 'Async monitoring active',
      }),
    );
  });

  it('fails an interrupted run with nothing pending, whatever work it finished', () => {
    expect(
      buildAgentControlGraphInterruptedOutcome({
        errorMessage: 'stream closed',
        pendingOperations: [],
      }),
    ).toEqual({
      status: 'failed',
      checkpointTitle: 'Turn failed',
      checkpointDetail: 'stream closed',
    });
  });
});
