import type { Message, SubAgentSnapshot } from '../../src/types';
import {
  cloneSubAgentSnapshot,
  collectSubAgentSnapshotsFromMessages,
  getSubAgentsForConversation,
  getSubAgentsForAgentRun,
  getLatestFinalAssistantResponsePreview,
  hasDeliveredFinalAssistantResponse,
  resolveOwningConversationId,
  resolveAgentRunIdForSubAgent,
  resolveDisplayedSubAgentSnapshot,
  summarizeBackgroundWorkerRunOutcome,
} from '../../src/services/agents/workflowState';

function makeSnapshot(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    sessionId: 'sub-1',
    parentConversationId: 'conv-1',
    depth: 0,
    startedAt: 1700000000000,
    updatedAt: 1700000000100,
    status: 'running',
    sandboxPolicy: 'inherit',
    ...overrides,
  };
}

describe('resolveDisplayedSubAgentSnapshot', () => {
  it('clones nested snapshot fields without retaining shared references', () => {
    const originalSnapshot = makeSnapshot({
      toolsUsed: ['read_file'],
      activityLog: [{ timestamp: 1, kind: 'status', text: 'Started' }],
      artifacts: [
        {
          id: 'artifact-1',
          type: 'image',
          uri: 'file:///mock/documents/workspace/conv-1/generated.png',
          name: 'generated.png',
          mimeType: 'image/png',
          size: 1024,
          workspacePath: 'generated.png',
        },
      ],
    });

    const clonedSnapshot = cloneSubAgentSnapshot(originalSnapshot);

    expect(clonedSnapshot).toEqual(originalSnapshot);
    expect(clonedSnapshot).not.toBe(originalSnapshot);
    expect(clonedSnapshot.toolsUsed).not.toBe(originalSnapshot.toolsUsed);
    expect(clonedSnapshot.artifacts).not.toBe(originalSnapshot.artifacts);
    expect(clonedSnapshot.artifacts?.[0]).not.toBe(originalSnapshot.artifacts?.[0]);
    expect(clonedSnapshot.activityLog).not.toBe(originalSnapshot.activityLog);
    expect(clonedSnapshot.activityLog?.[0]).not.toBe(originalSnapshot.activityLog?.[0]);
  });

  it('keeps a terminal transcript snapshot when the live registry is stale and still running', () => {
    const persistedSnapshot = makeSnapshot({
      status: 'completed',
      updatedAt: 1700000000200,
      output: 'Worker finished successfully.',
    });
    const liveSnapshot = makeSnapshot({
      status: 'running',
      updatedAt: 1700000000150,
      currentActivity: 'Reading repository files',
      activeToolName: 'read_file',
    });

    const resolvedSnapshot = resolveDisplayedSubAgentSnapshot(persistedSnapshot, liveSnapshot);

    expect(resolvedSnapshot.status).toBe('completed');
    expect(resolvedSnapshot.output).toBe('Worker finished successfully.');
    expect(resolvedSnapshot.currentActivity).toBeUndefined();
    expect(resolvedSnapshot.activeToolName).toBeUndefined();
  });

  it('preserves terminal worker artifacts when resolving persisted and live snapshots', () => {
    const persistedSnapshot = makeSnapshot({
      status: 'completed',
      updatedAt: 1700000000200,
      artifacts: [
        {
          id: 'artifact-1',
          type: 'image',
          uri: 'file:///mock/documents/workspace/conv-1/generated.png',
          name: 'generated.png',
          mimeType: 'image/png',
          size: 1024,
          workspacePath: 'generated.png',
        },
      ],
    });
    const liveSnapshot = makeSnapshot({
      status: 'running',
      updatedAt: 1700000000150,
      currentActivity: 'Still working',
    });

    const resolvedSnapshot = resolveDisplayedSubAgentSnapshot(persistedSnapshot, liveSnapshot);

    expect(resolvedSnapshot.artifacts).toEqual([
      expect.objectContaining({
        id: 'artifact-1',
        workspacePath: 'generated.png',
      }),
    ]);
  });

  it('promotes a terminal live snapshot over a stale running transcript snapshot', () => {
    const persistedSnapshot = makeSnapshot({
      status: 'running',
      updatedAt: 1700000000100,
      currentActivity: 'Waiting for tool output',
    });
    const liveSnapshot = makeSnapshot({
      status: 'completed',
      updatedAt: 1700000000300,
      output: 'Recovered live completion.',
    });

    const resolvedSnapshot = resolveDisplayedSubAgentSnapshot(persistedSnapshot, liveSnapshot);

    expect(resolvedSnapshot.status).toBe('completed');
    expect(resolvedSnapshot.output).toBe('Recovered live completion.');
  });
});

