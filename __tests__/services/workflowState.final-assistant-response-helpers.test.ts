import type { Message } from '../../src/types/message';
import type { SubAgentSnapshot } from '../../src/types/subAgent';
import { getLatestFinalAssistantResponsePreview, hasDeliveredFinalAssistantResponse, summarizeBackgroundWorkerRunOutcome } from '../../src/services/agents/lifecycle/agentRunStateMachine';
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
