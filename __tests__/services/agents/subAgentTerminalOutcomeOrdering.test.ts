const mockCreatePending = jest.fn();
const mockReconcile = jest.fn();
const mockCommitPendingVerifiedProcedureObservation = jest.fn();

jest.mock('../../../src/services/agents/subAgentOutcomeReconciliation', () => ({
  createPendingSubAgentOutcomeReconciliation: (...args: unknown[]) => mockCreatePending(...args),
  reconcileSubAgentOutcomeMemory: (...args: unknown[]) => mockReconcile(...args),
}));

jest.mock('../../../src/services/memory/verifiedProcedure/executionSession', () => ({
  commitPendingVerifiedProcedureObservation: (...args: unknown[]) =>
    mockCommitPendingVerifiedProcedureObservation(...args),
}));

import type { SubAgentConfig, SubAgentSnapshot } from '../../../src/types/subAgent';
import type { PendingVerifiedProcedureObservation } from '../../../src/services/memory/verifiedProcedure/executionSession';
import type { PersistRegistryBestEffortOutcome } from '../../../src/services/agents/lifecycle/sessionContext';
import {
  finalizeCompletedSubAgentRun,
  finalizeFailedSubAgentRun,
} from '../../../src/services/agents/lifecycle/terminalizePhase';

const MEMORY_LINEAGE = {
  sourceMessageId: 'worker-request-1',
  sourceRunId: 'worker-1',
  sourceTurnId: 'worker-response-1',
  taskId: 'task-1',
} as const;

function makeAgent(): SubAgentSnapshot {
  return {
    sessionId: 'worker-1',
    parentConversationId: 'parent-thread',
    depth: 1,
    startedAt: 1,
    updatedAt: 2,
    status: 'running',
    sandboxPolicy: 'safe-only',
  };
}

function makeConfig(): SubAgentConfig {
  return {
    parentConversationId: 'parent-thread',
    prompt: 'Complete the task.',
    workstreamId: 'task-1',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreatePending.mockImplementation((updatedAt: number) => ({
    status: 'pending',
    code: 'pending',
    attemptCount: 0,
    updatedAt,
  }));
  mockReconcile.mockResolvedValue({
    status: 'completed',
    code: 'recorded_verified',
    attemptCount: 1,
    updatedAt: 10,
    completedAt: 10,
    factIds: ['fact-1'],
  });
  mockCommitPendingVerifiedProcedureObservation.mockResolvedValue({
    status: 'recorded',
    observationId: 'procedure-1',
    prunedCount: 0,
  });
});

function commonParams(agent: SubAgentSnapshot, order: string[]) {
  return {
    sessionId: agent.sessionId,
    depth: agent.depth,
    config: makeConfig(),
    provider: { id: 'test', name: 'Test', provider: 'openai', enabled: true } as any,
    systemPrompt: 'system',
    transcriptMessages: [],
    output: 'Done',
    completionState: 'verified_success' as const,
    toolsUsed: ['write_file'],
    iterations: 2,
    subAgent: agent,
    outputTruncation: 2_000,
    shouldAnnounce: true,
    refreshArtifacts: jest.fn(),
    appendActivity: jest.fn(),
    normalizePreviewText: (text: string) => text,
    terminalMessage: 'Worker failed.',
    maxToolResultPreviewChars: 320,
    signalTerminal: jest.fn(() => order.push('signal-terminal')),
    scheduleSessionContextCheckpoint: jest.fn(),
    persistRegistryBestEffort: jest.fn(async (): Promise<PersistRegistryBestEffortOutcome> => {
      order.push(`persist:${agent.outcomeReconciliation?.status ?? 'missing'}`);
      return { status: 'persisted' as const };
    }),
    scheduleSessionContextEvictionWhenDurable: jest.fn(),
  };
}

