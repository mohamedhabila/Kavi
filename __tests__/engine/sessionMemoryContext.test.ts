const mockCaptureMemoryAuthoritySnapshot = jest.fn();
const mockIsMemoryProjectionSnapshotDurablyCurrent = jest.fn();
const mockCaptureMemoryReadEpoch = jest.fn();
const mockGetMemoryPolicyEpoch = jest.fn();

jest.mock('../../src/services/memory/memoryAuthority', () => ({
  captureMemoryAuthoritySnapshot: (...args: unknown[]) =>
    mockCaptureMemoryAuthoritySnapshot(...args),
  isMemoryProjectionSnapshotDurablyCurrent: (...args: unknown[]) =>
    mockIsMemoryProjectionSnapshotDurablyCurrent(...args),
}));

jest.mock('../../src/services/memory/policy', () => ({
  captureMemoryReadEpoch: (...args: unknown[]) => mockCaptureMemoryReadEpoch(...args),
  getMemoryPolicyEpoch: (...args: unknown[]) => mockGetMemoryPolicyEpoch(...args),
}));

import {
  admitSessionMemoryContext,
  createDegradedSessionMemoryAccessCandidate,
  isAdmittedSessionMemoryContextFresh,
} from '../../src/engine/graph/sessionMemoryContext';

const authoritySnapshot = {
  processEpochs: { restrictive: 4, projection: 9 },
  restrictiveRevision: { kind: 'restrictive', memoryOwnerId: 'owner', value: 3 },
  projectionRevision: { kind: 'projection', memoryOwnerId: 'owner', value: 8 },
  policy: { enabled: true, revision: 2 },
} as const;

const noJobBarrier = {
  outcome: 'no_job' as const,
  durationMs: 0,
  waitedMs: 0,
  queryCount: 1,
  matchedJobCount: 0 as const,
  queueAgeMs: null,
  initialJobStatus: null,
  finalJobStatus: null,
};

function livingMemory(validUntil?: number) {
  return {
    sections: [{ text: '好きな色は緑です。' }],
    cacheableSignature: 'signature',
    focusBlockText: 'المهمة الحالية',
    openThreadLabels: [],
    recalledFactCount: 1,
    recalledEpisodeCount: 0,
    applicabilityPolicy: {
      policyVersion: 1,
      enabled: true,
      consideredFactCount: 1,
      promptVisibleFactCount: 1,
      promptBudgetDroppedFactCount: 0,
      actionCounts: { use: 1, clarify: 0, verify: 0, silent: 0 },
      reasonCounts: {},
    },
    memoryAuthoritySnapshot: authoritySnapshot,
    ...(validUntil === undefined ? {} : { validUntil }),
  } as const;
}

describe('session memory context', () => {
  beforeEach(() => {
    mockCaptureMemoryAuthoritySnapshot.mockReset().mockReturnValue(null);
    mockIsMemoryProjectionSnapshotDurablyCurrent.mockReset().mockReturnValue(true);
    mockCaptureMemoryReadEpoch.mockReset().mockReturnValue(4);
    mockGetMemoryPolicyEpoch.mockReset().mockReturnValue(7);
  });

  it('admits one exact retrieved projection without interpreting its language', () => {
    const memory = livingMemory();
    const context = admitSessionMemoryContext({
      consistencyBarrier: noJobBarrier,
      livingMemory: memory,
    });

    expect(context).toMatchObject({
      admission: 'admitted',
      authoritySnapshot,
      livingMemory: memory,
      policyEpoch: 7,
    });
    expect(isAdmittedSessionMemoryContextFresh(context)).toBe(true);
    expect(mockIsMemoryProjectionSnapshotDurablyCurrent).toHaveBeenCalledWith(authoritySnapshot);
  });

  it('rejects unbound retrieved content into one truthful degraded context', () => {
    mockCaptureMemoryAuthoritySnapshot.mockReturnValue(authoritySnapshot);
    const memory = { ...livingMemory(), memoryAuthoritySnapshot: undefined };

    const context = admitSessionMemoryContext({
      consistencyBarrier: noJobBarrier,
      livingMemory: memory as never,
    });

    expect(context.admission).toBe('degraded');
    expect(context.livingMemory).toBeNull();
    expect(context.consistencyBarrier.outcome).toBe('degraded');
    expect(context.authoritySnapshot).toBe(authoritySnapshot);
  });

  it('keeps an authority-unavailable retrieval failure stable for the session', () => {
    const context = admitSessionMemoryContext(createDegradedSessionMemoryAccessCandidate());

    expect(isAdmittedSessionMemoryContextFresh(context)).toBe(true);
    expect(mockIsMemoryProjectionSnapshotDurablyCurrent).not.toHaveBeenCalled();
  });

  it('refreshes an admitted context when its projection changes', () => {
    mockIsMemoryProjectionSnapshotDurablyCurrent.mockReturnValue(false);
    const context = admitSessionMemoryContext({
      consistencyBarrier: noJobBarrier,
      livingMemory: livingMemory(),
    });

    expect(isAdmittedSessionMemoryContextFresh(context)).toBe(false);
  });

  it('refreshes before an admitted memory projection reaches its exact expiry', () => {
    const context = admitSessionMemoryContext({
      consistencyBarrier: noJobBarrier,
      livingMemory: livingMemory(900),
    });

    expect(isAdmittedSessionMemoryContextFresh(context, 899)).toBe(true);
    expect(isAdmittedSessionMemoryContextFresh(context, 900)).toBe(false);
  });

  it('keeps opt-out stable only while memory remains disabled', () => {
    const context = admitSessionMemoryContext({
      consistencyBarrier: { ...noJobBarrier, outcome: 'opt_out' },
      livingMemory: null,
    });

    mockCaptureMemoryReadEpoch.mockReturnValue(null);
    expect(isAdmittedSessionMemoryContextFresh(context)).toBe(true);
    mockCaptureMemoryReadEpoch.mockReturnValue(8);
    expect(isAdmittedSessionMemoryContextFresh(context)).toBe(false);
  });
});
