import {
  buildAssistantBubbleTranscriptFileName,
  buildAssistantBubbleTranscriptMarkdown,
} from '../../src/components/chat/assistantBubbleTranscript';
import { Message } from '../../src/types/message';

const translate = (key: string, params?: Record<string, string | number>) => {
  switch (key) {
    case 'toolCall.summaries.readFilePath':
      return `Reading ${params?.path}`;
    case 'toolCall.summaries.readFile':
      return 'Reading a file';
    default:
      return key;
  }
};

const makeAssistantMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'assistant-1',
  role: 'assistant',
  content: 'Final answer',
  timestamp: Date.UTC(2026, 3, 16, 12, 34, 56),
  ...overrides,
});

describe('assistantBubbleTranscript', () => {
  it('builds a markdown transcript for grouped assistant bubble content', () => {
    const message = makeAssistantMessage();

    const markdown = buildAssistantBubbleTranscriptMarkdown({
      message,
      assistantLabel: 'Assistant',
      t: translate,
      responseSegments: [
        {
          id: 'segment-1',
          messageId: 'assistant-1',
          content: 'Final answer',
          reasoning: 'Need plan',
          timestamp: message.timestamp,
          attachments: [
            {
              id: 'attachment-1',
              type: 'file',
              uri: 'file:///tmp/report.md',
              name: 'report.md',
              mimeType: 'text/markdown',
              size: 128,
              workspacePath: 'reports/report.md',
            },
          ],
          toolCalls: [
            {
              id: 'tool-1',
              name: 'read_file',
              arguments: '{"path":"src/app.ts"}',
              status: 'completed',
              result: 'const value = 1;',
            },
          ],
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
          },
        },
        {
          id: 'segment-2',
          messageId: 'assistant-2',
          content: '',
          timestamp: message.timestamp + 1_000,
          subAgentEvent: {
            type: 'sub-agent',
            event: 'completed',
            snapshot: {
              sessionId: 'worker-1',
              parentConversationId: 'conv-1',
              depth: 1,
              startedAt: message.timestamp,
              updatedAt: message.timestamp + 1_000,
              status: 'completed',
              sandboxPolicy: 'safe-only',
              name: 'Researcher',
              output: 'Checked related files.',
            },
          },
        },
      ],
    });

    expect(markdown).toContain('# Assistant response');
    expect(markdown).toContain('## Segment 1');
    expect(markdown).toContain('### Thinking');
    expect(markdown).toContain('Need plan');
    expect(markdown).toContain('### Content');
    expect(markdown).toContain('Final answer');
    expect(markdown).toContain('### Attachments');
    expect(markdown).toContain(
      '- report.md (file | text/markdown | 128 bytes | workspace: reports/report.md)',
    );
    expect(markdown).toContain('### Tool calls');
    expect(markdown).toContain('#### read_file');
    expect(markdown).toContain('- Summary: Reading src/app.ts');
    expect(markdown).toContain('Arguments:\n```json\n{"path":"src/app.ts"}\n```');
    expect(markdown).toContain('Result:\n```text\nconst value = 1;\n```');
    expect(markdown).toContain('## Segment 2');
    expect(markdown).toContain('### Worker update');
    expect(markdown).toContain('- Session: worker-1');
    expect(markdown).toContain('- Name: Researcher');
    expect(markdown).toContain('Worker output:\nChecked related files.');
  });

  it('falls back to a no-content message when nothing shareable exists', () => {
    const markdown = buildAssistantBubbleTranscriptMarkdown({
      message: makeAssistantMessage({ content: '' }),
      assistantLabel: 'Assistant',
      t: translate,
    });

    expect(markdown).toContain('No shareable response content was available.');
  });

  it('builds a stable share file name from the assistant timestamp', () => {
    expect(buildAssistantBubbleTranscriptFileName(makeAssistantMessage())).toBe(
      'assistant-response-2026-04-16T12-34-56Z.md',
    );
  });
});
