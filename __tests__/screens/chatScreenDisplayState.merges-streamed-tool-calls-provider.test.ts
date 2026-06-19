import { buildAgentRunDisplayItemMap, createChatDisplayStateCache, getStableDisplayMessages, mergeStreamingToolCall, resolveDisplayMessages } from '../../src/screens/chatScreenDisplayState';
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
  it('anchors workflow display items when compaction removed the original user message', () => {
    const cache = createChatDisplayStateCache();
    const workerSnapshot = makeSnapshot({ updatedAt: 25 });
    const messages = [
      makeMessage('system-1', {
        role: 'system',
        content: '[Conversation Summary]\n\n## Task Overview\nEarlier turns were compacted.',
        timestamp: 20,
      }),
      makeMessage('assistant-worker', {
        content: 'Worker started',
        timestamp: 21,
        subAgentEvent: {
          type: 'sub-agent',
          event: 'started',
          snapshot: workerSnapshot,
        },
      }),
      makeMessage('assistant-final', {
        content: 'Task complete.',
        timestamp: 22,
      }),
    ];
    const displayMessages = getStableDisplayMessages(messages, cache);
    const mappedRuns = buildAgentRunDisplayItemMap(messages, displayMessages, [
      makeAgentRun({
        id: 'run-compacted',
        userMessageId: 'missing-user-message',
        createdAt: 20,
        updatedAt: 30,
      }),
    ]);

    const finalDisplayItem = displayMessages.find((item) =>
      item.sourceMessageIds.includes('assistant-final'),
    );

    expect(finalDisplayItem).toBeDefined();
    expect(mappedRuns.get(finalDisplayItem!.id)?.id).toBe('run-compacted');
  });
});
