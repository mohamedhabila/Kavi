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
});
