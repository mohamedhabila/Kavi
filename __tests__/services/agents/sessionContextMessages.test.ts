import {
  buildStoredSessionTranscript,
  sanitizeTranscriptMessage,
} from '../../../src/services/agents/lifecycle/sessionContextMessages';
import { parseReadFileContinuationResult } from '../../../src/utils/readFileContinuation';
import type { Message } from '../../../src/types/message';

function buildLongReadFileToolMessage(): Message {
  const result = JSON.stringify({
    status: 'read_chunk',
    path: 'attachments/long-source.txt',
    sha256: 'a'.repeat(64),
    content: 'source evidence '.repeat(600),
    offset: 7146,
    nextOffset: 14292,
    totalChars: 147203,
    complete: false,
  });

  return {
    id: 'tool-message-1',
    role: 'tool',
    content: result,
    toolCallId: 'read-call-1',
    timestamp: 1,
    toolCalls: [
      {
        id: 'read-call-1',
        name: 'read_file',
        arguments: '{"path":"attachments/long-source.txt","offset":7146}',
        status: 'completed',
        result,
      },
    ],
  };
}

describe('sub-agent session context messages', () => {
  it('stores long read results as valid restart checkpoints with exact continuation metadata', () => {
    const sanitized = sanitizeTranscriptMessage(buildLongReadFileToolMessage(), {
      finalizationMessageCharLimit: 900,
      finalizationToolContentCharLimit: 2600,
    });
    const firstCheckpoint = JSON.parse(sanitized.content);

    expect(firstCheckpoint.durableCheckpoint).toEqual({
      version: 1,
      contentRetained: false,
      rereadOffset: 7146,
    });
    expect(firstCheckpoint.guidance).toContain('offset 7146');
    expect(parseReadFileContinuationResult(sanitized.content)).toEqual({
      version: 1,
      tool: 'read_file',
      path: 'attachments/long-source.txt',
      sha256: 'a'.repeat(64),
      offset: 7146,
      nextOffset: 14292,
      totalChars: 147203,
      complete: false,
      rereadOffset: 7146,
    });

    const stored = buildStoredSessionTranscript([sanitized], undefined, {
      sessionContextMaxMessages: 10,
      sessionContextMessageCharLimit: 900,
      sessionContextToolContentCharLimit: 1400,
    });
    const persistedCheckpoint = JSON.parse(stored.messages[0].content);

    expect(persistedCheckpoint).toEqual(firstCheckpoint);
    expect(parseReadFileContinuationResult(stored.messages[0].content)).toEqual(
      parseReadFileContinuationResult(sanitized.content),
    );
    expect(stored.messages[0].content.endsWith('...')).toBe(false);
  });

  it('retains the original instruction and a provider-valid tail after long-run compaction', () => {
    const messages: Message[] = [
      { id: 'user-seed', role: 'user', content: 'Inspect every source file.', timestamp: 1 },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        toolCalls: [
          {
            id: 'call-1',
            name: 'read_file',
            arguments: '{"path":"one.txt"}',
            status: 'pending',
          },
        ],
      },
      {
        id: 'tool-1',
        role: 'tool',
        content:
          '{"status":"read_chunk","path":"one.txt","offset":0,"totalChars":1,"complete":true}',
        toolCallId: 'call-1',
        timestamp: 3,
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: '',
        timestamp: 4,
        toolCalls: [
          {
            id: 'call-2',
            name: 'read_file',
            arguments: '{"path":"two.txt"}',
            status: 'pending',
          },
        ],
      },
      {
        id: 'tool-2',
        role: 'tool',
        content:
          '{"status":"read_chunk","path":"two.txt","offset":0,"totalChars":1,"complete":true}',
        toolCallId: 'call-2',
        timestamp: 5,
      },
      {
        id: 'assistant-3',
        role: 'assistant',
        content: '',
        timestamp: 6,
        toolCalls: [
          {
            id: 'call-3',
            name: 'read_file',
            arguments: '{"path":"three.txt"}',
            status: 'pending',
          },
        ],
      },
      {
        id: 'tool-3',
        role: 'tool',
        content:
          '{"status":"read_chunk","path":"three.txt","offset":0,"totalChars":1,"complete":true}',
        toolCallId: 'call-3',
        timestamp: 7,
      },
    ];

    const stored = buildStoredSessionTranscript(messages, undefined, {
      sessionContextMaxMessages: 4,
      sessionContextMessageCharLimit: 900,
      sessionContextToolContentCharLimit: 1400,
    });

    expect(stored.retainedFromStart).toBe(false);
    expect(stored.messages.map((message) => message.id)).toEqual([
      'user-seed',
      'assistant-3',
      'tool-3',
    ]);
    expect(stored.messages[0]).toMatchObject({
      role: 'user',
      content: 'Inspect every source file.',
    });
    expect(stored.messages[1]?.toolCalls?.[0]?.id).toBe(stored.messages[2]?.toolCallId);
  });
});