describe('getSubAgentsForAgentRun', () => {
  it('resolves nested worker ownership back to the parent conversation', () => {
    const workers = [
      makeSnapshot({ sessionId: 'sub-root', parentConversationId: 'conv-1', status: 'running' }),
      makeSnapshot({
        sessionId: 'sub-child',
        parentConversationId: 'sub-root',
        parentSessionId: 'sub-root',
        status: 'running',
      }),
      makeSnapshot({
        sessionId: 'sub-unrelated',
        parentConversationId: 'conv-2',
        status: 'running',
      }),
    ];

    expect(resolveOwningConversationId('sub-child', workers)).toBe('conv-1');
    expect(
      getSubAgentsForConversation('conv-1', workers).map((worker) => worker.sessionId),
    ).toEqual(['sub-root', 'sub-child']);
  });

  it('reuses the shared fallback agent-run resolver for orphan workers', () => {
    const runId = resolveAgentRunIdForSubAgent(
      {
        id: 'conv-1',
        activeAgentRunId: 'run-1',
        agentRuns: [
          { id: 'run-1', status: 'running' },
          { id: 'run-2', status: 'running' },
        ] as any,
      },
      makeSnapshot({ sessionId: 'sub-fallback', status: 'running' }),
    );

    expect(runId).toBe('run-1');
  });

  it('pins orphan worker lifecycle events to the run that owned the original worker start time', () => {
    const runId = resolveAgentRunIdForSubAgent(
      {
        id: 'conv-1',
        activeAgentRunId: 'run-2',
        agentRuns: [
          {
            id: 'run-1',
            status: 'cancelled',
            createdAt: 10,
            updatedAt: 40,
            completedAt: 40,
          },
          {
            id: 'run-2',
            status: 'running',
            createdAt: 50,
            updatedAt: 60,
          },
        ] as any,
      },
      makeSnapshot({
        sessionId: 'sub-old-run-worker',
        startedAt: 20,
        updatedAt: 55,
        status: 'cancelled',
      }),
    );

    expect(runId).toBe('run-1');
  });

  it('matches workers without an agentRunId to the active running run as a fallback', () => {
    const workers = [
      makeSnapshot({ sessionId: 'sub-1', status: 'running' }),
      makeSnapshot({ sessionId: 'sub-2', parentConversationId: 'conv-2', status: 'running' }),
      makeSnapshot({ sessionId: 'sub-3', agentRunId: 'run-2', status: 'running' }),
    ];

    const matchedWorkers = getSubAgentsForAgentRun(
      {
        id: 'conv-1',
        activeAgentRunId: 'run-1',
        agentRuns: [
          { id: 'run-1', status: 'running' },
          { id: 'run-2', status: 'running' },
        ] as any,
      },
      'run-1',
      workers,
    );

    expect(matchedWorkers.map((worker) => worker.sessionId)).toEqual(['sub-1']);
  });

  it('matches nested workers whose conversation ownership resolves through a parent session', () => {
    const workers = [
      makeSnapshot({ sessionId: 'sub-root', parentConversationId: 'conv-1', status: 'running' }),
      makeSnapshot({
        sessionId: 'sub-child',
        parentConversationId: 'sub-root',
        parentSessionId: 'sub-root',
        status: 'running',
      }),
      makeSnapshot({ sessionId: 'sub-other', parentConversationId: 'conv-2', status: 'running' }),
    ];

    const matchedWorkers = getSubAgentsForAgentRun(
      {
        id: 'conv-1',
        activeAgentRunId: 'run-1',
        agentRuns: [{ id: 'run-1', status: 'running' }] as any,
      },
      'run-1',
      workers,
    );

    expect(matchedWorkers.map((worker) => worker.sessionId)).toEqual(['sub-root', 'sub-child']);
  });
});