describe('terminal worker outcome ordering', () => {
  it('persists the pending receipt before recording a completed worker outcome', async () => {
    const order: string[] = [];
    const agent = makeAgent();
    mockReconcile.mockImplementation(async () => {
      order.push('reconcile');
      return {
        status: 'completed',
        code: 'recorded_verified',
        attemptCount: 1,
        updatedAt: 10,
        completedAt: 10,
        factIds: ['fact-1'],
      };
    });

    await finalizeCompletedSubAgentRun(commonParams(agent, order));

    expect(order).toEqual(['persist:pending', 'reconcile', 'persist:completed', 'signal-terminal']);
    expect(mockReconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        agent,
        config: expect.objectContaining({ workstreamId: 'task-1' }),
        messages: [],
      }),
    );
  });

  it('uses the same persisted receipt boundary for failed worker outcomes', async () => {
    const order: string[] = [];
    const agent = makeAgent();
    mockReconcile.mockImplementation(async () => {
      order.push('reconcile');
      return {
        status: 'completed',
        code: 'recorded_candidate',
        attemptCount: 1,
        updatedAt: 10,
        completedAt: 10,
        factIds: ['fact-1'],
      };
    });

    await finalizeFailedSubAgentRun({
      ...commonParams(agent, order),
      status: 'error',
      error: 'storage unavailable',
      completionState: 'blocked',
    });

    expect(order).toEqual(['persist:pending', 'reconcile', 'persist:completed', 'signal-terminal']);
    expect(agent.status).toBe('error');
  });

  it('commits verified procedure evidence only after the reconciled terminal state is durable', async () => {
    const order: string[] = [];
    const agent = makeAgent();
    const pending = {} as PendingVerifiedProcedureObservation;
    mockReconcile.mockImplementation(async () => {
      order.push('reconcile');
      return {
        status: 'completed',
        code: 'recorded_verified',
        attemptCount: 1,
        updatedAt: 10,
        completedAt: 10,
        factIds: ['fact-1'],
      };
    });
    mockCommitPendingVerifiedProcedureObservation.mockImplementation(async () => {
      order.push('procedure-commit');
      return { status: 'recorded', observationId: 'procedure-1', prunedCount: 0 };
    });

    await finalizeCompletedSubAgentRun({
      ...commonParams(agent, order),
      pendingVerifiedProcedureCommit: {
        memoryLineage: MEMORY_LINEAGE,
        observation: pending,
      },
    });

    expect(order).toEqual([
      'persist:pending',
      'reconcile',
      'persist:completed',
      'procedure-commit',
      'signal-terminal',
    ]);
    expect(mockCommitPendingVerifiedProcedureObservation).toHaveBeenCalledWith({
      memoryLineage: MEMORY_LINEAGE,
      pending,
      surface: 'subagent',
      terminalObservedAt: expect.any(Number),
    });
  });

  it.each(['blocked', 'incomplete'] as const)(
    'does not commit a %s completed worker as verified procedure evidence',
    async (completionState) => {
      const order: string[] = [];
      const agent = makeAgent();

      await finalizeCompletedSubAgentRun({
        ...commonParams(agent, order),
        completionState,
        pendingVerifiedProcedureCommit: {
          memoryLineage: MEMORY_LINEAGE,
          observation: {} as PendingVerifiedProcedureObservation,
        },
      });

      expect(mockCommitPendingVerifiedProcedureObservation).not.toHaveBeenCalled();
    },
  );

  it('rejects procedure settlement when reconciled terminal persistence fails', async () => {
    const order: string[] = [];
    const agent = makeAgent();
    const params = commonParams(agent, order);
    params.persistRegistryBestEffort
      .mockResolvedValueOnce({ status: 'persisted' })
      .mockResolvedValueOnce({ status: 'failed' });

    await finalizeCompletedSubAgentRun({
      ...params,
      pendingVerifiedProcedureCommit: {
        memoryLineage: MEMORY_LINEAGE,
        observation: {} as PendingVerifiedProcedureObservation,
      },
    });

    expect(mockCommitPendingVerifiedProcedureObservation).not.toHaveBeenCalled();
  });

  it('waits for timed-out terminal persistence to become durable before committing', async () => {
    const order: string[] = [];
    const agent = makeAgent();
    let resolvePersistence!: (persisted: boolean) => void;
    const completion = new Promise<boolean>((resolve) => {
      resolvePersistence = resolve;
    });
    const params = commonParams(agent, order);
    params.persistRegistryBestEffort
      .mockResolvedValueOnce({ status: 'persisted' })
      .mockResolvedValueOnce({ status: 'timed-out', completion });

    await finalizeCompletedSubAgentRun({
      ...params,
      pendingVerifiedProcedureCommit: {
        memoryLineage: MEMORY_LINEAGE,
        observation: {} as PendingVerifiedProcedureObservation,
      },
    });
    expect(mockCommitPendingVerifiedProcedureObservation).not.toHaveBeenCalled();

    resolvePersistence(true);
    await completion;
    await Promise.resolve();

    expect(mockCommitPendingVerifiedProcedureObservation).toHaveBeenCalledTimes(1);
  });

  it('does not commit when timed-out terminal persistence eventually fails', async () => {
    const order: string[] = [];
    const agent = makeAgent();
    const params = commonParams(agent, order);
    params.persistRegistryBestEffort
      .mockResolvedValueOnce({ status: 'persisted' })
      .mockResolvedValueOnce({ status: 'timed-out', completion: Promise.resolve(false) });

    await finalizeCompletedSubAgentRun({
      ...params,
      pendingVerifiedProcedureCommit: {
        memoryLineage: MEMORY_LINEAGE,
        observation: {} as PendingVerifiedProcedureObservation,
      },
    });
    await Promise.resolve();

    expect(mockCommitPendingVerifiedProcedureObservation).not.toHaveBeenCalled();
  });
});
