import type { Message } from '../../src/types/message';
import type { SubAgentSnapshot } from '../../src/types/subAgent';
import {
  cloneSubAgentSnapshot,
  collectSubAgentSnapshotsFromMessages,
  getSubAgentsForConversation,
  getSubAgentsForAgentRun,
  resolveOwningConversationId,
  resolveAgentRunIdForSubAgent,
  resolveDisplayedSubAgentSnapshot,
} from '../../src/services/agents/lifecycle/stateMachine';
import {
  getLatestFinalAssistantResponsePreview,
  hasDeliveredFinalAssistantResponse,
  getAgentRunMessageSlice,
  summarizeBackgroundWorkerRunOutcome,
} from '../../src/services/agents/lifecycle/agentRunStateMachine';

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

describe('getAgentRunMessageSlice', () => {
  it('returns an empty slice when the user message anchor does not exist', () => {
    const messages: Message[] = [
      { id: 'a1', role: 'assistant', content: 'hello', timestamp: 1 },
      { id: 'u1', role: 'user', content: 'first request', timestamp: 2 },
      { id: 'a2', role: 'assistant', content: 'response', timestamp: 3 },
    ];

    expect(getAgentRunMessageSlice(messages, 'missing')).toEqual([]);
  });

  it('slices the run transcript from the anchored user message to the next user message', () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'first request', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'ok', timestamp: 2 },
      { id: 'u2', role: 'user', content: 'next request', timestamp: 3 },
      { id: 'a2', role: 'assistant', content: 'later', timestamp: 4 },
    ];

    expect(getAgentRunMessageSlice(messages, 'u2')).toEqual([messages[2], messages[3]]);
  });

  it('includes internal system continuation messages before the next user boundary', () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'Initial request', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'working...', timestamp: 2 },
      {
        id: 'i1',
        role: 'system',
        content: 'Continue the same user-visible answer without replacing it.',
        timestamp: 3,
      },
      { id: 'a2', role: 'assistant', content: 'partial update', timestamp: 4 },
      { id: 'u2', role: 'user', content: 'new user turn', timestamp: 5 },
      { id: 'a3', role: 'assistant', content: 'new run', timestamp: 6 },
    ];

    expect(getAgentRunMessageSlice(messages, 'u1')).toEqual([
      messages[0],
      messages[1],
      messages[2],
      messages[3],
    ]);
  });

  it('falls back to the run start timestamp when transcript compaction removed the user anchor', () => {
    const messages: Message[] = [
      {
        id: 'compact-1',
        role: 'system',
        content: '[Conversation Summary] Earlier turns were compacted.',
        timestamp: 10,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 120,
        toolCalls: [
          {
            id: 'tc-1',
            name: 'write_file',
            arguments: '{"path":"c653a.txt"}',
            status: 'completed',
          },
        ],
      },
      {
        id: 'assistant-final',
        role: 'assistant',
        content: 'C653A C653B C653P C653W',
        timestamp: 150,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'STOP',
        },
      },
    ];

    expect(
      getAgentRunMessageSlice(messages, {
        userMessageId: 'compacted-user',
        runStartedAt: 100,
      }),
    ).toEqual([messages[1], messages[2]]);
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

  it('detects a delivered final response even when the user anchor was compacted away', () => {
    const messages: Message[] = [
      {
        id: 'compact-1',
        role: 'system',
        content: '[Conversation Summary] Earlier turns were compacted.',
        timestamp: 10,
      },
      {
        id: 'msg-tool-turn',
        role: 'assistant',
        content: '',
        timestamp: 100,
        toolCalls: [
          {
            id: 'tc-1',
            name: 'sessions_spawn',
            arguments: '{"prompt":"Reply exactly C653W"}',
            status: 'completed',
          },
        ],
      },
      {
        id: 'msg-final',
        role: 'assistant',
        content: 'C653A C653B C653P C653W',
        timestamp: 110,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'STOP',
        },
      },
      {
        id: 'msg-empty-placeholder',
        role: 'assistant',
        content: '',
        timestamp: 120,
      },
    ];

    const runScope = {
      userMessageId: 'compacted-user',
      runStartedAt: 90,
    };

    expect(hasDeliveredFinalAssistantResponse(messages, runScope)).toBe(true);
    expect(getLatestFinalAssistantResponsePreview(messages, runScope)).toBe(
      'C653A C653B C653P C653W',
    );
  });

  it('does not treat intermediate action text as the delivered final response', () => {
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

  it('keeps a delivered final response even when later tool or worker artifacts are appended', () => {
    const messages: Message[] = [
      {
        id: 'msg-user',
        role: 'user',
        content: 'Finish the run',
        timestamp: 1,
      },
      {
        id: 'msg-final',
        role: 'assistant',
        content: 'C661A C661B C661P C661W',
        timestamp: 2,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'STOP',
        },
      },
      {
        id: 'msg-late-tool-turn',
        role: 'assistant',
        content: '',
        timestamp: 3,
        toolCalls: [
          {
            id: 'tc-late',
            name: 'sessions_spawn',
            arguments: '{"prompt":"noop"}',
            status: 'completed',
          },
        ],
      },
      {
        id: 'msg-late-worker',
        role: 'assistant',
        content: 'Worker completed.',
        timestamp: 4,
        subAgentEvent: {
          type: 'sub-agent',
          event: 'completed',
          snapshot: makeSnapshot({
            sessionId: 'sub-late',
            status: 'completed',
            updatedAt: 4,
            output: 'noop',
          }),
        },
      },
    ];

    expect(hasDeliveredFinalAssistantResponse(messages, 'msg-user')).toBe(true);
    expect(getLatestFinalAssistantResponsePreview(messages, 'msg-user')).toBe(
      'C661A C661B C661P C661W',
    );
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

  it('ignores empty complete final metadata so review recovery can synthesize the missing answer', () => {
    const messages: Message[] = [
      {
        id: 'msg-user',
        role: 'user',
        content: 'Finish the task',
        timestamp: 1,
      },
      {
        id: 'msg-final-empty',
        role: 'assistant',
        content: '',
        timestamp: 2,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'STOP',
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
      makeSnapshot({
        status: 'completed',
        completionState: 'verified_success',
        output: 'Worker completed the delegated task.',
      }),
      makeSnapshot({
        sessionId: 'sub-2',
        status: 'completed',
        completionState: 'verified_success',
        output: 'Worker completed the delegated task.',
      }),
    ]);

    expect(outcome).toEqual({
      status: 'completed',
      summary: 'All background workers finished.',
    });
  });

  it('prefers structured completion state over worker output text', () => {
    const outcome = summarizeBackgroundWorkerRunOutcome([
      makeSnapshot({
        status: 'completed',
        completionState: 'verified_success',
        output: 'Worker finished.',
      }),
    ]);

    expect(outcome).toEqual({
      status: 'completed',
      summary: 'All background workers finished.',
    });
  });

  it('fails closed when structured completion state is absent', () => {
    const outcome = summarizeBackgroundWorkerRunOutcome([
      makeSnapshot({
        status: 'completed',
        output: 'Worker finished.',
      }),
    ]);

    expect(outcome).toEqual({
      status: 'failed',
      summary: 'Background work finished without verified worker completion.',
    });
  });
});
