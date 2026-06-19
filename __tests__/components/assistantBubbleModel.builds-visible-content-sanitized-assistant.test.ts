import { buildAssistantBubbleViewModel } from '../../src/components/chat/assistantBubbleModel';
import { Message, ToolCall } from '../../src/types/message';
const timestamp = Date.now();
function makeAssistantMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: 'Answer',
    timestamp,
    ...overrides,
  };
}
function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tool-1',
    name: 'read_file',
    arguments: '{"path":"README.md"}',
    status: 'completed',
    ...overrides,
  };
}

describe('buildAssistantBubbleViewModel', () => {
  it('builds visible content from sanitized assistant segments and keeps the latest active tool call', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({
        content: [
          'Previous internal tool call: read_file({"path":"README.md"})',
          'Real answer.',
        ].join('\n'),
        reasoning: '…',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'read_file',
            arguments: '{"path":"README.md"}',
            status: 'pending',
          },
        ],
      }),
      isStreaming: true,
    });

    expect(model.contentSegments).toHaveLength(1);
    expect(model.contentSegments[0]?.content).toBe('Real answer.');
    expect(model.timelineItems.map((item) => item.kind)).toEqual(['content']);
    expect(model.copyText).toBe('Real answer.');
    expect(model.activeToolCall).toEqual(
      expect.objectContaining({ id: 'tool-1', status: 'pending' }),
    );
  });
  it('interleaves reasoning and content in assistant round order', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({ content: 'Second answer' }),
      responseSegments: [
        {
          id: 'segment-1',
          messageId: 'assistant-1',
          content: 'First answer',
          reasoning: 'Need a plan first',
          timestamp,
        },
        {
          id: 'segment-2',
          messageId: 'assistant-2',
          content: 'Second answer',
          reasoning: 'Verify the result',
          timestamp: timestamp + 1,
        },
      ],
    });

    expect(
      model.timelineItems.map((item) =>
        item.kind === 'reasoning'
          ? `${item.kind}:${item.sourceSegmentId}:${item.reasoning}`
          : `${item.kind}:${item.segment.id}:${item.segment.content}`,
      ),
    ).toEqual([
      'reasoning:segment-1:Need a plan first',
      'content:segment-1:First answer',
      'reasoning:segment-2:Verify the result',
      'content:segment-2:Second answer',
    ]);
  });
  it('collapses repeated tool status snapshots across ordinary assistant segments into one logical row', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({ content: 'Found the issue.' }),
      responseSegments: [
        {
          id: 'segment-1',
          messageId: 'assistant-1',
          content: 'Checking the file.',
          timestamp,
          toolCalls: [
            makeToolCall({
              id: 'tool-1',
              status: 'pending',
              progressText: 'Queued',
            }),
          ],
        },
        {
          id: 'segment-2',
          messageId: 'assistant-2',
          content: '',
          timestamp: timestamp + 1,
          toolCalls: [
            makeToolCall({
              id: 'tool-1',
              status: 'running',
              progressText: 'Reading source',
            }),
          ],
        },
        {
          id: 'segment-3',
          messageId: 'assistant-3',
          content: 'Found the issue.',
          timestamp: timestamp + 2,
          toolCalls: [
            makeToolCall({
              id: 'tool-1',
              status: 'completed',
              progressText: 'Read complete',
              result: 'file contents',
            }),
          ],
        },
      ],
    });

    expect(model.contentSegments.map((segment) => segment.id)).toEqual(['segment-1', 'segment-3']);
    expect(model.contentSegments[0]?.toolCalls).toEqual([
      expect.objectContaining({
        id: 'tool-1',
        status: 'completed',
        progressText: 'Read complete',
        result: 'file contents',
      }),
    ]);
    expect(model.contentSegments[1]?.toolCalls).toBeUndefined();
    expect(model.contentSegments.flatMap((segment) => segment.toolCalls ?? [])).toHaveLength(1);
  });
  it('anchors cumulative tool snapshots to the segment where each tool first appeared', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({ content: 'Done.' }),
      responseSegments: [
        {
          id: 'segment-1',
          messageId: 'assistant-1',
          content: 'Starting the audit.',
          timestamp,
          toolCalls: [
            makeToolCall({
              id: 'tool-1',
              status: 'running',
              progressText: 'Reading files',
            }),
          ],
        },
        {
          id: 'segment-2',
          messageId: 'assistant-2',
          content: 'Patching the issue.',
          timestamp: timestamp + 1,
          toolCalls: [
            makeToolCall({
              id: 'tool-1',
              status: 'completed',
              result: 'file contents',
            }),
            makeToolCall({
              id: 'tool-2',
              name: 'write_file',
              arguments: '{"path":"src/components/chat/assistantBubbleModel.ts"}',
              status: 'running',
              progressText: 'Applying patch',
            }),
          ],
        },
        {
          id: 'segment-3',
          messageId: 'assistant-3',
          content: 'Done.',
          timestamp: timestamp + 2,
          toolCalls: [
            makeToolCall({
              id: 'tool-1',
              status: 'completed',
              result: 'file contents',
            }),
            makeToolCall({
              id: 'tool-2',
              name: 'write_file',
              arguments: '{"path":"src/components/chat/assistantBubbleModel.ts"}',
              status: 'completed',
              progressText: 'Patch applied',
              result: 'write complete',
            }),
          ],
        },
      ],
    });

    expect(model.contentSegments).toEqual([
      expect.objectContaining({
        id: 'segment-1',
        toolCalls: [expect.objectContaining({ id: 'tool-1', status: 'completed' })],
      }),
      expect.objectContaining({
        id: 'segment-2',
        toolCalls: [
          expect.objectContaining({ id: 'tool-2', status: 'completed', result: 'write complete' }),
        ],
      }),
      expect.objectContaining({
        id: 'segment-3',
        toolCalls: undefined,
      }),
    ]);
    expect(
      model.contentSegments
        .flatMap((segment) => segment.toolCalls ?? [])
        .map((toolCall) => toolCall.id),
    ).toEqual(['tool-1', 'tool-2']);
  });
  it('collapses duplicate tool ids within a single assistant segment into the latest status', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({ content: 'Done.' }),
      responseSegments: [
        {
          id: 'segment-1',
          messageId: 'assistant-1',
          content: 'Done.',
          timestamp,
          toolCalls: [
            makeToolCall({
              id: 'gemini-call-0',
              name: 'image_generate',
              arguments: '{"prompt":"cat"}',
              status: 'pending',
            }),
            makeToolCall({
              id: 'gemini-call-0',
              name: 'image_generate',
              arguments: '{"prompt":"cat"}',
              status: 'running',
              progressText: 'Generating image',
            }),
            makeToolCall({
              id: 'gemini-call-0',
              name: 'image_generate',
              arguments: '{"prompt":"cat"}',
              status: 'completed',
              result: 'image ready',
            }),
          ],
        },
      ],
    });

    expect(model.contentSegments[0]?.toolCalls).toEqual([
      expect.objectContaining({
        id: 'gemini-call-0',
        name: 'image_generate',
        status: 'completed',
        result: 'image ready',
      }),
    ]);
  });
  it('flags oversized content for inline plain-text and truncation warnings', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({
        content: 'L'.repeat(140_100),
      }),
    });

    expect(model.contentWarnings).toEqual({
      usesPlainTextFallback: true,
      hasTruncatedContent: true,
    });
  });
  it('collapses same-session sub-agent lifecycle segments into one updated widget', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({ content: 'Worker update' }),
      responseSegments: [
        {
          id: 'segment-worker-started',
          messageId: 'assistant-worker-started',
          content: 'Worker started',
          timestamp,
          subAgentEvent: {
            type: 'sub-agent',
            event: 'started',
            snapshot: {
              sessionId: 'sub-1',
              parentConversationId: 'conv-1',
              name: 'Planner',
              depth: 1,
              startedAt: timestamp - 10_000,
              updatedAt: timestamp - 5_000,
              status: 'running',
              sandboxPolicy: 'inherit',
              currentActivity: 'Inspecting files',
            },
          },
        },
        {
          id: 'segment-worker-finished',
          messageId: 'assistant-worker-finished',
          content: 'Worker completed',
          timestamp: timestamp + 1,
          subAgentEvent: {
            type: 'sub-agent',
            event: 'completed',
            snapshot: {
              sessionId: 'sub-1',
              parentConversationId: 'conv-1',
              name: 'Planner',
              depth: 1,
              startedAt: timestamp - 10_000,
              updatedAt: timestamp + 1,
              status: 'completed',
              sandboxPolicy: 'inherit',
              output: 'Done',
            },
          },
        },
      ],
    });

    expect(model.contentSegments).toHaveLength(1);
    expect(model.contentSegments[0]?.id).toBe('segment-worker-started');
    expect(model.contentSegments[0]?.messageId).toBe('assistant-worker-finished');
    expect(model.contentSegments[0]?.subAgentEvent).toEqual(
      expect.objectContaining({
        event: 'completed',
        snapshot: expect.objectContaining({
          sessionId: 'sub-1',
          status: 'completed',
        }),
      }),
    );
    expect(model.copyText).toBe('Worker completed');
  });
  it('preserves append-only tool call history when same-session sub-agent segments collapse', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({ content: 'Worker completed' }),
      responseSegments: [
        {
          id: 'segment-worker-started',
          messageId: 'assistant-worker-started',
          content: '',
          timestamp,
          toolCalls: [
            makeToolCall({
              id: 'tool-1',
              status: 'running',
              progressText: 'Inspecting src/',
            }),
          ],
          subAgentEvent: {
            type: 'sub-agent',
            event: 'started',
            snapshot: {
              sessionId: 'sub-1',
              parentConversationId: 'conv-1',
              name: 'Planner',
              depth: 1,
              startedAt: timestamp - 10_000,
              updatedAt: timestamp,
              status: 'running',
              sandboxPolicy: 'inherit',
            },
          },
        },
        {
          id: 'segment-worker-completed',
          messageId: 'assistant-worker-completed',
          content: 'Worker completed',
          timestamp: timestamp + 1,
          toolCalls: [
            makeToolCall({
              id: 'tool-1',
              status: 'completed',
              progressText: 'Inspecting src/',
              result: 'Read repository metadata',
            }),
            makeToolCall({
              id: 'tool-2',
              name: 'write_file',
              arguments: '{"path":"src/fix.ts"}',
              status: 'completed',
              result: 'Applied the fix',
            }),
          ],
          subAgentEvent: {
            type: 'sub-agent',
            event: 'completed',
            snapshot: {
              sessionId: 'sub-1',
              parentConversationId: 'conv-1',
              name: 'Planner',
              depth: 1,
              startedAt: timestamp - 10_000,
              updatedAt: timestamp + 1,
              status: 'completed',
              sandboxPolicy: 'inherit',
              output: 'Done',
            },
          },
        },
      ],
    });

    expect(model.contentSegments).toHaveLength(1);
    expect(model.contentSegments[0]?.toolCalls).toEqual([
      expect.objectContaining({
        id: 'tool-1',
        status: 'completed',
        result: 'Read repository metadata',
      }),
      expect.objectContaining({
        id: 'tool-2',
        name: 'write_file',
        result: 'Applied the fix',
      }),
    ]);
  });
});
