import {
  buildAgentRunDisplayItemMap,
  buildStreamingDraftSignature,
  createChatDisplayStateCache,
  getStableDisplayMessages,
  getVisibleSourceMessageWindow,
  mergeStreamingToolCall,
  normalizeStreamingDraft,
  resolveDisplayMessages,
} from '../../src/screens/chatScreenDisplayState';
import type { AgentRun, Message, SubAgentSnapshot } from '../../src/types';

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

  it('merges streamed tool calls when provider metadata upgrades the tool id mid-turn', () => {
    const initial = mergeStreamingToolCall(undefined, {
      id: 'fc_1',
      name: 'read_file',
      arguments: '{"path":"notes.txt"}',
      status: 'pending',
      raw: {
        id: 'fc_1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"notes.txt"}',
        },
        _openai: {
          itemId: 'fc_1',
          outputIndex: 0,
        },
      },
    });

    const merged = mergeStreamingToolCall(initial, {
      id: 'call_1',
      name: 'read_file',
      arguments: '{"path":"notes.txt"}',
      status: 'running',
      raw: {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"notes.txt"}',
        },
        _openai: {
          itemId: 'fc_1',
          callId: 'call_1',
          outputIndex: 0,
        },
      },
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(
      expect.objectContaining({
        id: 'call_1',
        status: 'running',
        raw: expect.objectContaining({
          _openai: expect.objectContaining({
            itemId: 'fc_1',
            callId: 'call_1',
            outputIndex: 0,
          }),
        }),
      }),
    );
  });

  it('merges streamed tool calls that reuse the same synthetic placeholder id inside one message', () => {
    const initial = mergeStreamingToolCall(undefined, {
      id: 'gemini-call-0',
      name: 'image_generate',
      arguments: '{"prompt":"cat"}',
      status: 'pending',
    });

    const merged = mergeStreamingToolCall(initial, {
      id: 'gemini-call-0',
      name: 'image_generate',
      arguments: '{"prompt":"cat"}',
      status: 'running',
      progressText: 'Generating image',
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(
      expect.objectContaining({
        id: 'gemini-call-0',
        status: 'running',
        progressText: 'Generating image',
      }),
    );
  });

  it('appends distinct streamed tool calls even when the provider reuses output index zero', () => {
    const initial = mergeStreamingToolCall(undefined, {
      id: 'call_1',
      name: 'read_file',
      arguments: '{"path":"notes.txt"}',
      status: 'completed',
      raw: {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"notes.txt"}',
        },
        _openai: {
          itemId: 'fc_1',
          callId: 'call_1',
          outputIndex: 0,
        },
      },
    });

    const merged = mergeStreamingToolCall(initial, {
      id: 'call_2',
      name: 'write_file',
      arguments: '{"path":"fix.ts"}',
      status: 'completed',
      raw: {
        id: 'call_2',
        type: 'function',
        function: {
          name: 'write_file',
          arguments: '{"path":"fix.ts"}',
        },
        _openai: {
          itemId: 'fc_2',
          callId: 'call_2',
          outputIndex: 0,
        },
      },
    });

    expect(merged).toHaveLength(2);
    expect(merged.map((toolCall) => toolCall.id)).toEqual(['call_1', 'call_2']);
  });

  it('derives generated attachments from streaming tool-call drafts before persistence catches up', () => {
    const cache = createChatDisplayStateCache();
    const messages = [
      makeMessage('user-1', { role: 'user', content: 'Generate an image', timestamp: 1 }),
      makeMessage('assistant-1', { content: '', timestamp: 2 }),
    ];
    const displayMessages = getStableDisplayMessages(messages, cache);

    const resolved = resolveDisplayMessages({
      displayMessages,
      messageById: new Map(messages.map((message) => [message.id, message])),
      cache,
      streamingDrafts: {
        'assistant-1': {
          toolCalls: [
            {
              id: 'tool-1',
              name: 'image_generate',
              arguments: '{"prompt":"cat"}',
              status: 'completed',
              result: JSON.stringify({
                status: 'generated',
                providerId: 'openai',
                model: 'gpt-image-2',
                mimeType: 'image/png',
                fileUri: 'file:///mock/documents/workspace/conv-1/generated-image.png',
              }),
            },
          ],
        },
      },
      streamingMessageId: 'assistant-1',
      liveSubAgentSnapshotsById: new Map(),
      agentRunByDisplayItemId: new Map(),
    });

    expect(resolved[1].resolvedMessage.attachments).toEqual([
      expect.objectContaining({
        id: 'generated-image-tool-1',
        uri: 'file:///mock/documents/workspace/conv-1/generated-image.png',
      }),
    ]);
    expect(resolved[1].resolvedResponseSegments?.[0].attachments).toEqual([
      expect.objectContaining({
        id: 'generated-image-tool-1',
      }),
    ]);
  });

  it('maps agent runs onto the display item anchored by the run assistant response', () => {
    const cache = createChatDisplayStateCache();
    const messages = [
      makeMessage('user-1', { role: 'user', content: 'First task', timestamp: 1 }),
      makeMessage('assistant-1', { content: 'Starting first task', timestamp: 2 }),
      makeMessage('assistant-2', { content: 'First task complete', timestamp: 3 }),
      makeMessage('user-2', { role: 'user', content: 'Second task', timestamp: 4 }),
      makeMessage('assistant-3', { content: 'Second task complete', timestamp: 5 }),
    ];
    const displayMessages = getStableDisplayMessages(messages, cache);
    const mappedRuns = buildAgentRunDisplayItemMap(messages, displayMessages, [
      makeAgentRun({ id: 'run-1', userMessageId: 'user-1', updatedAt: 10 }),
      makeAgentRun({ id: 'run-2', userMessageId: 'user-2', updatedAt: 20 }),
    ]);

    const firstRunDisplayItem = displayMessages.find((item) =>
      item.sourceMessageIds.includes('assistant-2'),
    );
    const secondRunDisplayItem = displayMessages.find((item) =>
      item.sourceMessageIds.includes('assistant-3'),
    );

    expect(firstRunDisplayItem).toBeDefined();
    expect(secondRunDisplayItem).toBeDefined();
    expect(mappedRuns.get(firstRunDisplayItem!.id)?.id).toBe('run-1');
    expect(mappedRuns.get(secondRunDisplayItem!.id)?.id).toBe('run-2');
  });
});
