import {
  getOutstandingSpawnedSubAgentCount,
  resolveTerminalBackgroundReviewCandidate,
  selectTerminalBackgroundReviewCandidates,
} from '../../src/engine/graph/terminalBackgroundReviewEligibility';
import type { AgentRun } from '../../src/types/agentRun';
import type { Conversation } from '../../src/types/conversation';
import type { SubAgentSnapshot } from '../../src/types/subAgent';

function snapshot(
  status: SubAgentSnapshot['status'],
  overrides?: Partial<SubAgentSnapshot>,
): SubAgentSnapshot {
  return {
    sessionId: `sub-${status}`,
    parentConversationId: 'conv-1',
    depth: 0,
    startedAt: 1,
    updatedAt: 2,
    status,
    sandboxPolicy: 'inherit',
    ...overrides,
  };
}

function run(overrides?: Partial<AgentRun>): AgentRun {
  return {
    id: 'run-1',
    status: 'running',
    createdAt: 1,
    updatedAt: 10,
    userMessageId: 'user-1',
    summary: { spawnedSubAgents: 1 },
    controlGraph: {
      version: 1,
      status: 'ready',
      iteration: 1,
      expectedToolCalls: [],
      observedToolResults: [],
      pendingAsyncCount: 0,
      lastModelToolNames: [],
      asyncWork: {
        awaitingBackgroundWorkers: true,
        pendingOperations: [],
        updatedAt: 10,
      },
      performance: {
        modelTurnCount: 0,
        modelDurationMs: 0,
        toolExecutionCount: 0,
        toolExecutionDurationMs: 0,
        lastCandidateToolCount: 0,
        lastActiveToolCount: 0,
        maxActiveToolCount: 0,
        lastActiveToolTokenEstimate: 0,
        maxActiveToolTokenEstimate: 0,
        updatedAt: 10,
      },
      turnDirectives: {
        forceFinalText: false,
        requireWorkflowTool: false,
        incompleteFinalTextRecoveryCount: 0,
      },
      audit: [],
      updatedAt: 10,
    },
    ...overrides,
  } as AgentRun;
}

describe('terminal background review eligibility', () => {
  it('does not treat blocked spawn attempts as phantom outstanding workers', () => {
    expect(
      getOutstandingSpawnedSubAgentCount({
        recordedSpawnedSubAgents: 2,
        liveSnapshots: [],
        mergedSnapshots: [snapshot('completed')],
      }),
    ).toBe(0);
  });

  it('keeps a propagation fallback when no worker snapshot exists yet', () => {
    expect(
      getOutstandingSpawnedSubAgentCount({
        recordedSpawnedSubAgents: 1,
        liveSnapshots: [],
        mergedSnapshots: [],
      }),
    ).toBe(1);
  });

  it('selects a review candidate only after tracked background workers are terminal', () => {
    const candidate = resolveTerminalBackgroundReviewCandidate({
      conversation: { id: 'conv-1' },
      run: run(),
      workers: {
        liveSnapshots: [],
        mergedSnapshots: [snapshot('completed', { updatedAt: 25 })],
        hasOrphanedRunningSnapshots: false,
      },
    });

    expect(candidate).toEqual({
      conversationId: 'conv-1',
      runId: 'run-1',
      timestamp: 25,
    });
  });

  it('keeps review blocked while live or orphaned workers are still running', () => {
    const activeRun = run();

    expect(
      resolveTerminalBackgroundReviewCandidate({
        conversation: { id: 'conv-1' },
        run: activeRun,
        workers: {
          liveSnapshots: [snapshot('running')],
          mergedSnapshots: [snapshot('running')],
          hasOrphanedRunningSnapshots: false,
        },
      }),
    ).toBeUndefined();

    expect(
      resolveTerminalBackgroundReviewCandidate({
        conversation: { id: 'conv-1' },
        run: activeRun,
        workers: {
          liveSnapshots: [],
          mergedSnapshots: [snapshot('running')],
          hasOrphanedRunningSnapshots: true,
        },
      }),
    ).toBeUndefined();
  });

  it('lets the screen enqueue graph-selected candidates without owning eligibility rules', () => {
    const conversation = {
      id: 'conv-1',
      messages: [],
      agentRuns: [run()],
    } as Conversation;

    expect(
      selectTerminalBackgroundReviewCandidates({
        conversations: [conversation],
        getReviewableWorkers: () => ({
          liveSnapshots: [],
          mergedSnapshots: [snapshot('completed', { updatedAt: 30 })],
          hasOrphanedRunningSnapshots: false,
        }),
      }),
    ).toEqual([{ conversationId: 'conv-1', runId: 'run-1', timestamp: 30 }]);
  });
});
