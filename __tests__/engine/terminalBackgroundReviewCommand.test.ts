import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import { resolveAgentControlGraphTerminalBackgroundReviewCommand } from '../../src/engine/graph/terminalBackgroundReviewCommand';
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
    controlGraph: createInitialAgentControlGraphSnapshot({
      asyncWork: {
        awaitingBackgroundWorkers: true,
        pendingOperations: [],
        updatedAt: 10,
      },
    }),
    ...overrides,
  } as AgentRun;
}

function conversation(agentRun: AgentRun): Conversation {
  return {
    id: 'conv-1',
    title: 'Conversation',
    mode: 'agent',
    messages: [{ id: 'user-1', role: 'user', content: 'Do work', timestamp: 1 }],
    createdAt: 1,
    updatedAt: 10,
    agentRuns: [agentRun],
  } as Conversation;
}

describe('terminal background review command', () => {
  it('does not start review while a live worker is still running', () => {
    const command = resolveAgentControlGraphTerminalBackgroundReviewCommand({
      conversation: conversation(run()),
      runId: 'run-1',
      workers: {
        liveSnapshots: [snapshot('running')],
        mergedSnapshots: [snapshot('running')],
        hasOrphanedRunningSnapshots: false,
      },
      timestamp: 20,
      canResume: true,
    });

    expect(command).toEqual({ type: 'none' });
  });

  it('selects finalize review when background workers are terminal', () => {
    const command = resolveAgentControlGraphTerminalBackgroundReviewCommand({
      conversation: conversation(run()),
      runId: 'run-1',
      workers: {
        liveSnapshots: [],
        mergedSnapshots: [
          snapshot('completed', {
            toolsUsed: ['sessions_spawn'],
            completionState: 'verified_success',
            output: 'Worker completed the delegated task.',
          }),
        ],
        hasOrphanedRunningSnapshots: false,
      },
      timestamp: 20,
      canResume: true,
    });

    expect(command.type).toBe('finalize');
    expect(command.type === 'finalize' ? command.context.candidateStatus : undefined).toBe(
      'completed',
    );
    expect(command.type === 'finalize' ? command.context.candidateSummary : undefined).toBe(
      'All background workers finished.',
    );
  });
});
