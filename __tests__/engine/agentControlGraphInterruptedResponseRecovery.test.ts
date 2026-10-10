import {
  AGENT_CONTROL_GRAPH_INTERRUPTED_RESPONSE_CANDIDATE_SUMMARY,
  buildAgentControlGraphInterruptedRecoveredOutcome,
  buildAgentControlGraphInterruptedNoEvidenceOutcome,
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
  it('keeps a compact graph-owned candidate summary for goal review', () => {
    expect(AGENT_CONTROL_GRAPH_INTERRUPTED_RESPONSE_CANDIDATE_SUMMARY).toContain(
      'response stream was interrupted',
    );
    expect(AGENT_CONTROL_GRAPH_INTERRUPTED_RESPONSE_CANDIDATE_SUMMARY).toContain(
      'goals are satisfied',
    );
  });

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

  it('keeps interrupted runs open for unfinished background or async work', () => {
    expect(
      buildAgentControlGraphInterruptedNoEvidenceOutcome({
        errorMessage: 'stream closed',
        runningBackgroundWorkerCount: 2,
        pendingOperations: [],
      }),
    ).toEqual({
      status: 'failed',
      checkpointTitle: 'Turn failed',
      checkpointDetail: 'stream closed',
    });

    expect(
      buildAgentControlGraphInterruptedNoEvidenceOutcome({
        errorMessage: 'stream closed',
        runningBackgroundWorkerCount: 0,
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

  it('falls back to terminal turn failure when no recovery evidence or open work exists', () => {
    expect(
      buildAgentControlGraphInterruptedNoEvidenceOutcome({
        errorMessage: 'stream closed',
        runningBackgroundWorkerCount: 0,
        pendingOperations: [],
      }),
    ).toEqual({
      status: 'failed',
      checkpointTitle: 'Turn failed',
      checkpointDetail: 'stream closed',
    });
  });

  it('builds the recovered outcome', () => {
    expect(buildAgentControlGraphInterruptedRecoveredOutcome()).toEqual({
      status: 'completed',
      checkpointTitle: 'Response recovered',
      checkpointDetail: 'Interrupted stream recovered from the verified work.',
    });
  });
});
