const mockCreatePending = jest.fn();
const mockReconcile = jest.fn();

jest.mock('../../../src/services/agents/subAgentOutcomeReconciliation', () => ({
  createPendingSubAgentOutcomeReconciliation: (...args: unknown[]) => mockCreatePending(...args),
  reconcileSubAgentOutcomeMemory: (...args: unknown[]) => mockReconcile(...args),
}));

import type { SubAgentConfig, SubAgentSnapshot } from '../../../src/types/subAgent';
import type { PersistRegistryBestEffortOutcome } from '../../../src/services/agents/lifecycle/sessionContext';
import {
  finalizeCompletedSubAgentRun,
  finalizeFailedSubAgentRun,
} from '../../../src/services/agents/lifecycle/terminalizePhase';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

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
    expect(agent.terminationCause).toBe('completed');
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
      terminationCause: 'internal_failure',
      error: 'storage unavailable',
      completionState: 'blocked',
    });

    expect(order).toEqual(['persist:pending', 'reconcile', 'persist:completed', 'signal-terminal']);
    expect(agent.status).toBe('error');
    expect(agent.terminationCause).toBe('internal_failure');
  });

  it('never splits a grapheme cluster when the outputTruncation cut lands inside a probe', async () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const order: string[] = [];
      const agent = makeAgent();
      const output = `${'o'.repeat(1990)}${probe.repeat(15)}`;

      await finalizeCompletedSubAgentRun({
        ...commonParams(agent, order),
        output,
        outputTruncation: 2_000,
      });

      expectGraphemeSafe(agent.output ?? '');
    }
  });
});
