import { clearOldToolResults } from '../../src/services/context/compaction';
import { maybeSpillToolOutput } from '../../src/engine/tools/toolOutputSpill';
import { extractToolResultSummary } from '../../src/utils/toolResultSummary';
import type { Message } from '../../src/types/message';

jest.mock('../../src/services/conversationWorkspace/files', () => ({
  writeConversationWorkspaceTextFile: jest.fn().mockResolvedValue({
    path: '.kavi/spill/read_file-42.txt',
    size: 9000,
    uri: 'file://spill',
  }),
}));

function makeToolMessage(content: string): Message {
  return {
    id: 'tool-1',
    role: 'tool',
    content,
    timestamp: Date.now(),
    toolCallId: 'call-1',
    toolCalls: [
      {
        id: 'call-1',
        name: 'read_file',
        arguments: '{"path":"notes.txt"}',
        status: 'completed',
      },
    ],
  };
}

describe('tool spill + compaction cooperation', () => {
  it('preserves spilled workspace paths through tool-result clearing', async () => {
    const largePayload = 'x'.repeat(9_000);
    const spilled = await maybeSpillToolOutput({
      result: largePayload,
      conversationId: 'conv-1',
      toolName: 'read_file',
      timestamp: 42,
    });

    expect(spilled.spilled).toBe(true);
    const toolMessage = makeToolMessage(spilled.payload);
    const summary = extractToolResultSummary(toolMessage.content);
    expect(summary).toContain('.kavi/spill/read_file-42.txt');

    const recentToolMessages = Array.from({ length: 3 }, (_, index) =>
      makeToolMessage(`recent-${index}`),
    );
    const cleared = clearOldToolResults([toolMessage, ...recentToolMessages], 3);
    expect(cleared.cleared).toBe(1);
    expect(cleared.messages[0]?.content).toContain('.kavi/spill/read_file-42.txt');
  });

  it('preserves structural read continuation metadata when old chunk text is cleared', () => {
    const partial = makeToolMessage(
      JSON.stringify({
        status: 'read_chunk',
        path: 'attachments/large-report.txt',
        sha256: 'a'.repeat(64),
        content: 'x'.repeat(7_000),
        offset: 7_000,
        nextOffset: 14_000,
        totalChars: 28_000,
        complete: false,
      }),
    );
    const recent = Array.from({ length: 3 }, (_, index) => makeToolMessage(`recent-${index}`));

    const cleared = clearOldToolResults([partial, ...recent], 3);
    const compacted = JSON.parse(cleared.messages[0]!.content) as Record<string, unknown>;

    expect(compacted).toMatchObject({
      status: 'read_chunk',
      path: 'attachments/large-report.txt',
      sha256: 'a'.repeat(64),
      offset: 7_000,
      nextOffset: 14_000,
      totalChars: 28_000,
      complete: false,
      compactionPlaceholder: { version: 1, kind: 'cleared' },
    });
    expect(cleared.messages[0]!.content).not.toContain('x'.repeat(100));
  });
});
