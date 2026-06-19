import { buildStreamingDraftSignature, createChatDisplayStateCache, getStableDisplayMessages, getVisibleSourceMessageWindow, normalizeStreamingDraft, resolveDisplayMessages } from '../../src/screens/chatScreenDisplayState';
import type { AgentRun } from '../../src/types/agentRun';
import type { Message } from '../../src/types/message';
import type { SubAgentSnapshot } from '../../src/types/subAgent';
function makeMessage(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    role: 'assistant',
    content: '',
    timestamp: 1,
    ...overrides,
  };
}
function makeSnapshot(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    sessionId: 'worker-1',
    parentConversationId: 'conv-1',
    depth: 1,
    startedAt: 1,
    updatedAt: 2,
    status: 'running',
    sandboxPolicy: 'safe-only',
    ...overrides,
  };
}
function makeAgentRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    userMessageId: 'user-1',
    goal: 'Finish the task',
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    currentPhase: 'work',
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 1,
      startedTools: 0,
      completedTools: 0,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
    ...overrides,
  };
}

describe('chatScreenDisplayState', () => {
  it('reuses stable display items when source messages are unchanged', () => {
    const cache = createChatDisplayStateCache();
    const messages = [
      makeMessage('user-1', { role: 'user', content: 'Hello' }),
      makeMessage('assistant-1', { content: 'Hi there' }),
    ];

    const first = getStableDisplayMessages(messages, cache);
    const second = getStableDisplayMessages(messages, cache);

    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
  });
  it('reuses stable display items when hydration recreates equivalent message objects', () => {
    const cache = createChatDisplayStateCache();
    const messages = [
      makeMessage('user-1', { role: 'user', content: 'Hello' }),
      makeMessage('assistant-1', {
        content: 'Hi there',
        reasoning: 'Greeting the user',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'read_file',
            arguments: '{"path":"notes.md"}',
            status: 'completed',
            result: 'Done',
          },
        ],
      }),
    ];

    const first = getStableDisplayMessages(messages, cache);
    const hydratedMessages = messages.map((message) => ({
      ...message,
      toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    }));
    const second = getStableDisplayMessages(hydratedMessages, cache);

    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
  });
  it('invalidates stable display items when hydrated message content changes', () => {
    const cache = createChatDisplayStateCache();
    const messages = [
      makeMessage('user-1', { role: 'user', content: 'Hello' }),
      makeMessage('assistant-1', { content: 'Hi there' }),
    ];

    const first = getStableDisplayMessages(messages, cache);
    const changedMessages = messages.map((message) =>
      message.id === 'assistant-1' ? { ...message, content: 'Changed answer' } : { ...message },
    );
    const second = getStableDisplayMessages(changedMessages, cache);

    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(second[1].message.content).toBe('Changed answer');
  });
  it('reuses resolved display items when hydration recreates equivalent message objects', () => {
    const cache = createChatDisplayStateCache();
    const messages = [
      makeMessage('user-1', { role: 'user', content: 'Hello' }),
      makeMessage('assistant-1', { content: 'Hi there' }),
    ];
    const displayMessages = getStableDisplayMessages(messages, cache);
    const first = resolveDisplayMessages({
      displayMessages,
      messageById: new Map(messages.map((message) => [message.id, message])),
      cache,
      streamingDrafts: {},
      streamingMessageId: null,
      liveSubAgentSnapshotsById: new Map(),
      agentRunByDisplayItemId: new Map(),
    });

    const hydratedMessages = messages.map((message) => ({ ...message }));
    const hydratedDisplayMessages = getStableDisplayMessages(hydratedMessages, cache);
    const second = resolveDisplayMessages({
      displayMessages: hydratedDisplayMessages,
      messageById: new Map(hydratedMessages.map((message) => [message.id, message])),
      cache,
      streamingDrafts: {},
      streamingMessageId: null,
      liveSubAgentSnapshotsById: new Map(),
      agentRunByDisplayItemId: new Map(),
    });

    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
  });
  it('filters internal system transcript messages out of the visible display projection', () => {
    const cache = createChatDisplayStateCache();
    const messages = [
      makeMessage('system-1', {
        role: 'system',
        content:
          '[Conversation Summary]\n\n## Task Overview\nOriginal request\n\n<runtime_context>internal</runtime_context>',
      }),
      makeMessage('user-1', { role: 'user', content: 'Do the task' }),
      makeMessage('assistant-1', { content: 'Working on it.' }),
    ];

    const displayMessages = getStableDisplayMessages(messages, cache);

    expect(displayMessages.map((item) => item.message.id)).toEqual(['user-1', 'assistant-1']);
    expect(displayMessages.some((item) => item.sourceMessageIds.includes('system-1'))).toBe(false);
  });
  it('invalidates resolved display items when tool-call display state changes', () => {
    const cache = createChatDisplayStateCache();
    const messages = [
      makeMessage('assistant-1', {
        content: 'Using a tool',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'read_file',
            arguments: '{}',
            status: 'running',
          },
        ],
      }),
    ];
    const displayMessages = getStableDisplayMessages(messages, cache);
    const first = resolveDisplayMessages({
      displayMessages,
      messageById: new Map(messages.map((message) => [message.id, message])),
      cache,
      streamingDrafts: {},
      streamingMessageId: null,
      liveSubAgentSnapshotsById: new Map(),
      agentRunByDisplayItemId: new Map(),
    });

    const changedMessages = [
      {
        ...messages[0],
        toolCalls: [
          {
            ...messages[0].toolCalls![0],
            status: 'completed' as const,
            result: 'Done',
          },
        ],
      },
    ];
    const changedDisplayMessages = getStableDisplayMessages(changedMessages, cache);
    const second = resolveDisplayMessages({
      displayMessages: changedDisplayMessages,
      messageById: new Map(changedMessages.map((message) => [message.id, message])),
      cache,
      streamingDrafts: {},
      streamingMessageId: null,
      liveSubAgentSnapshotsById: new Map(),
      agentRunByDisplayItemId: new Map(),
    });

    expect(second[0]).not.toBe(first[0]);
    expect(second[0].resolvedMessage.toolCalls?.[0].status).toBe('completed');
  });
  it('invalidates assistant display projection when only a hidden tool-result message changes', () => {
    const cache = createChatDisplayStateCache();
    const messages = [
      makeMessage('assistant-1', {
        content: 'Using a tool',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'read_file',
            arguments: '{}',
            status: 'running',
          },
        ],
      }),
      makeMessage('tool-1-msg', {
        role: 'tool',
        toolCallId: 'tool-1',
        content: 'pending',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'read_file',
            arguments: '{}',
            status: 'running',
          },
        ],
      }),
      makeMessage('assistant-2', { content: 'Waiting for the result' }),
    ];

    const firstDisplayMessages = getStableDisplayMessages(messages, cache);
    const firstResolved = resolveDisplayMessages({
      displayMessages: firstDisplayMessages,
      messageById: new Map(messages.map((message) => [message.id, message])),
      cache,
      streamingDrafts: {},
      streamingMessageId: null,
      liveSubAgentSnapshotsById: new Map(),
      agentRunByDisplayItemId: new Map(),
    });

    const changedMessages = messages.map((message) =>
      message.id === 'tool-1-msg'
        ? {
            ...message,
            content: 'done',
            toolCalls: [
              {
                ...message.toolCalls![0],
                status: 'completed' as const,
                result: 'Done',
              },
            ],
          }
        : { ...message },
    );
    const secondDisplayMessages = getStableDisplayMessages(changedMessages, cache);
    const secondResolved = resolveDisplayMessages({
      displayMessages: secondDisplayMessages,
      messageById: new Map(changedMessages.map((message) => [message.id, message])),
      cache,
      streamingDrafts: {},
      streamingMessageId: null,
      liveSubAgentSnapshotsById: new Map(),
      agentRunByDisplayItemId: new Map(),
    });

    expect(secondDisplayMessages[0]).not.toBe(firstDisplayMessages[0]);
    expect(secondResolved[0]).not.toBe(firstResolved[0]);
    expect(secondResolved[0].resolvedMessage.toolCalls?.[0].status).toBe('completed');
    expect(secondResolved[0].resolvedMessage.toolCalls?.[0].result).toBe('Done');
    expect(secondResolved[0].resolvedResponseSegments?.[0].toolCalls?.[0].status).toBe('completed');
    expect(secondResolved[0].resolvedResponseSegments?.[0].toolCalls?.[0].result).toBe('Done');
  });
  it('windows long transcripts from the source-message tail without splitting the latest user turn', () => {
    const messages = [
      makeMessage('user-1', { role: 'user', content: 'First', timestamp: 1 }),
      makeMessage('assistant-1', { content: 'First answer', timestamp: 2 }),
      makeMessage('user-2', { role: 'user', content: 'Second', timestamp: 3 }),
      makeMessage('assistant-2', { content: 'Second answer', timestamp: 4 }),
      makeMessage('user-3', { role: 'user', content: 'Third', timestamp: 5 }),
      makeMessage('assistant-3', { content: 'Third answer', timestamp: 6 }),
    ];

    const visible = getVisibleSourceMessageWindow(messages, 1);

    expect(visible.visibleMessages.map((message) => message.id)).toEqual(['user-3', 'assistant-3']);
    expect(visible.hiddenSourceMessageCount).toBe(4);
    expect(getVisibleSourceMessageWindow(messages, 100).visibleMessages).toBe(messages);
  });
  it('keeps a tool-heavy assistant turn intact when the source window starts inside it', () => {
    const messages = [
      makeMessage('user-1', { role: 'user', content: 'First', timestamp: 1 }),
      makeMessage('assistant-1', { content: 'First answer', timestamp: 2 }),
      makeMessage('user-2', { role: 'user', content: 'Second', timestamp: 3 }),
      makeMessage('assistant-2a', { content: 'Running a tool', timestamp: 4 }),
      makeMessage('tool-2', { role: 'tool', content: 'Tool result', timestamp: 5 }),
      makeMessage('assistant-2b', { content: 'Second answer', timestamp: 6 }),
    ];

    const visible = getVisibleSourceMessageWindow(messages, 2);

    expect(visible.visibleMessages.map((message) => message.id)).toEqual([
      'user-2',
      'assistant-2a',
      'tool-2',
      'assistant-2b',
    ]);
    expect(visible.hiddenSourceMessageCount).toBe(2);
  });
  it('resolves streaming drafts and live worker snapshots into display items', () => {
    const cache = createChatDisplayStateCache();
    const baseSnapshot = makeSnapshot({ currentActivity: 'Reading repository files' });
    const messages = [
      makeMessage('assistant-1', { content: 'Persisted response', timestamp: 1 }),
      makeMessage('assistant-2', {
        content: 'Worker started',
        timestamp: 2,
        subAgentEvent: {
          type: 'sub-agent',
          event: 'started',
          snapshot: baseSnapshot,
        },
      }),
    ];
    const displayMessages = getStableDisplayMessages(messages, cache);
    const liveSnapshots = new Map<string, SubAgentSnapshot>([
      [
        baseSnapshot.sessionId,
        {
          ...baseSnapshot,
          updatedAt: 8,
          currentActivity: 'Comparing symbol usage',
        },
      ],
    ]);
    const agentRunByDisplayItemId = new Map<string, AgentRun>([
      [displayMessages[0].id, makeAgentRun()],
    ]);
    const params = {
      displayMessages,
      messageById: new Map(messages.map((message) => [message.id, message])),
      cache,
      streamingDrafts: {
        'assistant-1': {
          content: 'Live streamed response',
        },
      },
      streamingMessageId: 'assistant-1',
      liveSubAgentSnapshotsById: liveSnapshots,
      agentRunByDisplayItemId,
    };

    const first = resolveDisplayMessages(params);

    expect(first).toHaveLength(1);
    expect(first[0].resolvedMessage.content).toContain('Live streamed response');
    expect(first[0].resolvedResponseSegments?.[0].content).toBe('Live streamed response');
    expect(first[0].resolvedResponseSegments?.[0].isStreaming).toBe(true);
    expect(first[0].resolvedResponseSegments?.[1].subAgentEvent?.snapshot.currentActivity).toBe(
      'Comparing symbol usage',
    );
    expect(first[0].agentRun?.id).toBe('run-1');

    const second = resolveDisplayMessages(params);
    expect(second[0]).toBe(first[0]);
  });
  it('preserves older worker lifecycle snapshots while still live-updating the latest segment', () => {
    const cache = createChatDisplayStateCache();
    const startedSnapshot = makeSnapshot({
      currentActivity: 'Reading repository files',
      updatedAt: 2,
    });
    const messages = [
      makeMessage('assistant-1', {
        content: 'Worker started',
        timestamp: 1,
        subAgentEvent: {
          type: 'sub-agent',
          event: 'started',
          snapshot: startedSnapshot,
        },
      }),
      makeMessage('assistant-2', {
        content: 'Worker completed',
        timestamp: 2,
        subAgentEvent: {
          type: 'sub-agent',
          event: 'completed',
          snapshot: makeSnapshot({
            updatedAt: 3,
            status: 'completed',
            output: 'Done.',
          }),
        },
      }),
    ];

    const displayMessages = getStableDisplayMessages(messages, cache);
    const resolved = resolveDisplayMessages({
      displayMessages,
      messageById: new Map(messages.map((message) => [message.id, message])),
      cache,
      streamingDrafts: {},
      streamingMessageId: null,
      liveSubAgentSnapshotsById: new Map<string, SubAgentSnapshot>([
        [
          startedSnapshot.sessionId,
          {
            ...startedSnapshot,
            updatedAt: 4,
            status: 'completed',
            output: 'Done.',
          },
        ],
      ]),
      agentRunByDisplayItemId: new Map(),
    });

    expect(
      resolved[0].resolvedResponseSegments?.map((segment) => segment.subAgentEvent?.event),
    ).toEqual(['started', 'completed']);
    expect(resolved[0].resolvedResponseSegments?.[0].subAgentEvent?.snapshot.currentActivity).toBe(
      'Reading repository files',
    );
    expect(resolved[0].resolvedResponseSegments?.[0].subAgentEvent?.snapshot.status).toBe(
      'running',
    );
    expect(resolved[0].resolvedResponseSegments?.[1].subAgentEvent?.snapshot.status).toBe(
      'completed',
    );
  });
  it('drops empty streaming drafts from the live draft bag', () => {
    expect(normalizeStreamingDraft({ content: '', toolCalls: [] })).toBeUndefined();
    expect(buildStreamingDraftSignature(undefined)).toBe('');
    expect(normalizeStreamingDraft({ content: '', reasoning: 'Thinking' })).toEqual({
      content: '',
      reasoning: 'Thinking',
    });
  });
  it('filters streamed tool calls that do not yet have a stable id and name', () => {
    expect(
      normalizeStreamingDraft({
        toolCalls: [
          { id: '', name: 'read_file', arguments: '{}', status: 'pending' } as any,
          { id: 'tc-1', name: '', arguments: '{}', status: 'pending' } as any,
        ],
      }),
    ).toBeUndefined();

    expect(
      buildStreamingDraftSignature({
        toolCalls: [{ id: '', name: 'read_file', arguments: '{}', status: 'pending' } as any],
      }),
    ).toBe('\u0003\u0003\u0003');
  });
});
