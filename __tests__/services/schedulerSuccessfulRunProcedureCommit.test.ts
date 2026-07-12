const mockPersistAttemptMutation = jest.fn();
const mockScheduleAmbiguousSettlementRecovery = jest.fn();
const mockCommitPendingVerifiedProcedureObservation = jest.fn();

jest.mock('../../src/services/scheduler/attemptRecovery', () => ({
  persistAttemptMutation: (...args: unknown[]) => mockPersistAttemptMutation(...args),
  scheduleAmbiguousSettlementRecovery: (...args: unknown[]) =>
    mockScheduleAmbiguousSettlementRecovery(...args),
}));
jest.mock('../../src/services/scheduler/activeSchedulerEvent', () => ({
  emitActiveSchedulerEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/scheduler/terminalReportProcessor', () => ({
  drainSchedulerTerminalReports: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/memory/verifiedProcedure/executionSession', () => ({
  commitPendingVerifiedProcedureObservation: (...args: unknown[]) =>
    mockCommitPendingVerifiedProcedureObservation(...args),
}));

import { settleSuccessfulScheduledRun } from '../../src/services/scheduler/successfulRunSettlement';
import type { PendingVerifiedProcedureObservation } from '../../src/services/memory/verifiedProcedure/executionSession';

function params() {
  const pending = Object.freeze({}) as PendingVerifiedProcedureObservation;
  const memoryLineage = {
    sourceMessageId: 'scheduled:occurrence-1:user',
    sourceRunId: 'attempt-1',
    sourceTurnId: 'scheduled-final-assistant-1',
    taskId: 'attempt-1',
  } as const;
  const recordRun = jest.fn().mockReturnValue(true);
  const store = {
    getJob: jest.fn().mockReturnValue(undefined),
    recordRun,
    restoreJobAttemptClaim: jest.fn(),
  };
  const job = {
    id: 'job-1',
    name: 'Calendar follow-up',
    schedule: { kind: 'interval', intervalMs: 60_000 },
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    definitionRevision: 1,
    payload: { prompt: 'Create the event.' },
  };
  return {
    memoryLineage,
    pending,
    recordRun,
    value: {
      store,
      job,
      result: {
        output: 'Created.',
        conversationId: 'scheduled-conversation',
        pendingVerifiedProcedureCommit: { observation: pending, memoryLineage },
      },
      attemptId: 'attempt-1',
      attempt: 1,
      claimedAtMs: 10,
      startedAtMs: 20,
      completedAtMs: 30,
      trigger: 'timer',
    } as never,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCommitPendingVerifiedProcedureObservation.mockResolvedValue({ status: 'recorded' });
});

describe('scheduled verified procedure commit authority', () => {
  it('commits only after terminal scheduler state persistence succeeds', async () => {
    const ordering: string[] = [];
    mockPersistAttemptMutation.mockImplementation(async (mutate: () => boolean) => {
      ordering.push('mutation');
      expect(mutate()).toBe(true);
      ordering.push('persisted');
      return { status: 'persisted' };
    });
    mockCommitPendingVerifiedProcedureObservation.mockImplementation(async () => {
      ordering.push('procedure-commit');
      return { status: 'recorded' };
    });
    const { memoryLineage, pending, value } = params();

    await expect(settleSuccessfulScheduledRun(value)).resolves.toMatchObject({
      status: 'succeeded',
    });

    expect(ordering).toEqual(['mutation', 'persisted', 'procedure-commit']);
    expect(mockCommitPendingVerifiedProcedureObservation).toHaveBeenCalledWith({
      memoryLineage,
      pending,
      surface: 'scheduler',
      terminalObservedAt: expect.any(Number),
    });
  });

  it('does not commit when terminal scheduler persistence is ambiguous', async () => {
    mockPersistAttemptMutation.mockResolvedValue({
      status: 'persistence_failed',
      error: new Error('disk unavailable'),
    });
    const { value } = params();

    await expect(settleSuccessfulScheduledRun(value)).resolves.toMatchObject({
      status: 'failed',
    });

    expect(mockCommitPendingVerifiedProcedureObservation).not.toHaveBeenCalled();
    expect(mockScheduleAmbiguousSettlementRecovery).toHaveBeenCalledTimes(1);
  });
});