describe('collectSubAgentSnapshotsFromMessages', () => {
  it('retains transcript-only descendants using the latest snapshot for each session', () => {
    const messages: Message[] = [
      {
        id: 'msg-root-started',
        role: 'assistant',
        content: 'Planner started.',
        timestamp: 1,
        subAgentEvent: {
          type: 'sub-agent',
          event: 'started',
          snapshot: makeSnapshot({
            sessionId: 'sub-root',
            status: 'running',
            updatedAt: 1,
            name: 'Planner',
          }),
        },
      },
      {
        id: 'msg-child-started',
        role: 'assistant',
        content: 'Implementer started.',
        timestamp: 2,
        subAgentEvent: {
          type: 'sub-agent',
          event: 'started',
          snapshot: makeSnapshot({
            sessionId: 'sub-child',
            parentConversationId: 'conv-1',
            parentSessionId: 'sub-root',
            status: 'running',
            updatedAt: 2,
            name: 'Implementer',
          }),
        },
      },
      {
        id: 'msg-child-completed',
        role: 'assistant',
        content: 'Implementer completed.',
        timestamp: 3,
        subAgentEvent: {
          type: 'sub-agent',
          event: 'completed',
          snapshot: makeSnapshot({
            sessionId: 'sub-child',
            parentConversationId: 'conv-1',
            parentSessionId: 'sub-root',
            status: 'completed',
            updatedAt: 3,
            name: 'Implementer',
            output: 'Verified the implementation.',
          }),
        },
      },
    ];

    const snapshots = collectSubAgentSnapshotsFromMessages(messages);
    const childSnapshot = snapshots.find((snapshot) => snapshot.sessionId === 'sub-child');

    expect(snapshots.map((snapshot) => snapshot.sessionId)).toEqual(['sub-root', 'sub-child']);
    expect(childSnapshot).toEqual(
      expect.objectContaining({
        status: 'completed',
        output: 'Verified the implementation.',
        parentSessionId: 'sub-root',
      }),
    );
  });
});

