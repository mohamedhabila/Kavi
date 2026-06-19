import { buildDisplayMessages } from '../../src/components/chat/messageGrouping';
import { Message } from '../../src/types/message';
const timestamp = Date.now();
function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: 'message-id',
    role: 'assistant',
    content: '',
    timestamp,
    ...overrides,
  };
}

describe('buildDisplayMessages', () => {
  it('keeps one visible assistant response when hidden tool output separates assistant turns', () => {
    const items = buildDisplayMessages([
      makeMessage({ id: 'user-1', role: 'user', content: 'Build a game' }),
      makeMessage({
        id: 'assistant-1',
        role: 'assistant',
        content: 'I will create the files.',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'write_file',
            arguments: '{"path":"game/index.html"}',
            status: 'completed',
          },
        ],
      }),
      makeMessage({ id: 'tool-msg', role: 'tool', content: 'ignored' }),
      makeMessage({ id: 'assistant-2', role: 'assistant', content: 'The canvas is ready.' }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[1].sourceMessageIds).toEqual(['assistant-1', 'assistant-2']);
    expect(items[1].retryMessageId).toBe('assistant-2');
    expect(items[1].message.content).toContain('I will create the files.');
    expect(items[1].message.content).toContain('The canvas is ready.');
    expect(items[1].message.toolCalls).toHaveLength(1);
    expect(items[1].responseSegments).toEqual([
      expect.objectContaining({ messageId: 'assistant-1', content: 'I will create the files.' }),
      expect.objectContaining({ messageId: 'assistant-2', content: 'The canvas is ready.' }),
    ]);
  });
  it('still merges directly consecutive assistant messages', () => {
    const items = buildDisplayMessages([
      makeMessage({ id: 'user-1', role: 'user', content: 'Summarize this' }),
      makeMessage({ id: 'assistant-1', role: 'assistant', content: 'Part one.' }),
      makeMessage({ id: 'assistant-2', role: 'assistant', content: 'Part two.' }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[1].sourceMessageIds).toEqual(['assistant-1', 'assistant-2']);
    expect(items[1].message.content).toContain('Part one.');
    expect(items[1].message.content).toContain('Part two.');
    expect(items[1].responseSegments).toEqual([
      expect.objectContaining({ messageId: 'assistant-1', content: 'Part one.' }),
      expect.objectContaining({ messageId: 'assistant-2', content: 'Part two.' }),
    ]);
  });
  it('deduplicates logical tool calls across merged assistant messages while keeping the latest status', () => {
    const items = buildDisplayMessages([
      makeMessage({ id: 'user-1', role: 'user', content: 'Audit the issue' }),
      makeMessage({
        id: 'assistant-1',
        role: 'assistant',
        content: 'Checking the file.',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'read_file',
            arguments: '{"path":"src/components/chat/AssistantBubble.tsx"}',
            status: 'running',
            progressText: 'Reading source',
          },
        ],
      }),
      makeMessage({
        id: 'assistant-2',
        role: 'assistant',
        content: 'Found the problem.',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'read_file',
            arguments: '{"path":"src/components/chat/AssistantBubble.tsx"}',
            status: 'completed',
            progressText: 'Read complete',
            result: 'file contents',
          },
        ],
      }),
    ]);

    expect(items[1].message.toolCalls).toEqual([
      expect.objectContaining({
        id: 'tool-1',
        status: 'completed',
        progressText: 'Read complete',
        result: 'file contents',
      }),
    ]);
    expect(items[1].responseSegments).toEqual([
      expect.objectContaining({
        messageId: 'assistant-1',
        toolCalls: [expect.objectContaining({ id: 'tool-1', status: 'running' })],
      }),
      expect.objectContaining({
        messageId: 'assistant-2',
        toolCalls: [expect.objectContaining({ id: 'tool-1', status: 'completed' })],
      }),
    ]);
  });
  it('reconciles hidden tool-result messages into the visible assistant projection', () => {
    const items = buildDisplayMessages([
      makeMessage({ id: 'user-1', role: 'user', content: 'Inspect the file' }),
      makeMessage({
        id: 'assistant-1',
        role: 'assistant',
        content: 'Checking the file now.',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'read_file',
            arguments: '{"path":"notes.md"}',
            status: 'running',
            progressText: 'Reading notes.md',
          },
        ],
      }),
      makeMessage({
        id: 'tool-1-msg',
        role: 'tool',
        toolCallId: 'tool-1',
        content: 'Done',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'read_file',
            arguments: '{"path":"notes.md"}',
            status: 'completed',
            result: 'notes content',
          },
        ],
      }),
      makeMessage({
        id: 'assistant-2',
        role: 'assistant',
        content: 'Found the note.',
      }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[1].sourceMessageIds).toEqual(['assistant-1', 'assistant-2']);
    expect(items[1].projectionSourceMessageIds).toEqual([
      'assistant-1',
      'tool-1-msg',
      'assistant-2',
    ]);
    expect(items[1].message.toolCalls).toEqual([
      expect.objectContaining({
        id: 'tool-1',
        status: 'completed',
        result: 'notes content',
      }),
    ]);
    expect(items[1].responseSegments).toEqual([
      expect.objectContaining({
        messageId: 'assistant-1',
        toolCalls: [expect.objectContaining({ id: 'tool-1', status: 'completed' })],
      }),
      expect.objectContaining({
        messageId: 'assistant-2',
        content: 'Found the note.',
      }),
    ]);
  });
  it('does not let an earlier tool result attach to a later assistant turn that reuses the same provider tool id', () => {
    const items = buildDisplayMessages([
      makeMessage({ id: 'user-1', role: 'user', content: 'Create, read, and run python' }),
      makeMessage({
        id: 'assistant-write',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'gemini-call-0',
            name: 'write_file',
            arguments: '{"path":"c906b.txt","content":"C906B"}',
            status: 'pending',
          },
        ],
      }),
      makeMessage({
        id: 'tool-write',
        role: 'tool',
        toolCallId: 'gemini-call-0',
        content: 'Wrote 5 chars to c906b.txt',
        toolCalls: [
          {
            id: 'gemini-call-0',
            name: 'write_file',
            arguments: '{"path":"c906b.txt","content":"C906B"}',
            status: 'completed',
            result: 'Wrote 5 chars to c906b.txt',
          },
        ],
      }),
      makeMessage({
        id: 'assistant-python',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'gemini-call-0',
            name: 'python',
            arguments: '{"code":"print(\\"C906P\\")"}',
            status: 'completed',
            result: 'C906P',
          },
        ],
      }),
      makeMessage({
        id: 'assistant-spawn',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'gemini-call-0',
            name: 'sessions_spawn',
            arguments: '{"prompt":"Reply exactly C906W"}',
            status: 'completed',
            result: 'C906W',
          },
        ],
      }),
    ]);

    expect(items[1].responseSegments).toEqual([
      expect.objectContaining({
        messageId: 'assistant-write',
        toolCalls: [
          expect.objectContaining({
            name: 'write_file',
            status: 'completed',
            result: 'Wrote 5 chars to c906b.txt',
          }),
        ],
      }),
      expect.objectContaining({
        messageId: 'assistant-python',
        toolCalls: [expect.objectContaining({ name: 'python', result: 'C906P' })],
      }),
      expect.objectContaining({
        messageId: 'assistant-spawn',
        toolCalls: [expect.objectContaining({ name: 'sessions_spawn', result: 'C906W' })],
      }),
    ]);
  });
  it('preserves generated image attachments across merged assistant groups', () => {
    const items = buildDisplayMessages([
      makeMessage({ id: 'user-1', role: 'user', content: 'Generate a logo' }),
      makeMessage({
        id: 'assistant-1',
        role: 'assistant',
        content: 'Generated the first draft.',
        attachments: [
          {
            id: 'generated-image-tool-1',
            type: 'image',
            uri: 'file:///mock/documents/workspace/conv-1/generated-image-tool-1.png',
            name: 'generated-image-tool-1.png',
            mimeType: 'image/png',
            size: 2048,
            workspacePath: 'generated-image-tool-1.png',
          },
        ],
      }),
      makeMessage({
        id: 'assistant-2',
        role: 'assistant',
        content: 'Let me know if you want variations.',
      }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[1].message.attachments).toEqual([
      expect.objectContaining({
        id: 'generated-image-tool-1',
        uri: 'file:///mock/documents/workspace/conv-1/generated-image-tool-1.png',
        workspacePath: 'generated-image-tool-1.png',
      }),
    ]);
    expect(items[1].responseSegments).toEqual([
      expect.objectContaining({
        messageId: 'assistant-1',
        attachments: [expect.objectContaining({ id: 'generated-image-tool-1' })],
      }),
      expect.objectContaining({ messageId: 'assistant-2', attachments: undefined }),
    ]);
  });
  it('derives generated image attachments from legacy image_generate tool results', () => {
    const items = buildDisplayMessages([
      makeMessage({ id: 'user-1', role: 'user', content: 'Generate a logo' }),
      makeMessage({
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'image_generate',
            arguments: '{"prompt":"logo"}',
            status: 'completed',
            result: JSON.stringify({
              status: 'generated',
              providerId: 'openai',
              model: 'gpt-image-2',
              mimeType: 'image/png',
              fileUri: 'file:///mock/documents/workspace/conv-1/generated-logo.png',
            }),
          },
        ],
      }),
    ]);

    expect(items[1].message.attachments).toEqual([
      expect.objectContaining({
        id: 'generated-image-tool-1',
        uri: 'file:///mock/documents/workspace/conv-1/generated-logo.png',
        name: 'generated-logo.png',
        workspacePath: 'generated-logo.png',
      }),
    ]);
    expect(items[1].responseSegments).toEqual([
      expect.objectContaining({
        attachments: [expect.objectContaining({ id: 'generated-image-tool-1' })],
      }),
    ]);
  });
  it('derives edited image attachments from image_edit tool results', () => {
    const items = buildDisplayMessages([
      makeMessage({ id: 'user-1', role: 'user', content: 'Edit this logo' }),
      makeMessage({
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'tool-2',
            name: 'image_edit',
            arguments: '{"prompt":"Make the background black","imagePath":"logo.png"}',
            status: 'completed',
            result: JSON.stringify({
              status: 'edited',
              providerId: 'openai',
              model: 'gpt-image-2',
              mimeType: 'image/png',
              fileUri: 'file:///mock/documents/workspace/conv-1/edited-logo.png',
              sourceCount: 1,
            }),
          },
        ],
      }),
    ]);

    expect(items[1].message.attachments).toEqual([
      expect.objectContaining({
        id: 'generated-image-tool-2',
        uri: 'file:///mock/documents/workspace/conv-1/edited-logo.png',
        name: 'edited-logo.png',
        workspacePath: 'edited-logo.png',
      }),
    ]);
  });
  it('surfaces worker snapshot artifacts as sub-agent response attachments', () => {
    const items = buildDisplayMessages([
      makeMessage({ id: 'user-1', role: 'user', content: 'Generate an image with a worker' }),
      makeMessage({
        id: 'assistant-subagent',
        role: 'assistant',
        content: 'Sub-agent Designer completed in 8s.',
        subAgentEvent: {
          type: 'sub-agent',
          event: 'completed',
          snapshot: {
            sessionId: 'sub-456',
            parentConversationId: 'conv-1',
            depth: 1,
            startedAt: timestamp - 8_000,
            updatedAt: timestamp,
            status: 'completed',
            sandboxPolicy: 'safe-only',
            output: 'Generated the requested image.',
            artifacts: [
              {
                id: 'generated-image-tool-2',
                type: 'image',
                uri: 'file:///mock/documents/workspace/conv-1/generated-worker.png',
                name: 'generated-worker.png',
                mimeType: 'image/png',
                size: 2048,
                workspacePath: 'generated-worker.png',
              },
            ],
          },
        },
      }),
    ]);

    expect(items[1].message.attachments).toEqual([
      expect.objectContaining({
        id: 'generated-image-tool-2',
        workspacePath: 'generated-worker.png',
      }),
    ]);
    expect(items[1].responseSegments).toEqual([
      expect.objectContaining({
        attachments: [expect.objectContaining({ id: 'generated-image-tool-2' })],
      }),
    ]);
  });
  it('starts a new assistant group after the next user turn', () => {
    const items = buildDisplayMessages([
      makeMessage({ id: 'user-1', role: 'user', content: 'First' }),
      makeMessage({ id: 'assistant-1', role: 'assistant', content: 'Reply one' }),
      makeMessage({ id: 'user-2', role: 'user', content: 'Second' }),
      makeMessage({ id: 'assistant-2', role: 'assistant', content: 'Reply two' }),
    ]);

    expect(items).toHaveLength(4);
    expect(items[1].message.content).toBe('Reply one');
    expect(items[3].message.content).toBe('Reply two');
  });
});
