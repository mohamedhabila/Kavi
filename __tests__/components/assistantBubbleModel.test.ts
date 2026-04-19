import { buildAssistantBubbleViewModel } from '../../src/components/chat/assistantBubbleModel';
import { AgentRun, Attachment, Message, ToolCall } from '../../src/types';

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

function makeAgentRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    userMessageId: 'user-1',
    goal: 'Research prompt',
    status: 'running',
    createdAt: timestamp,
    updatedAt: timestamp,
    currentPhase: 'work',
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 0,
      startedTools: 0,
      completedTools: 0,
      failedTools: 0,
      spawnedSubAgents: 0,
      durationMs: 0,
    },
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

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'attachment-1',
    type: 'file',
    uri: 'file:///workspace/attachment-1.txt',
    name: 'attachment-1.txt',
    mimeType: 'text/plain',
    size: 128,
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

  it('preserves attachments across collapsed same-session sub-agent segments', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({ content: 'Worker completed' }),
      responseSegments: [
        {
          id: 'segment-worker-started',
          messageId: 'assistant-worker-started',
          content: '',
          timestamp,
          attachments: [
            makeAttachment({
              id: 'artifact-1',
              name: 'artifact-1.txt',
              uri: 'file:///workspace/artifact-1.txt',
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
          attachments: [
            makeAttachment({
              id: 'artifact-2',
              name: 'artifact-2.txt',
              uri: 'file:///workspace/artifact-2.txt',
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
    expect(model.contentSegments[0]?.attachments).toEqual([
      expect.objectContaining({ id: 'artifact-1', name: 'artifact-1.txt' }),
      expect.objectContaining({ id: 'artifact-2', name: 'artifact-2.txt' }),
    ]);
  });

  it('suppresses interrupted assistant history when a recovered final response supersedes it', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({ content: 'Recovered final answer' }),
      responseSegments: [
        {
          id: 'segment-incomplete',
          messageId: 'assistant-incomplete',
          content: 'Interrupted draft answer',
          timestamp,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'incomplete',
            finishReason: 'response_failed',
          },
        },
        {
          id: 'segment-final',
          messageId: 'assistant-final',
          content: 'Recovered final answer',
          timestamp: timestamp + 1,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'synthesized_from_evidence',
          },
        },
      ],
    });

    expect(model.contentSegments.map((segment) => segment.id)).toEqual(['segment-final']);
    expect(model.copyText).toBe('Recovered final answer');
  });

  it('suppresses older malformed partial segments when a newer retry supersedes them', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({ content: 'Latest malformed partial' }),
      responseSegments: [
        {
          id: 'segment-incomplete-1',
          messageId: 'assistant-incomplete-1',
          content: 'Old malformed partial',
          timestamp,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'incomplete',
            finishReason: 'response_failed',
          },
        },
        {
          id: 'segment-incomplete-2',
          messageId: 'assistant-incomplete-2',
          content: 'Latest malformed partial',
          timestamp: timestamp + 1,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'incomplete',
            finishReason: 'response_failed',
          },
        },
      ],
    });

    expect(model.contentSegments.map((segment) => segment.id)).toEqual(['segment-incomplete-2']);
    expect(model.copyText).toBe('Latest malformed partial');
  });

  it('suppresses stale intermediate status text when a later final response exists', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({ content: 'Final cancellation summary' }),
      responseSegments: [
        {
          id: 'segment-intermediate',
          messageId: 'assistant-intermediate',
          content: 'Status update that should not remain in the terminal bubble.',
          timestamp,
          assistantMetadata: {
            kind: 'intermediate',
            completionStatus: 'complete',
            finishReason: 'background_workers_running',
          },
        },
        {
          id: 'segment-final',
          messageId: 'assistant-final',
          content: 'Final cancellation summary',
          timestamp: timestamp + 1,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'fallback_from_evidence',
          },
        },
      ],
    });

    expect(model.contentSegments.map((segment) => segment.id)).toEqual(['segment-final']);
    expect(model.copyText).toBe('Final cancellation summary');
  });

  it('suppresses stale legacy plain text when a later complete final response exists', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({ content: 'Recovered final answer' }),
      responseSegments: [
        {
          id: 'segment-legacy',
          messageId: 'assistant-legacy',
          content: 'Legacy plain text without assistant metadata',
          timestamp,
        },
        {
          id: 'segment-final',
          messageId: 'assistant-final',
          content: 'Recovered final answer',
          timestamp: timestamp + 1,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'synthesized_from_evidence',
          },
        },
      ],
    });

    expect(model.contentSegments.map((segment) => segment.id)).toEqual(['segment-final']);
    expect(model.copyText).toBe('Recovered final answer');
  });

  it('keeps provisional drafts visible alongside newer execution activity', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({ content: '' }),
      responseSegments: [
        {
          id: 'segment-incomplete',
          messageId: 'assistant-incomplete',
          content: 'Provisional answer that should stay hidden while work continues.',
          timestamp,
          assistantMetadata: {
            kind: 'intermediate',
            completionStatus: 'incomplete',
            finishReason: 'pilot_review_pending',
          },
        },
        {
          id: 'segment-tool',
          messageId: 'assistant-tool',
          content: '',
          timestamp: timestamp + 1,
          toolCalls: [
            {
              id: 'tool-yield',
              name: 'sessions_yield',
              arguments: '{"message":"checkpoint"}',
              status: 'completed',
              result: '{"status":"checkpointed"}',
            },
          ],
        },
      ],
    });

    expect(model.contentSegments.map((segment) => segment.id)).toEqual([
      'segment-incomplete',
      'segment-tool',
    ]);
    expect(model.copyText).toBe('Provisional answer that should stay hidden while work continues.');
  });

  it('keeps the newest provisional draft visible while an agent run is still active', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({ content: '' }),
      agentRun: makeAgentRun(),
      responseSegments: [
        {
          id: 'segment-tool',
          messageId: 'assistant-tool',
          content: '',
          timestamp,
          toolCalls: [
            {
              id: 'tool-yield',
              name: 'sessions_yield',
              arguments: '{"message":"checkpoint"}',
              status: 'completed',
              result: '{"status":"checkpointed"}',
            },
          ],
        },
        {
          id: 'segment-provisional-answer',
          messageId: 'assistant-provisional-answer',
          content:
            'Verified remediation checklist that should stay hidden until the run completes.',
          timestamp: timestamp + 1,
          assistantMetadata: {
            kind: 'intermediate',
            completionStatus: 'incomplete',
            finishReason: 'pilot_review_pending',
          },
        },
      ],
    });

    expect(model.contentSegments.map((segment) => segment.id)).toEqual([
      'segment-tool',
      'segment-provisional-answer',
    ]);
    expect(model.copyText).toBe(
      'Verified remediation checklist that should stay hidden until the run completes.',
    );
  });

  it('keeps a completed long final response available without preview collapse', () => {
    const content = Array.from({ length: 30 }, (_, index) => `- checklist item ${index}`).join(
      '\n',
    );

    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({
        content,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'pilot_approved',
        },
      }),
    });

    expect(model.copyText).toContain('checklist item 29');
  });

  it('keeps attachment-only assistant segments visible', () => {
    const model = buildAssistantBubbleViewModel({
      message: makeAssistantMessage({ content: '' }),
      responseSegments: [
        {
          id: 'segment-image-only',
          messageId: 'assistant-image-only',
          content: '',
          timestamp,
          attachments: [
            {
              id: 'generated-image-tool-1',
              type: 'image',
              uri: 'file:///mock/document/workspace/conv-1/generated-image.png',
              name: 'generated-image.png',
              mimeType: 'image/png',
              size: 2048,
              workspacePath: 'generated-image.png',
            },
          ],
        },
      ],
    });

    expect(model.contentSegments).toHaveLength(1);
    expect(model.contentSegments[0]?.attachments).toEqual([
      expect.objectContaining({
        id: 'generated-image-tool-1',
        workspacePath: 'generated-image.png',
      }),
    ]);
    expect(model.copyText).toBe('');
  });
});