describe('final assistant response helpers', () => {
  it('detects a final assistant response after tool and worker activity', () => {
    const messages: Message[] = [
      {
        id: 'msg-user',
        role: 'user',
        content: 'Finish the task',
        timestamp: 1,
      },
      {
        id: 'msg-assistant-plan',
        role: 'assistant',
        content: 'I will inspect the repo first.',
        timestamp: 2,
        toolCalls: [
          {
            id: 'tc-1',
            name: 'read_file',
            arguments: '{"path":"src/index.ts"}',
            status: 'completed',
          },
        ],
      },
      {
        id: 'msg-tool',
        role: 'tool',
        content: 'Tool output',
        toolCallId: 'tc-1',
        timestamp: 3,
      },
      {
        id: 'msg-worker',
        role: 'assistant',
        content: 'Worker finished.',
        timestamp: 4,
        subAgentEvent: {
          type: 'sub-agent',
          event: 'completed',
          snapshot: makeSnapshot({ status: 'completed', updatedAt: 4 }),
        },
      },
      {
        id: 'msg-final',
        role: 'assistant',
        content: 'The task is complete and verified.',
        timestamp: 5,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      },
    ];

    expect(hasDeliveredFinalAssistantResponse(messages, 'msg-user')).toBe(true);
    expect(getLatestFinalAssistantResponsePreview(messages, 'msg-user')).toBe(
      'The task is complete and verified.',
    );
  });

  it('does not treat pre-tool planning text as the delivered final response', () => {
    const messages: Message[] = [
      {
        id: 'msg-user',
        role: 'user',
        content: 'Finish the task',
        timestamp: 1,
      },
      {
        id: 'msg-assistant-plan',
        role: 'assistant',
        content: 'I am launching a worker.',
        timestamp: 2,
        assistantMetadata: {
          kind: 'intermediate',
          completionStatus: 'complete',
        },
      },
      {
        id: 'msg-worker',
        role: 'assistant',
        content: 'Worker started.',
        timestamp: 3,
        subAgentEvent: {
          type: 'sub-agent',
          event: 'started',
          snapshot: makeSnapshot({ status: 'running', updatedAt: 3 }),
        },
      },
    ];

    expect(hasDeliveredFinalAssistantResponse(messages, 'msg-user')).toBe(false);
    expect(getLatestFinalAssistantResponsePreview(messages, 'msg-user')).toBeUndefined();
  });

  it('ignores incomplete final assistant text when deciding whether a run delivered an answer', () => {
    const messages: Message[] = [
      {
        id: 'msg-user',
        role: 'user',
        content: 'Finish the task',
        timestamp: 1,
      },
      {
        id: 'msg-assistant-plan',
        role: 'assistant',
        content: 'I am checking the repository state.',
        timestamp: 2,
        toolCalls: [
          {
            id: 'tc-1',
            name: 'read_file',
            arguments: '{"path":"src/index.ts"}',
            status: 'completed',
          },
        ],
        assistantMetadata: {
          kind: 'intermediate',
          completionStatus: 'complete',
        },
      },
      {
        id: 'msg-final-incomplete',
        role: 'assistant',
        content: 'The task is almost comp',
        timestamp: 3,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'network_interruption',
        },
      },
    ];

    expect(hasDeliveredFinalAssistantResponse(messages, 'msg-user')).toBe(false);
    expect(getLatestFinalAssistantResponsePreview(messages, 'msg-user')).toBeUndefined();
  });

  it('ignores max-iterations placeholders when deciding whether a run delivered an answer', () => {
    const messages: Message[] = [
      {
        id: 'msg-user',
        role: 'user',
        content: 'Finish the task',
        timestamp: 1,
      },
      {
        id: 'msg-final-placeholder',
        role: 'assistant',
        content:
          "I've reached the maximum number of tool iterations. Here's what I've accomplished so far with the tools I've used.",
        timestamp: 2,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'max_iterations',
        },
      },
    ];

    expect(hasDeliveredFinalAssistantResponse(messages, 'msg-user')).toBe(false);
    expect(getLatestFinalAssistantResponsePreview(messages, 'msg-user')).toBeUndefined();
  });
});

describe('summarizeBackgroundWorkerRunOutcome', () => {
  it('returns failed when any worker fails', () => {
    const outcome = summarizeBackgroundWorkerRunOutcome([
      makeSnapshot({ status: 'completed' }),
      makeSnapshot({ sessionId: 'sub-2', status: 'error' }),
    ]);

    expect(outcome).toEqual({
      status: 'failed',
      summary: 'Background work finished with at least one failed worker.',
    });
  });

  it('returns completed when all workers complete cleanly', () => {
    const outcome = summarizeBackgroundWorkerRunOutcome([
      makeSnapshot({ status: 'completed' }),
      makeSnapshot({ sessionId: 'sub-2', status: 'completed' }),
    ]);

    expect(outcome).toEqual({
      status: 'completed',
      summary: 'All background workers finished.',
    });
  });
});
