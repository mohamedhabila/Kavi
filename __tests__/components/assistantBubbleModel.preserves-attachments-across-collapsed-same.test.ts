import { buildAssistantBubbleViewModel } from '../../src/components/chat/assistantBubbleModel';
import { AgentRun } from '../../src/types/agentRun';
import { Attachment } from '../../src/types/attachment';
import { Message } from '../../src/types/message';
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
            finishReason: 'terminal_review_pending',
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
            finishReason: 'terminal_review_pending',
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
          finishReason: 'graph_finalized',
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
